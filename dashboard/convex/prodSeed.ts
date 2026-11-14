import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { tenantOrgId } from "./authz";
import { parseAppRoles } from "./jobRoles";
import { dialableNumber, MAX_ROUTING_ENTRIES, normalizeRoutingEntry } from "./ownerRoutingLib";
import { ownLines } from "./ownerRouting";
import { DEFAULT_PHOTO_EMAILS } from "./photoEmails";
import { storageForRoles } from "./roleSet";
import { defaultConfig, normalizeConfig, stableJson, validateConfigShape } from "./sarahConfigLib";
import type { SarahConfig } from "./sarahConfigLib";
import { speakablePhotoEmail } from "./sarahReplies";
import { assertE164, mergeGrantIntoMembership } from "./team";

/**
 * Production seed (docs/PROD-RUNBOOK.md). Called ONLY by scripts/prod/seedPeople.mjs, one person at a
 * time, after that script has created (or found) the person's Clerk account. Internal, so nothing in
 * the browser can reach it; `npx convex run` with deployment access is the only way in.
 *
 * Passwords never come here: the script generates them, gives them to Clerk and writes them to the
 * operator's local file. This side only learns the Clerk user id and whether the person must change
 * their password (users.mustChangePassword, passwordGate.ts).
 *
 * Roles go on exactly the way an accepted invite puts them on (team.mergeGrantIntoMembership,
 * parseAppRoles / storageForRoles), but no invite row is written and no email is sent.
 *
 * Idempotent: running the same input again changes nothing and says "unchanged".
 */

type PhotoTeam = keyof typeof DEFAULT_PHOTO_EMAILS;
const PHOTO_TEAMS = Object.keys(DEFAULT_PHOTO_EMAILS) as PhotoTeam[];
const AUTO_TEAM_NAME = /('s Team|^My Team)$/;
const MAX_NAME = 80;

function cleanName(raw: string | undefined, what: string): string | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  if (s.length > MAX_NAME) throw new ConvexError(`${what} is too long (max ${MAX_NAME} characters).`);
  return s;
}

function cleanEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ConvexError(`"${raw}" is not a valid email address.`);
  }
  return email;
}

/** What the script sees about the deployment before it creates anyone. */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").take(3);
    const orgId = await tenantOrgId(ctx);
    const org = orgId ? await ctx.db.get(orgId) : null;
    const members = orgId
      ? await ctx.db
          .query("memberships")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      : [];
    return {
      organizations: orgs.length,
      org: org ? { id: org._id, name: org.name } : null,
      members: members.length,
    };
  },
});

/**
 * One person: their users row (keyed by Clerk id), the team (created on a fresh deployment, with the
 * first seeded admin as its creator), their membership and roles, phone, photo email, and the
 * forced-password-change flag.
 */
export const seedPerson = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    roles: v.array(v.string()),
    phone: v.optional(v.string()),
    // Roster team whose photo inbox this asset manager gets (photoEmails.DEFAULT_PHOTO_EMAILS).
    photoTeam: v.optional(v.string()),
    // Only used when the deployment has no team yet.
    orgName: v.optional(v.string()),
    // true when the script just gave this person a temporary password. Omitted = leave the flag as is.
    mustChangePassword: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const clerkId = args.clerkId.trim();
    if (!/^user_[A-Za-z0-9]+$/.test(clerkId)) throw new ConvexError("That is not a Clerk user id (user_...).");
    const email = cleanEmail(args.email);
    const firstName = cleanName(args.firstName, "First name");
    const lastName = cleanName(args.lastName, "Last name");
    const roles = parseAppRoles(args.roles);
    const grant = storageForRoles(roles);
    const phone = args.phone?.trim() ? assertE164(args.phone) : undefined;
    let photoTeam: PhotoTeam | undefined;
    if (args.photoTeam !== undefined && args.photoTeam.trim() !== "") {
      const t = args.photoTeam.trim() as PhotoTeam;
      if (!PHOTO_TEAMS.includes(t)) throw new ConvexError(`photoTeam must be one of ${PHOTO_TEAMS.join(", ")}.`);
      if (!roles.includes("asset_manager")) throw new ConvexError(`${email}: only an asset manager gets a team photo email.`);
      photoTeam = t;
    }

    const user = await upsertUser(ctx, { clerkId, email, firstName, lastName, mustChangePassword: args.mustChangePassword });

    // The team. Single-tenant: the one that already exists, or (fresh deployment) a new one whose
    // creator is this person, who must then be an admin.
    let orgId = await tenantOrgId(ctx);
    let orgResult: "existing" | "created" | "renamed" = "existing";
    const orgName = cleanName(args.orgName, "Team name");
    if (!orgId) {
      if (grant.role !== "admin") {
        throw new ConvexError("This deployment has no team yet. Seed an admin first (the script orders admins first).");
      }
      const now = Date.now();
      orgId = await ctx.db.insert("organizations", {
        name: orgName ?? "518 Property Pro",
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
      orgResult = "created";
    } else if (orgName) {
      // The Clerk webhook may have created the team first (named "<First>'s Team") for this same
      // person; give it the intended name. A team someone already named is never renamed.
      const org = await ctx.db.get(orgId);
      if (org && org.name !== orgName && org.createdBy === user._id && AUTO_TEAM_NAME.test(org.name)) {
        await ctx.db.patch(orgId, { name: orgName, updatedAt: Date.now() });
        orgResult = "renamed";
      }
    }

    // The membership, the way an accepted invite writes it.
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    let membershipResult: "created" | "updated" | "unchanged";
    let membership: Doc<"memberships">;
    let phoneKept: string | null = null;
    if (existing) {
      if (existing.orgId !== orgId) throw new ConvexError(`${email} already belongs to another team.`);
      const jobRoles = [...new Set([...(existing.jobRoles ?? []), ...grant.jobRoles])];
      const role = existing.role === "admin" || grant.role === "admin" ? "admin" : "member";
      const samePhone = (existing.phone ?? phone) === existing.phone;
      const same = role === existing.role && jobRoles.length === (existing.jobRoles ?? []).length && samePhone;
      if (same) {
        membershipResult = "unchanged";
      } else {
        await mergeGrantIntoMembership(ctx, existing, { ...grant, phone }, { actorUserId: user._id, note: "prod seed" });
        membershipResult = "updated";
      }
      if (phone && existing.phone && existing.phone !== phone) phoneKept = "kept the phone already on file";
      membership = (await ctx.db.get(existing._id))!;
    } else {
      const id = await ctx.db.insert("memberships", {
        orgId,
        userId: user._id,
        role: grant.role,
        jobRoles: grant.jobRoles,
        ...(phone ? { phone } : {}),
        createdAt: Date.now(),
      });
      await writeAudit(ctx, {
        orgId,
        entity: "membership",
        entityId: id,
        action: "invite_accepted",
        actorUserId: user._id,
        to: `${grant.role}:${grant.jobRoles.join(",")}`,
        note: "prod seed",
      });
      membershipResult = "created";
      membership = (await ctx.db.get(id))!;
    }

    // Team photo email (only where none is set, the same rule as photoEmails.seedDefaults).
    let photoEmail: "set" | "kept_existing" | "none" = "none";
    if (photoTeam) {
      const address = speakablePhotoEmail(DEFAULT_PHOTO_EMAILS[photoTeam]);
      if (!address) throw new ConvexError(`The ${photoTeam} photo email is not a valid address.`);
      if (membership.photoEmail) {
        photoEmail = "kept_existing";
      } else {
        await ctx.db.patch(membership._id, { photoEmail: address });
        await writeAudit(ctx, {
          orgId,
          entity: "membership",
          entityId: membership._id,
          action: "am_profile_updated",
          note: `fields: photoEmail (seeded for the ${photoTeam} team)`,
        });
        photoEmail = "set";
      }
    }

    return {
      userId: user._id,
      orgId,
      org: orgResult,
      user: user.result,
      membership: membershipResult,
      photoEmail,
      mustChangePassword: (await ctx.db.get(user._id))?.mustChangePassword === true,
      note: phoneKept,
    };
  },
});

async function upsertUser(
  ctx: MutationCtx,
  a: { clerkId: string; email: string; firstName?: string; lastName?: string; mustChangePassword?: boolean },
): Promise<{ _id: Id<"users">; result: "created" | "updated" | "unchanged" }> {
  const byEmail = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", a.email))
    .collect();
  const clash = byEmail.find((u) => u.clerkId !== a.clerkId);
  if (clash) {
    throw new ConvexError(`${a.email} is already on another account in this deployment. Remove that account first.`);
  }
  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", a.clerkId))
    .unique();
  const now = Date.now();
  if (!existing) {
    const id = await ctx.db.insert("users", {
      clerkId: a.clerkId,
      email: a.email,
      ...(a.firstName ? { firstName: a.firstName } : {}),
      ...(a.lastName ? { lastName: a.lastName } : {}),
      ...(a.mustChangePassword !== undefined ? { mustChangePassword: a.mustChangePassword } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return { _id: id, result: "created" };
  }
  const patch: Partial<Doc<"users">> = {};
  if (existing.email !== a.email) patch.email = a.email;
  if (a.firstName && existing.firstName !== a.firstName) patch.firstName = a.firstName;
  if (a.lastName && existing.lastName !== a.lastName) patch.lastName = a.lastName;
  if (a.mustChangePassword !== undefined && existing.mustChangePassword !== a.mustChangePassword) {
    patch.mustChangePassword = a.mustChangePassword;
  }
  if (Object.keys(patch).length === 0) return { _id: existing._id, result: "unchanged" };
  await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
  return { _id: existing._id, result: "updated" };
}

/**
 * Sarah's owner phone menu (routing directory), in key order: key 1 is the first entry. Writes the
 * DRAFT only and leaves the menu's on/off switch as it is (off on a fresh deployment): nothing goes
 * live and nothing is pushed to ElevenLabs until an admin reviews it in /sarah and saves, and the
 * owner_routing call type is switched on and approved. `personEmail` links the team member whose
 * callback list gets messages for that key.
 */
export const seedRoutingDirectory = internalMutation({
  args: {
    entries: v.array(
      v.object({
        key: v.number(),
        label: v.string(),
        phone: v.string(),
        personEmail: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await tenantOrgId(ctx);
    if (!orgId) throw new ConvexError("This deployment has no team yet. Seed the people first.");
    if (args.entries.length === 0) throw new ConvexError("The phone menu needs at least one entry.");
    if (args.entries.length > MAX_ROUTING_ENTRIES) {
      throw new ConvexError(`The menu can have at most ${MAX_ROUTING_ENTRIES} people, one per key from 1 to 9.`);
    }
    const sorted = [...args.entries].sort((a, b) => a.key - b.key);
    sorted.forEach((e, i) => {
      if (e.key !== i + 1) throw new ConvexError("Phone menu keys must run 1, 2, 3 ... with no gaps or repeats.");
    });

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const onTeam = new Set<string>(memberships.map((m) => m.userId));
    const entries: SarahConfig["routingDirectory"]["entries"] = [];
    for (const e of sorted) {
      const label = cleanName(e.label, `Key ${e.key} label`);
      if (!label) throw new ConvexError(`Key ${e.key}: enter the name callers hear.`);
      if (!dialableNumber(e.phone)) throw new ConvexError(`Key ${e.key} (${label}): enter a full 10-digit number, like +15185550100.`);
      let userId: Id<"users"> | undefined;
      if (e.personEmail?.trim()) {
        const email = cleanEmail(e.personEmail);
        const user = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", email))
          .first();
        if (!user || !onTeam.has(user._id)) throw new ConvexError(`Key ${e.key} (${label}): ${email} is not on the team. Seed them first.`);
        userId = user._id;
      }
      entries.push(normalizeRoutingEntry({ label, phone: e.phone, ...(userId ? { userId } : {}) }));
    }

    const row = await ctx.db
      .query("sarahConfig")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const prev = normalizeConfig(row?.draft ?? defaultConfig());
    const next: SarahConfig = {
      ...prev,
      routingDirectory: { ...prev.routingDirectory, entries },
    };
    validateConfigShape(next, { ownLines: ownLines() });
    if (stableJson(prev.routingDirectory) === stableJson(next.routingDirectory)) {
      return { result: "unchanged" as const, keys: entries.length, enabled: next.routingDirectory.enabled };
    }
    if (row) {
      await ctx.db.patch(row._id, { draft: next, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("sarahConfig", { orgId, draft: next, version: 0, updatedAt: Date.now() });
    }
    await writeAudit(ctx, {
      orgId,
      entity: "config",
      entityId: "sarah",
      action: "config_draft_saved",
      note: `prod seed: owner phone menu, ${entries.length} keys (draft only, not live)`,
    });
    return { result: "set" as const, keys: entries.length, enabled: next.routingDirectory.enabled };
  },
});
