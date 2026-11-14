import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { appBaseUrl } from "./appUrl";
import { purgeOrgAudit, writeAudit } from "./audit";
import {
  assertPasswordSet,
  currentOrg,
  isAdminView,
  canManageMaintenance,
  viewFor,
  requireOrg,
  requireOrgAdmin,
  requireOrgId,
  requireUser,
  currentUser,
  tenantOrgId,
} from "./authz";
import * as el from "./elevenLabsApi";
import type { JobRole } from "./jobRoles";
import type { AppRole } from "./jobRoles";
import {
  appRoleOf,
  jobRoleValidator,
  jobRolesFor,
  notifyChannelValidator,
  parseAppRole,
  parseAppRoles,
} from "./jobRoles";
import { appRolesOf, rolesFor, storageForRoles } from "./roleSet";
import { sendEmail } from "./resendApi";
import { countOwnedBy, purgeOrgUnits } from "./units";

/**
 * Teams, members and invitations.
 *
 * Reading the roster is open to any member — a teammate should be able to see who else is on
 * the team. Everything that changes it is admin-only, enforced here rather than by hiding the
 * tab; hiding the nav item is a courtesy to the person, not a security boundary.
 */

/** Long enough that guessing is hopeless, short enough to survive an email client's line wrap. */
const TOKEN_BYTES = 32;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UNAVAILABLE_MS = 365 * 24 * 60 * 60 * 1000;

/** E.164: a plus, a non-zero first digit, 8-15 digits in all. SMS routing breaks on anything else. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function assertE164(phone: string): string {
  const trimmed = phone.trim();
  if (!E164.test(trimmed)) {
    throw new ConvexError("Enter the phone number in international format, like +15185550123.");
  }
  return trimmed;
}

/** Same sentence everywhere a member is blocked or removed while they still own units. */
function ownsUnitsError(count: number): ConvexError<string> {
  return new ConvexError(`Reassign their ${count} unit${count === 1 ? "" : "s"} first.`);
}

// --- Reads ----------------------------------------------------------------

/**
 * A live query, unlike the Clerk-backed version this replaced — the roster is now rows in this
 * database, so the Team page updates itself when someone accepts an invite.
 */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return null;

    const organization = await ctx.db.get(org.orgId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();

    // Phone numbers are PII: only the people who dispatch work (and the owner of the number)
    // get them. Everyone else on the roster sees the member, not how to reach them.
    const canSeePhones = isAdminView(org);
    const fullRoster = isAdminView(org);

    const members = await Promise.all(
      memberships.map(async (m) => {
        const [user, hours, connection, unitsOwned] = await Promise.all([
          ctx.db.get(m.userId),
          ctx.db
            .query("tourAvailability")
            .withIndex("by_user", (q) => q.eq("userId", m.userId))
            .unique(),
          ctx.db
            .query("googleCalendarConnections")
            .withIndex("by_user", (q) => q.eq("userId", m.userId))
            .unique(),
          countOwnedBy(ctx, m.userId),
        ]);
        const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
        const takingTours = hours?.availableForTours ?? true;
        // Non-admin views see colleagues' name, role, skill and out-of-office flag only; email,
        // unit counts and cover arrangements are admin-view (or self) data.
        const full = fullRoster || m.userId === org.user._id;
        return {
          membershipId: m._id,
          userId: m.userId,
          name: name || (full ? user?.email : undefined) || "Unknown",
          email: full ? (user?.email ?? "") : "",
          imageUrl: user?.imageUrl ?? null,
          role: m.role,
          jobRoles: m.jobRoles ?? [],
          // Primary role (old single-role callers) and every role held (B31).
          appRole: appRoleOf(m.role, m.jobRoles ?? []),
          appRoles: appRolesOf(m.role, m.jobRoles ?? []),
          phone: canSeePhones || m.userId === org.user._id ? (m.phone ?? null) : null,
          notifyBy: m.notifyBy ?? [],
          unavailableUntil: m.unavailableUntil ?? null,
          coveringUserId: full ? (m.coveringUserId ?? null) : null,
          skill: m.skill ?? null,
          // Sarah routing flags (admin picks them on the Team page); false for non-admin viewers.
          leadAssignee: fullRoster ? Boolean(m.leadAssignee) : false,
          unmatchedAssignee: fullRoster ? Boolean(m.unmatchedAssignee) : false,
          unitsOwned: full ? unitsOwned : 0,
          isSelf: m.userId === org.user._id,
          joinedAt: m.createdAt,
          takingTours,
          // Whether Sarah can actually book them right now, and if not, the one thing in the way.
          // Same rules as tours.bookingContext, which is what booking really reads.
          tourStatus: !takingTours
            ? ("off" as const)
            : !connection
              ? ("no_calendar" as const)
              : connection.invalidAt
                ? ("reconnect" as const)
                : !organization?.timeZone
                  ? ("no_time_zone" as const)
                  : ("bookable" as const),
        };
      }),
    );

    // A plain member has no reason to see who has been invited but not yet joined.
    const invitations = isAdminView(org)
      ? (
          await ctx.db
            .query("invites")
            .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
            .collect()
        )
          .filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > Date.now())
          .map((i) => ({
            id: i._id,
            email: i.email,
            role: i.role,
            jobRoles: i.jobRoles ?? [],
            appRole: appRoleOf(i.role, i.jobRoles ?? []),
            appRoles: appRolesOf(i.role, i.jobRoles ?? []),
            fullName: i.fullName ?? null,
            phone: i.phone ?? null, // admin-only list; lets "Resend" reuse the original details
            createdAt: i.createdAt,
            expiresAt: i.expiresAt,
          }))
      : [];

    return {
      orgId: org.orgId,
      orgName: organization?.name ?? "Your team",
      isAdmin: isAdminView(org),
      members: members.sort((a, b) => {
        if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
        return a.joinedAt - b.joinedAt;
      }),
      invitations,
    };
  },
});

/** What the signed-in person may see: drives which of the app's views they land in. */
export const myAccess = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return null;
    return {
      // The caller's own user id, so a page can ask for "my" records (e.g. the tech app's jobs).
      userId: org.user._id,
      // Default landing view only (home redirect). Access decisions use `roles`, the full set held.
      view: viewFor(org.isAdmin, org.jobRoles),
      roles: [...rolesFor(org.isAdmin, org.jobRoles)],
      isAdmin: isAdminView(org),
      jobRoles: org.jobRoles,
      canManageMaintenance: canManageMaintenance(org),
      isExecutive: org.jobRoles.includes("executive"),
    };
  },
});

// --- Writes ---------------------------------------------------------------

export const rename = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError("Give the team a name.");
    if (name.length > 60) throw new ConvexError("Team name is too long (max 60 characters).");
    await ctx.db.patch(org.orgId, { name, updatedAt: Date.now() });
  },
});

export const removeMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== org.orgId) throw new ConvexError("Member not found.");

    // Removing yourself would leave a team nobody can administer, and there is no ownership
    // transfer yet, so the only safe answer is to refuse.
    if (membership.userId === org.user._id) {
      throw new ConvexError("You cannot remove yourself from your own team.");
    }

    // Units must always have an asset manager, so someone who still owns units can't leave.
    const owned = await countOwnedBy(ctx, membership.userId);
    if (owned > 0) throw ownsUnitsError(owned);

    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "membership",
      entityId: args.membershipId,
      action: "member_removed",
      actorUserId: org.user._id,
      from: (membership.jobRoles ?? []).join(","),
    });
    await ctx.db.delete(args.membershipId);
  },
});

/**
 * Replaces a member's job roles. Admin-only: handing out simplr_admin or executive is handing
 * out reach, so it sits with team administration rather than with the job roles it grants.
 */
export const setJobRoles = mutation({
  args: { userId: v.id("users"), jobRoles: v.array(jobRoleValidator) },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!membership || membership.orgId !== org.orgId) throw new ConvexError("Member not found.");

    const next = [...new Set(args.jobRoles)];
    const before = membership.jobRoles ?? [];

    // Dropping asset_manager from someone who owns units would leave those units pointing at a
    // person who can no longer be their AM; they have to be reassigned first.
    if (before.includes("asset_manager") && !next.includes("asset_manager")) {
      const owned = await countOwnedBy(ctx, args.userId);
      if (owned > 0) throw ownsUnitsError(owned);
    }

    // Same last-Admin and self-demotion protection as setAppRole.
    const isAdminFlag = membership.role === "admin";
    if (isAdminView({ isAdmin: isAdminFlag, jobRoles: before }) && !isAdminView({ isAdmin: isAdminFlag, jobRoles: next })) {
      if (membership.userId === org.user._id) throw new ConvexError("Ask another Admin to change your role.");
      const members = await ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect();
      if (!members.some((m) => m._id !== membership._id && isAdminView({ isAdmin: m.role === "admin", jobRoles: m.jobRoles ?? [] }))) {
        throw new ConvexError("The team needs at least one Admin.");
      }
    }

    await ctx.db.patch(membership._id, { jobRoles: next });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "membership",
      entityId: membership._id,
      action: "job_roles_set",
      actorUserId: org.user._id,
      from: before.join(","),
      to: next.join(","),
    });
  },
});

/**
 * The one write path for a member's roles (setRoles and the older setAppRole): writes the
 * membership role and the job roles in one patch so they can never disagree. `roles` is already
 * checked (parseAppRole / parseAppRoles). Last-Admin, self-demotion and units-owned rules apply.
 */
async function writeMemberRoles(
  ctx: MutationCtx,
  org: Awaited<ReturnType<typeof requireOrgAdmin>>,
  membership: Doc<"memberships">,
  roles: AppRole[],
  action: "app_role_set" | "roles_set",
) {
  const before = membership.jobRoles ?? [];
  const next = storageForRoles(roles);
  const wasAdmin = isAdminView({ isAdmin: membership.role === "admin", jobRoles: before });

  if (wasAdmin && next.role !== "admin") {
    // Locking yourself out is the easy mistake; another admin can make the change instead.
    if (membership.userId === org.user._id) {
      throw new ConvexError("Ask another Admin to change your role.");
    }
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    if (!members.some((m) => m._id !== membership._id && isAdminView({ isAdmin: m.role === "admin", jobRoles: m.jobRoles ?? [] }))) {
      throw new ConvexError("The team needs at least one Admin.");
    }
  }

  // Leaving asset_manager while owning units would strand those units; reassign them first.
  if (before.includes("asset_manager") && !next.jobRoles.includes("asset_manager")) {
    const owned = await countOwnedBy(ctx, membership.userId);
    if (owned > 0) throw ownsUnitsError(owned);
  }

  await ctx.db.patch(membership._id, { role: next.role, jobRoles: next.jobRoles });
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "membership",
    entityId: membership._id,
    action,
    actorUserId: org.user._id,
    from: `${membership.role}:${before.join(",")}`,
    to: `${next.role}:${next.jobRoles.join(",")}`,
  });
}

/**
 * Sets a member's roles (B31 multi-role): Admin on its own, or any mix of Asset manager,
 * Technician and Accountant. Admin-only. `roles` arrives as plain strings and is checked by
 * parseAppRoles, so a missing, unknown or Admin-plus-other selection gets a clear ConvexError.
 */
export const setRoles = mutation({
  args: { membershipId: v.id("memberships"), roles: v.array(v.string()) },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const roles = parseAppRoles(args.roles);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== org.orgId) throw new ConvexError("Member not found.");
    await writeMemberRoles(ctx, org, membership, roles, "roles_set");
  },
});

/**
 * Sets a member's single app role (Admin / Asset manager / Technician / Accountant). Kept for older
 * callers; the same as setRoles with one role. Admin-only. appRole arrives as a plain string and is
 * checked by parseAppRole for a clear ConvexError.
 */
export const setAppRole = mutation({
  args: { userId: v.id("users"), appRole: v.string() },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const appRole = parseAppRole(args.appRole);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!membership || membership.orgId !== org.orgId) throw new ConvexError("Member not found.");
    await writeMemberRoles(ctx, org, membership, [appRole], "app_role_set");
  },
});

/**
 * Phone and notification channels. An admin can set anyone's; everyone can set their own, since
 * it is their number and their inbox. The number itself is kept out of the audit row (PII).
 */
export const setContact = mutation({
  args: {
    userId: v.id("users"),
    phone: v.optional(v.string()), // "" clears it
    notifyBy: v.optional(v.array(notifyChannelValidator)),
    skill: v.optional(v.string()), // "" clears it; shown as the subtitle on Team and the dashboard
  },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!isAdminView(org) && args.userId !== org.user._id) {
      throw new ConvexError("You don't have access to that.");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!membership || membership.orgId !== org.orgId) throw new ConvexError("Member not found.");

    // Fields are picked one by one — never spread args into the row.
    const patch: { phone?: string; notifyBy?: Array<"sms" | "email" | "push">; skill?: string } = {};
    if (args.phone !== undefined) {
      patch.phone = args.phone.trim() === "" ? undefined : assertE164(args.phone);
    }
    if (args.notifyBy !== undefined) patch.notifyBy = [...new Set(args.notifyBy)];
    if (args.skill !== undefined) {
      const skill = args.skill.trim();
      if (skill.length > 80) throw new ConvexError("Skill is too long (max 80 characters).");
      patch.skill = skill === "" ? undefined : skill;
    }
    if (!("phone" in patch) && !("notifyBy" in patch) && !("skill" in patch)) return;

    await ctx.db.patch(membership._id, patch);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "membership",
      entityId: membership._id,
      action: "contact_updated",
      actorUserId: org.user._id,
      note: [
        args.phone !== undefined ? "phone" : null,
        args.notifyBy !== undefined ? `notifyBy=${patch.notifyBy?.join(",")}` : null,
        args.skill !== undefined ? "skill" : null,
      ]
        .filter(Boolean)
        .join("; "),
    });
  },
});

/**
 * Out-of-office flag that sends asset-manager work to the fallback. `until` omitted clears it
 * (and the covering AM with it). `coveringUserId` names the asset manager who gets read-only
 * access to this person's units while they are out (amScope.ts).
 */
export const setUnavailable = mutation({
  args: { userId: v.id("users"), until: v.optional(v.number()), coveringUserId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (args.userId !== org.user._id && !isAdminView(org)) {
      throw new ConvexError("You don't have access to that.");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!membership || membership.orgId !== org.orgId) throw new ConvexError("Member not found.");

    const now = Date.now();
    if (args.until !== undefined) {
      // A past or absurdly distant date is a typo, and a far-future one silently parks a
      // person's work forever.
      if (!Number.isFinite(args.until) || args.until <= now) {
        throw new ConvexError("Pick a time in the future.");
      }
      if (args.until > now + MAX_UNAVAILABLE_MS) throw new ConvexError("Pick an end time within the next year.");
    }

    let coveringUserId: Id<"users"> | undefined;
    if (args.until !== undefined && args.coveringUserId !== undefined) {
      if (args.coveringUserId === args.userId) throw new ConvexError("Pick someone else to cover.");
      const cover = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", args.coveringUserId!))
        .first();
      if (!cover || cover.orgId !== org.orgId || !(cover.jobRoles ?? []).includes("asset_manager")) {
        throw new ConvexError("Pick an asset manager on this team to cover.");
      }
      coveringUserId = cover.userId;
    }

    await ctx.db.patch(membership._id, { unavailableUntil: args.until, coveringUserId });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "membership",
      entityId: membership._id,
      action: "unavailable_set",
      actorUserId: org.user._id,
      from: membership.unavailableUntil ? String(membership.unavailableUntil) : undefined,
      to: args.until ? String(args.until) : undefined,
      note: coveringUserId ? `covering=${coveringUserId}` : undefined,
    });
  },
});

/** Shared by the two Sarah routing flags: admin-only, target must be an asset manager on this team. */
async function setAssigneeFlag(
  ctx: MutationCtx,
  userId: Id<"users">,
  field: "leadAssignee" | "unmatchedAssignee",
  value: boolean,
): Promise<boolean> {
  const org = await requireOrgAdmin(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!membership || membership.orgId !== org.orgId) throw new ConvexError("Member not found.");
  if (value && !(membership.jobRoles ?? []).includes("asset_manager")) {
    throw new ConvexError("Only an asset manager can be chosen for this.");
  }
  if (Boolean(membership[field]) === value) return false;
  await ctx.db.patch(membership._id, { [field]: value });
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "membership",
    entityId: membership._id,
    action: field === "leadAssignee" ? "lead_assignee_set" : "unmatched_assignee_set",
    actorUserId: org.user._id,
    from: String(!value),
    to: String(value),
  });
  return value;
}

/**
 * Admin chooses the backup tour staff (memberships.leadAssignee; the field keeps its old name). They
 * give tours when the caller has not picked a building (tours.bookingContext), and are the second
 * choice for unmatched-caller callbacks (leads.pickUnmatchedAssignee). Leads no longer go to them
 * (B41: unassigned until a building is picked). Turning it on requires the asset_manager job role.
 */
export const setLeadAssignee = mutation({
  args: { userId: v.id("users"), value: v.boolean() },
  handler: async (ctx, args) => {
    await setAssigneeFlag(ctx, args.userId, "leadAssignee", args.value);
  },
});

/**
 * Admin chooses who gets callback contacts for callers Sarah could not match to a unit. More than
 * one may be chosen; the least-loaded of them gets each new one (leads.pickUnmatchedAssignee).
 */
export const setUnmatchedAssignee = mutation({
  args: { userId: v.id("users"), value: v.boolean() },
  handler: async (ctx, args) => {
    await setAssigneeFlag(ctx, args.userId, "unmatchedAssignee", args.value);
  },
});

/**
 * One-off: gives every membership that predates job roles a value. Team admins become
 * simplr_admin (they already act as one — see authz.isAdminView); everyone else starts with none
 * until an admin assigns roles on the Team page. Idempotent: rows that already have jobRoles
 * (even an empty array) are left alone.
 *
 * Run it with:  npx convex run team:backfillJobRoles
 */
export const backfillJobRoles = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for (const m of await ctx.db.query("memberships").collect()) {
      if (m.jobRoles !== undefined) continue;
      await ctx.db.patch(m._id, { jobRoles: m.role === "admin" ? ["simplr_admin"] : [] });
      updated += 1;
    }
    return { updated };
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.orgId !== org.orgId) return;
    if (invite.acceptedAt || invite.revokedAt) return;
    await ctx.db.patch(args.inviteId, { revokedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "membership",
      entityId: String(args.inviteId),
      action: "invite_revoked",
      actorUserId: org.user._id,
    });
  },
});

// --- Invitations ----------------------------------------------------------

/**
 * Creates an invitation and emails the link.
 *
 * An action rather than a mutation because it needs real randomness and SHA-256 (neither is
 * available in Convex's deterministic mutation runtime) and because it sends mail.
 */
export const invite = action({
  args: {
    email: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
    jobRoles: v.optional(v.array(jobRoleValidator)),
    // Preferred: when given, role and jobRoles above are ignored and derived from it. A plain
    // string so parseAppRole can reject a bad value with a clear ConvexError.
    appRole: v.optional(v.string()),
    // Multi-role (B31), preferred over appRole: Admin alone, or any mix of the other three.
    // Plain strings so parseAppRoles can reject a bad selection with a clear ConvexError.
    appRoles: v.optional(v.array(v.string())),
    phone: v.optional(v.string()),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ email: string; resent: boolean }> => {
    // Admin check first, so a non-admin always hears "Only admins can invite people." and never a
    // role-validation message. createAndSendInvite checks again (it has other callers).
    const inviter = await requireOrgId(ctx);
    if (!isAdminView(inviter)) throw new ConvexError("Only admins can invite people.");
    return await createAndSendInvite(ctx, {
      ...args,
      appRole: args.appRole === undefined ? undefined : parseAppRole(args.appRole),
      appRoles: args.appRoles === undefined ? undefined : parseAppRoles(args.appRoles),
    });
  },
});

/**
 * The one invite implementation (team.invite and assetManagers.invite both call it): admin
 * check, role derivation, supersede-and-record, then the Resend email. `fullName` is optional
 * display text kept on the pending invite only.
 */
export async function createAndSendInvite(
  ctx: ActionCtx,
  args: {
    email: string;
    role?: "admin" | "member";
    jobRoles?: JobRole[];
    appRole?: AppRole;
    // Checked role selection (parseAppRoles); wins over appRole and jobRoles.
    appRoles?: AppRole[];
    phone?: string;
    fullName?: string;
  },
): Promise<{ email: string; resent: boolean }> {
  const inviter = await requireOrgId(ctx);
  if (!isAdminView(inviter)) throw new ConvexError("Only admins can invite people.");
  const { orgId, userId } = inviter;
  const phone = args.phone?.trim() ? assertE164(args.phone) : undefined;

  const derived = args.appRoles
    ? storageForRoles(args.appRoles)
    : args.appRole
      ? jobRolesFor(args.appRole)
      : null;
  const jobRoles = derived ? derived.jobRoles : [...new Set(args.jobRoles ?? [])];
  if (jobRoles.length === 0) throw new ConvexError("Pick a role for this person.");
  // An admin invite must carry an admin-flavoured job role, so they land in the admin view.
  const role = derived ? derived.role : (args.role ?? "member");
  if (
    role === "admin" &&
    !jobRoles.some((r) => r === "executive" || r === "maintenance_lead" || r === "simplr_admin")
  ) {
    throw new ConvexError("Pick a role for this person.");
  }

  const email = args.email.trim().toLowerCase();
  if (!email.includes("@") || email.length < 3) throw new ConvexError("Enter a valid email address.");

  const token = randomToken();
  const created: { orgName: string; resent: boolean } = await ctx.runMutation(internal.team.recordInvite, {
    orgId,
    email,
    role,
    jobRoles,
    phone,
    fullName: args.fullName,
    tokenHash: await sha256(token),
    createdBy: userId,
    expiresAt: Date.now() + INVITE_TTL_MS,
  });

  const link = `${appBaseUrl()}/accept-invite?token=${token}`;

  await sendEmail({
    to: email,
    subject: `You have been invited to ${created.orgName}`,
    html: inviteEmailHtml(created.orgName, link),
    text: inviteEmailText(created.orgName, link),
  });

  return { email, resent: created.resent };
}

/**
 * Redeems an invitation for the signed-in user.
 *
 * Everything that could let a stray link into somebody else's team is checked here: the token
 * must hash to a live invite, the invite must not be expired, revoked or already used, and the
 * signed-in account's email must be the one that was invited — otherwise a forwarded email
 * would be enough to join.
 */
export const acceptInvite = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ orgName: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first, then open the invitation link again.");

    return await ctx.runMutation(internal.team.redeemInvite, {
      clerkId: identity.subject,
      tokenHash: await sha256(args.token.trim()),
    });
  },
});

export const recordInvite = internalMutation({
  args: {
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    jobRoles: v.optional(v.array(jobRoleValidator)),
    phone: v.optional(v.string()),
    fullName: v.optional(v.string()),
    tokenHash: v.string(),
    createdBy: v.id("users"),
    expiresAt: v.number(),
  },
  handler: async (ctx, args): Promise<{ orgName: string; resent: boolean }> => {
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new ConvexError("Team not found.");

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existingUser) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", existingUser._id))
        .first();
      // A role-less membership ("Waiting for access") may be re-invited; redeeming applies the roles.
      const roleless = membership?.role !== "admin" && (membership?.jobRoles ?? []).length === 0;
      if (membership?.orgId === args.orgId && !roleless) throw new ConvexError("They are already on this team.");
      if (membership && membership.orgId !== args.orgId) {
        throw new ConvexError("That person already belongs to another team.");
      }
    }

    // Supersede any live invite for the same address rather than stacking them, so revoking
    // one cannot leave an older token still working.
    const previous = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    // Anti email-bombing: at most 3 invites per address and 100 per team in a rolling 24h.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (previous.filter((p) => p.createdAt >= dayAgo).length >= 3) {
      throw new ConvexError("Too many invitations were sent to that address today. Try again tomorrow.");
    }
    let teamToday = 0;
    for await (const row of ctx.db.query("invites").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).order("desc")) {
      if (row.createdAt < dayAgo) break;
      if (++teamToday >= 100) throw new ConvexError("Your team reached today's invitation limit. Try again tomorrow.");
    }
    let resent = false;
    for (const old of previous) {
      if (!old.acceptedAt && !old.revokedAt) {
        await ctx.db.patch(old._id, { revokedAt: Date.now() });
        resent = true;
      }
    }

    const inviteId = await ctx.db.insert("invites", { ...args, createdAt: Date.now() });
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "membership",
      entityId: String(inviteId),
      action: resent ? "invite_resent" : "invite_sent",
      actorUserId: args.createdBy,
      note: `jobRoles=${(args.jobRoles ?? []).join(",")}`,
    });
    return { orgName: org.name, resent };
  },
});

export const redeemInvite = internalMutation({
  args: { clerkId: v.string(), tokenHash: v.string() },
  handler: async (ctx, args): Promise<{ orgName: string }> => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .first();

    // One message for every "this link is no good" case on purpose — distinguishing them tells
    // whoever is holding the link which guess got closer.
    const dead = "That invitation link is no longer valid. Ask for a new one.";
    if (!invite) throw new ConvexError(dead);
    if (invite.acceptedAt || invite.revokedAt || invite.expiresAt < Date.now()) throw new ConvexError(dead);

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (!user) throw new ConvexError("Your account is still being set up. Try again in a moment.");
    // Joining a team is not on the short list a person on a temporary password may do (passwordGate.ts).
    assertPasswordSet(user, await ctx.auth.getUserIdentity());

    if ((user.email ?? "").toLowerCase() !== invite.email) {
      throw new ConvexError(
        `This invitation was sent to ${invite.email}. Sign in with that address to accept it.`,
      );
    }

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (existing) {
      if (existing.orgId === invite.orgId) {
        await applyInviteToMembership(ctx, existing, invite);
        await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
        const org = await ctx.db.get(invite.orgId);
        return { orgName: org?.name ?? "your team" };
      }
      throw new ConvexError("You already belong to a team. Leave it before joining another.");
    }

    await ctx.db.insert("memberships", {
      orgId: invite.orgId,
      userId: user._id,
      role: invite.role,
      jobRoles: invite.jobRoles,
      phone: invite.phone,
      createdAt: Date.now(),
    });
    await ctx.db.patch(invite._id, { acceptedAt: Date.now() });

    const org = await ctx.db.get(invite.orgId);
    return { orgName: org?.name ?? "your team" };
  },
});

/**
 * Applies an invite to a membership the person already has in the inviting team — typically the
 * bare one sign-up created before the invite was redeemed. Only ever adds: job roles are merged,
 * an admin is never demoted, and a phone already on the membership is kept.
 */
async function applyInviteToMembership(
  ctx: MutationCtx,
  membership: Doc<"memberships">,
  invite: Doc<"invites">,
) {
  await mergeGrantIntoMembership(ctx, membership, invite, { actorUserId: membership.userId, note: `invite=${invite._id}` });
}

/**
 * The merge an accepted invite applies, shared with the production seed (prodSeed.ts) so seeded
 * people get their roles exactly the way an invitee does: job roles are merged, an admin is never
 * demoted, and a phone already on the membership is kept. Audited as invite_accepted.
 */
export async function mergeGrantIntoMembership(
  ctx: MutationCtx,
  membership: Doc<"memberships">,
  grant: { role: "admin" | "member"; jobRoles?: JobRole[]; phone?: string },
  audit: { actorUserId: Id<"users">; note: string },
): Promise<{ role: "admin" | "member"; jobRoles: JobRole[]; phone?: string }> {
  const before = membership.jobRoles ?? [];
  const jobRoles = [...new Set([...before, ...(grant.jobRoles ?? [])])];
  const role = membership.role === "admin" || grant.role === "admin" ? "admin" : "member";
  const phone = membership.phone ?? grant.phone;

  await ctx.db.patch(membership._id, { role, jobRoles, phone });
  await writeAudit(ctx, {
    orgId: membership.orgId,
    entity: "membership",
    entityId: membership._id,
    action: "invite_accepted",
    actorUserId: audit.actorUserId,
    from: `${membership.role}:${before.join(",")}`,
    to: `${role}:${jobRoles.join(",")}`,
    note: audit.note,
  });
  return { role, jobRoles, phone };
}

/**
 * Single-tenant: puts a brand-new account into the one shared team as a member. Only on a fresh
 * install, when no team exists yet, does it create the team with this account as admin and
 * schedule its setup (agent, property, knowledge — agents.ensure).
 * Scheduled rather than awaited: it calls ElevenLabs and takes seconds, and the Clerk webhook
 * that calls this must answer quickly or Clerk retries it. Scheduling in this same mutation
 * means the team and its setup are committed together — never a team whose setup was dropped.
 *
 * Called from the Clerk user webhook. Deliberately does nothing when the person already has a
 * membership: someone who signed up *because* they were invited must land in the inviting team,
 * not in a fresh empty one of their own.
 */
export const ensureTeamForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) {
      if (existing.role === "admin") await scheduleSetupIfMissing(ctx, existing.orgId, args.userId);
      return;
    }

    const user = await ctx.db.get(args.userId);
    if (!user) return;

    // Clerk can send session.created before user.created, and only the latter carries the email.
    // Without it the invite check below can't run, so wait: user.created calls this again.
    const email = user.email?.toLowerCase();
    if (!email) return;

    // An unaccepted invitation means this sign-up is on its way into someone else's team.
    // Creating a team here would make that impossible, since a person may only be on one.
    const pending = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    const live = pending.find(
      (i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > Date.now(),
    );
    if (live) return;

    // Single-tenant: once the team exists, every new account joins it as a member. Only the
    // very first account (fresh install) falls through to create the team and become its admin.
    const tenant = await tenantOrgId(ctx);
    if (tenant) {
      await ctx.db.insert("memberships", {
        orgId: tenant,
        userId: args.userId,
        role: "member",
        createdAt: Date.now(),
      });
      return;
    }

    const now = Date.now();
    const name = user.firstName ? `${user.firstName}'s Team` : "My Team";
    const orgId: Id<"organizations"> = await ctx.db.insert("organizations", {
      name,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("memberships", {
      orgId,
      userId: args.userId,
      role: "admin",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.agents.ensure, { orgId, userId: args.userId });
  },
});

/**
 * For an admin whose team still has no agent — created before sign-up set teams up, or whose
 * setup failed. session.created lands here on every sign-in, so this retries on the next one.
 * The agent check is here rather than left to ensure so an ordinary sign-in schedules nothing.
 */
async function scheduleSetupIfMissing(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
) {
  const agent = await ctx.db
    .query("agents")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (!agent) await ctx.scheduler.runAfter(0, internal.agents.ensure, { orgId, userId });
}

/** Used by the accept page to show who invited them before they commit to signing in. */
export const inviteSummary = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < Date.now()) {
      return null;
    }
    const org = await ctx.db.get(invite.orgId);
    return { orgName: org?.name ?? "a team", email: invite.email, role: invite.role };
  },
});

export const peekInvite = action({
  args: { token: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ orgName: string; email: string; role: string } | null> =>
    await ctx.runQuery(internal.team.inviteSummary, {
      tokenHash: await sha256(args.token.trim()),
    }),
});

// --- Helpers --------------------------------------------------------------

export function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // base64url: URL-safe without percent-encoding, so the link survives email clients intact.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Only the hash is stored, so a dump of the invites table cannot be replayed into a team. */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/*
 * Theme tokens mirrored from app/globals.css, hardcoded because email has no CSS variables:
 *   slate-50 #f8fafc (page)   white #ffffff (card)     slate-200 #e2e8f0 (border)
 *   slate-900 #0f172a (text)  slate-500 #64748b (body) slate-400 #94a3b8 (footnote)
 *   blue-600 #2563eb (primary)                         --radius 0.75rem -> 12px
 * Geist is deliberately not used: email clients cannot load webfonts, so the system stack
 * is the closest thing that renders everywhere.
 */
const EMAIL = {
  page: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  heading: "#0f172a",
  body: "#64748b",
  subtle: "#94a3b8",
  primary: "#2563eb",
  radius: "12px",
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
} as const;

/*
 * Absolute and pinned to production on purpose — not appBaseUrl(). On the dev deployment that
 * helper returns http://localhost:3000, which resolves to the *recipient's* machine and shows a
 * broken image, so test invites sent from dev would look broken to whoever received them.
 */
const LOGO_URL = "https://www.simplr.pro/brand/simplr-logo.png";

/*
 * Table-based rather than divs: Outlook renders through Word's HTML engine, which ignores
 * max-width and margin:auto on a div and would left-align the whole message.
 */
function inviteEmailHtml(orgName: string, link: string): string {
  const org = escapeHtml(orgName);
  return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:${EMAIL.page}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.page}" style="background:${EMAIL.page};padding:40px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%">
            <tr>
              <td align="left" style="padding:0 4px 20px">
                <img src="${LOGO_URL}" alt="Simplr" width="104" height="36" style="display:block;width:104px;height:36px;border:0" />
              </td>
            </tr>
            <tr>
              <td bgcolor="${EMAIL.card}" style="background:${EMAIL.card};border:1px solid ${EMAIL.border};border-radius:${EMAIL.radius};padding:32px">
                <h1 style="font-family:${EMAIL.font};font-size:20px;line-height:28px;font-weight:700;color:${EMAIL.heading};margin:0 0 12px">
                  You have been invited to ${org}
                </h1>
                <p style="font-family:${EMAIL.font};font-size:14px;line-height:22px;color:${EMAIL.body};margin:0 0 24px">
                  Join the team to share the same AI leasing assistant, property details, knowledge base and leads.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="${EMAIL.primary}" style="background:${EMAIL.primary};border-radius:${EMAIL.radius}">
                      <a href="${link}" style="display:inline-block;font-family:${EMAIL.font};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:${EMAIL.radius}">
                        Accept invitation
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="font-family:${EMAIL.font};font-size:12px;line-height:20px;color:${EMAIL.body};margin:24px 0 0">
                  Or paste this link into your browser:<br />
                  <a href="${link}" style="color:${EMAIL.primary};text-decoration:none;word-break:break-all">${link}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 4px 0">
                <p style="font-family:${EMAIL.font};font-size:12px;line-height:20px;color:${EMAIL.subtle};margin:0">
                  This link expires in 7 days and can only be used once. If you were not expecting it, you can ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `;
}

/*
 * The plain-text half of the multipart message. Not a nicety: an HTML-only transactional email
 * scores badly with spam filters, which expect both parts. Kept in step with the HTML above —
 * same wording, same link, no escaping (text/plain has no markup to escape).
 */
function inviteEmailText(orgName: string, link: string): string {
  return [
    `You have been invited to ${orgName}`,
    "",
    "Join the team to share the same AI leasing assistant, property details, knowledge base and leads.",
    "",
    "Accept the invitation:",
    link,
    "",
    "This link expires in 7 days and can only be used once.",
    "If you were not expecting it, you can ignore this email.",
    "",
    "Simplr",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Teardown -------------------------------------------------------------

/**
 * Everything an org owns, including the ElevenLabs ids that Convex alone cannot clean up.
 *
 * Read before deleting anything: the agent, knowledge-base documents and RAG indexes live on
 * ElevenLabs, and dropping the Convex rows first would lose the only record of what to delete
 * there — leaving a billable agent and indexes running with nothing pointing at them.
 */
export const orgFootprint = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;

    const agents = (await ctx.db.query("agents").collect()).filter((r) => r.orgId === args.orgId);
    const docs = (await ctx.db.query("docs").collect()).filter((r) => r.orgId === args.orgId);

    return {
      name: org.name,
      elevenLabsAgentIds: agents.map((a) => a.elevenLabsAgentId),
      kbDocs: docs.flatMap((d) =>
        d.kbDocumentId ? [{ docId: d.kbDocumentId, ragIndexId: d.ragIndexId }] : [],
      ),
    };
  },
});

/** Deletes every Convex row belonging to one org. Call only after the ElevenLabs side is gone. */
export const deleteOrgRows = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const counts: Record<string, number> = {};
    const drop = async (table: string, ids: Array<{ _id: never }>) => {
      for (const row of ids) await ctx.db.delete(row._id);
      if (ids.length) counts[table] = ids.length;
    };

    const conversations = (await ctx.db.query("conversations").collect()).filter(
      (r) => r.orgId === args.orgId,
    );
    const conversationIds = new Set(conversations.map((c) => String(c._id)));
    const elevenLabsIds = new Set(
      conversations.flatMap((c) => (c.elevenLabsConversationId ? [c.elevenLabsConversationId] : [])),
    );

    // Children first — messages and qualifications hang off conversations and have no orgId of
    // their own, so deleting the parents first would strand them permanently.
    await drop(
      "messages",
      (await ctx.db.query("messages").collect()).filter((m) =>
        conversationIds.has(String(m.conversationId)),
      ) as never[],
    );
    await drop(
      "qualifications",
      (await ctx.db.query("qualifications").collect()).filter((q) =>
        elevenLabsIds.has(q.elevenLabsConversationId),
      ) as never[],
    );
    await drop("conversations", conversations as never[]);

    for (const table of [
      "agents",
      "docs",
      "properties",
      "screeningQuestions",
      "screeningBuiltins",
      "tenantIssues",
      "tours",
    ] as const) {
      const rows = (await ctx.db.query(table).collect()).filter((r) => r.orgId === args.orgId);
      await drop(table, rows as never[]);
    }

    // New maintenance-era tables. Each has a by_org-prefixed index, so these are indexed reads.
    // Uploaded files are removed from storage too, or they would outlive the team that owned them.
    for (const row of await ctx.db
      .query("maintenanceMedia")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect()) {
      await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
      counts.maintenanceMedia = (counts.maintenanceMedia ?? 0) + 1;
    }
    for (const row of await ctx.db
      .query("workOrderFiles")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect()) {
      await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
      counts.workOrderFiles = (counts.workOrderFiles ?? 0) + 1;
    }
    await drop(
      "workOrderTime",
      (await ctx.db.query("workOrderTime").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[],
    );
    await drop(
      "workOrderExpenses",
      (await ctx.db.query("workOrderExpenses").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[],
    );
    await drop(
      "workOrderNotes",
      (await ctx.db.query("workOrderNotes").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[],
    );
    for (const status of ["created", "assigned", "in_progress", "completed", "reviewed_closed", "cancelled"] as const) {
      await drop(
        "workOrders",
        (await ctx.db
          .query("workOrders")
          .withIndex("by_org_and_status", (q) => q.eq("orgId", args.orgId).eq("status", status))
          .collect()) as never[],
      );
    }
    await drop(
      "maintenanceRequests",
      (await ctx.db
        .query("maintenanceRequests")
        .withIndex("by_org_and_created", (q) => q.eq("orgId", args.orgId))
        .collect()) as never[],
    );
    await drop(
      "residentPhones",
      (await ctx.db
        .query("residentPhones")
        .withIndex("by_org_and_phone", (q) => q.eq("orgId", args.orgId))
        .collect()) as never[],
    );
    await drop(
      "residents",
      (await ctx.db.query("residents").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[],
    );
    await drop(
      "orgCounters",
      (await ctx.db
        .query("orgCounters")
        .withIndex("by_org_and_name", (q) => q.eq("orgId", args.orgId))
        .collect()) as never[],
    );
    await drop(
      "checklistTemplates",
      (await ctx.db
        .query("checklistTemplates")
        .withIndex("by_org_and_issue_type", (q) => q.eq("orgId", args.orgId))
        .collect()) as never[],
    );
    await drop(
      "notificationLog",
      (await ctx.db
        .query("notificationLog")
        .withIndex("by_org_and_created", (q) => q.eq("orgId", args.orgId))
        .collect()) as never[],
    );
    await drop(
      "publicLinks",
      (await ctx.db.query("publicLinks").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[],
    );
    // Sarah configuration and callback tables (all keyed by orgId; the by_org-prefixed indexes make
    // these indexed reads). sarahAttempts is keyed by conversation, so it is read by its by_org index.
    await drop("callbackContacts", (await ctx.db.query("callbackContacts").withIndex("by_org_and_created", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    await drop("sarahAttempts", (await ctx.db.query("sarahAttempts").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    await drop("sarahConfig", (await ctx.db.query("sarahConfig").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    await drop("sarahConfigItems", (await ctx.db.query("sarahConfigItems").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    await drop("sarahConfigAudit", (await ctx.db.query("sarahConfigAudit").withIndex("by_org_and_item", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    await drop("passwordResetRequests", (await ctx.db.query("passwordResetRequests").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    await drop("sarahConfigVersions", (await ctx.db.query("sarahConfigVersions").withIndex("by_org_and_version", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    await drop("sarahPushes", (await ctx.db.query("sarahPushes").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    await drop("tourStaff", (await ctx.db.query("tourStaff").withIndex("by_org_and_category", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    // Tasks and their attachments (uploaded files are removed from storage too).
    for (const row of await ctx.db.query("taskAttachments").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) {
      await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
      counts.taskAttachments = (counts.taskAttachments ?? 0) + 1;
    }
    await drop("tasks", (await ctx.db.query("tasks").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect()) as never[]);
    // SMS/WhatsApp threads: smsMessages has no orgId of its own, so remove them via their threads first.
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_org_and_last_message", (q) => q.eq("orgId", args.orgId))
      .collect();
    for (const thread of threads) {
      for (const msg of await ctx.db
        .query("smsMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .collect()) {
        await ctx.db.delete(msg._id);
        counts.smsMessages = (counts.smsMessages ?? 0) + 1;
      }
    }
    await drop("threads", threads as never[]);
    // Units and the audit trail have no delete path in the app; these purge-only helpers (see
    // units.purgeOrgUnits / audit.purgeOrgAudit) exist solely for tearing down a whole team.
    const unitsDeleted = await purgeOrgUnits(ctx, args.orgId);
    if (unitsDeleted) counts.units = unitsDeleted;
    const auditDeleted = await purgeOrgAudit(ctx, args.orgId);
    if (auditDeleted) counts.auditEvents = auditDeleted;

    await drop(
      "memberships",
      (await ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect()) as never[],
    );
    await drop(
      "invites",
      (await ctx.db
        .query("invites")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect()) as never[],
    );

    await ctx.db.delete(args.orgId);
    counts.organizations = 1;
    return counts;
  },
});

/** Resolves who is being purged, and what that implies, before anything is destroyed. */
export const purgePlan = internalQuery({
  args: { userId: v.optional(v.id("users")), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = args.userId
      ? await ctx.db.get(args.userId)
      : args.email
        ? await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email!.toLowerCase()))
            .first()
        : null;
    if (!user) return null;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    return {
      userId: user._id,
      email: user.email ?? null,
      role: membership?.role ?? null,
      orgId: membership?.orgId ?? null,
      // Single-tenant: the team is shared by everyone, so removing any one person — admin or
      // not — only frees their seat. Tear the team down deliberately with purgeOrg instead.
      deletesTeam: false,
    };
  },
});

/** If the team has members but no admin, promotes the longest-standing member. */
export async function promoteIfNoAdmin(ctx: MutationCtx, orgId: Id<"organizations">) {
  const rest = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  if (rest.length > 0 && !rest.some((r) => r.role === "admin")) {
    const next = rest.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    await ctx.db.patch(next._id, { role: "admin" });
  }
}

/** Deletes the user row plus anything keyed to them that a team deletion did not already take. */
export const deleteUserRows = internalMutation({
  args: { userId: v.id("users"), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Last line of defence for the one-AM-per-unit rule: removeMember checks this too, but
    // purges (operator or Clerk webhook) reach this mutation without going through it.
    const owned = await countOwnedBy(ctx, args.userId);
    if (owned > 0) throw ownsUnitsError(owned);

    const removed = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const m of removed) await ctx.db.delete(m._id);

    // Single-tenant has one team and no ownership transfer, so losing its last admin would lock
    // everyone out of invites and settings. Promote the longest-standing remaining member.
    for (const m of removed.filter((r) => r.role === "admin")) {
      await promoteIfNoAdmin(ctx, m.orgId);
    }

    // Invitations addressed to them. Left behind, a live one would make ensureTeamForUser skip
    // creating a team the next time they sign up, stranding them with no team at all.
    if (args.email) {
      for (const invite of await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", args.email!.toLowerCase()))
        .collect()) {
        await ctx.db.delete(invite._id);
      }
    }

    // purgeUser revokes and removes the Google connection first; this sweeps what is left.
    for (const table of ["googleCalendarConnections", "googleOAuthStates", "tourAvailability"] as const) {
      for (const row of await ctx.db
        .query(table)
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect()) {
        await ctx.db.delete(row._id);
      }
    }

    await ctx.db.delete(args.userId);
  },
});

/**
 * Removes a person completely, so the same email can be invited fresh afterwards.
 *
 * Single-tenant: deleting anyone, admin or member, only frees their seat. The shared team, its
 * data and its ElevenLabs agent are never deleted here (use purgeOrg for that, deliberately).
 *
 * An action rather than a mutation because the ElevenLabs agent, knowledge-base documents and
 * RAG indexes have to be deleted over the network; leaving those behind is what makes a
 * "deleted" account keep costing money.
 *
 * internalAction, emphatically not a public one: this takes no caller identity and deletes an
 * entire team by email. Exposed publicly it would let any client destroy any account's data.
 * `npx convex run` reaches internal functions, so operators keep access and clients do not.
 *
 * Run it with:  npx convex run team:purgeUser '{"email":"someone@example.com"}'
 */
export const purgeUser = internalAction({
  args: {
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const plan = await ctx.runQuery(internal.team.purgePlan, {
      userId: args.userId,
      email: args.email,
    });
    if (!plan) return { found: false };

    const footprint = plan.orgId
      ? await ctx.runQuery(internal.team.orgFootprint, { orgId: plan.orgId })
      : null;

    if (args.dryRun) {
      return { dryRun: true, plan, wouldDeleteFromElevenLabs: plan.deletesTeam ? footprint : null };
    }

    // Their Google tokens are revoked at Google, not just dropped here — a deleted account
    // should not leave Simplr holding working access to someone's calendar.
    await ctx.runAction(internal.googleCalendar.forgetUser, { userId: plan.userId });

    const elevenLabs = { agents: 0, kbDocs: 0, failures: [] as string[] };

    if (plan.deletesTeam && plan.orgId && footprint) {
      // ElevenLabs first, while the Convex rows still record what to delete there.
      for (const doc of footprint.kbDocs) {
        try {
          await el.deleteKbDoc(doc.docId, doc.ragIndexId);
          elevenLabs.kbDocs += 1;
        } catch (err) {
          elevenLabs.failures.push(`kb ${doc.docId}: ${err instanceof Error ? err.message : err}`);
        }
      }
      for (const agentId of footprint.elevenLabsAgentIds) {
        try {
          await el.deleteAgent(agentId);
          elevenLabs.agents += 1;
        } catch (err) {
          elevenLabs.failures.push(`agent ${agentId}: ${err instanceof Error ? err.message : err}`);
        }
      }

      const rows = await ctx.runMutation(internal.team.deleteOrgRows, { orgId: plan.orgId });
      await ctx.runMutation(internal.team.deleteUserRows, {
        userId: plan.userId,
        email: plan.email ?? undefined,
      });
      return { deletedTeam: footprint.name, convexRows: rows, elevenLabs };
    }

    await ctx.runMutation(internal.team.deleteUserRows, {
      userId: plan.userId,
      email: plan.email ?? undefined,
    });
    return { deletedTeam: null, removedSeatOnly: true, elevenLabs };
  },
});

/** Webhook entry point — same teardown as purgeUser, addressed by Clerk id. */
export const purgeByClerkId = internalAction({
  args: { clerkId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const user = await ctx.runQuery(internal.users.byClerkId, { clerkId: args.clerkId });
    if (!user) return;
    await ctx.runAction(internal.team.purgeUser, { userId: user._id });
  },
});

/**
 * Tears down one team directly, by name or id.
 *
 * purgeUser only reaches a team through its admin's membership, so a team whose members have
 * all been removed is unreachable that way — exactly the state a deleted owner used to leave
 * behind. This is the way out of it, and the way to delete a team deliberately.
 *
 * internal for the same reason purgeUser is — it deletes a whole team by name, with no caller
 * check of any kind.
 */
export const purgeOrg = internalAction({
  args: {
    orgId: v.optional(v.id("organizations")),
    name: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const orgId =
      args.orgId ??
      (await ctx.runQuery(internal.team.orgIdByName, { name: args.name ?? "" })) ??
      null;
    if (!orgId) return { found: false };

    const footprint = await ctx.runQuery(internal.team.orgFootprint, { orgId });
    if (!footprint) return { found: false };

    if (args.dryRun) return { dryRun: true, orgId, footprint };

    const elevenLabs = { agents: 0, kbDocs: 0, failures: [] as string[] };
    for (const doc of footprint.kbDocs) {
      try {
        await el.deleteKbDoc(doc.docId, doc.ragIndexId);
        elevenLabs.kbDocs += 1;
      } catch (err) {
        elevenLabs.failures.push(`kb ${doc.docId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    for (const agentId of footprint.elevenLabsAgentIds) {
      try {
        await el.deleteAgent(agentId);
        elevenLabs.agents += 1;
      } catch (err) {
        elevenLabs.failures.push(`agent ${agentId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const rows = await ctx.runMutation(internal.team.deleteOrgRows, { orgId });
    return { deletedTeam: footprint.name, convexRows: rows, elevenLabs };
  },
});

export const orgIdByName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const org = (await ctx.db.query("organizations").collect()).find((o) => o.name === args.name);
    return org?._id ?? null;
  },
});

// --- Pending invite for the signed-in person ------------------------------

/**
 * The invitation waiting for whoever is signed in, if any.
 *
 * Matching on the account's own email rather than on a token is deliberate. The token proves
 * "you received the email"; a signed-in Clerk account proves "you own the address", which is
 * the stronger claim of the two. Requiring the token as well means an invitee who signs up
 * through any other route — the link dropped, they went to the app directly, they signed up
 * first and clicked later — ends up on a team-less dashboard with nothing telling them why.
 */
export const myPendingInvite = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user?.email) return null;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (membership) return null; // already on a team; nothing to offer

    const invite = (
      await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", user.email!.toLowerCase()))
        .collect()
    ).find((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > Date.now());
    if (!invite) return null;

    const org = await ctx.db.get(invite.orgId);
    return { orgName: org?.name ?? "a team", role: invite.role };
  },
});

/** Joins the team that invited this account. Same checks as redeemInvite, minus the token. */
export const acceptPendingInvite = mutation({
  args: {},
  handler: async (ctx): Promise<{ orgName: string }> => {
    const user = await requireUser(ctx);
    const email = user.email?.toLowerCase();
    if (!email) throw new ConvexError("Your account has no email address to match an invite to.");

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const invite = (
      await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    ).find((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > Date.now());
    if (existing && existing.orgId !== invite?.orgId) throw new ConvexError("You already belong to a team.");
    if (!invite) throw new ConvexError("There is no invitation waiting for this account.");

    if (existing) {
      await applyInviteToMembership(ctx, existing, invite);
    } else {
      await ctx.db.insert("memberships", {
        orgId: invite.orgId,
        userId: user._id,
        role: invite.role,
        jobRoles: invite.jobRoles,
        phone: invite.phone,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(invite._id, { acceptedAt: Date.now() });

    const org = await ctx.db.get(invite.orgId);
    return { orgName: org?.name ?? "your team" };
  },
});
