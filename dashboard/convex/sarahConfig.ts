import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canManageMaintenance, requireAdminView, requireAdminViewId } from "./authz";
import { writeAudit } from "./audit";
import { LEASING_PROMPT, composePrompt } from "./agents";
import type { ScreeningQuestion } from "./qualifyRules";
import {
  defaultConfig,
  isApprovalRequired,
  normalizeConfig,
  sarahConfigValidator,
  validateConfigShape,
} from "./sarahConfigLib";
import type { SarahConfig } from "./sarahConfigLib";
import { publishedConfig } from "./sarahConfigRead";

/**
 * Sarah configuration (build plan P17).
 *
 * Draft vs published: /sarah edits `draft`. Nothing a caller hears changes until `publish`,
 * which copies the draft to `published`, records a version row, and re-pushes the ElevenLabs
 * agent (agents.pushKnowledgeBase composes the prompt from the PUBLISHED config).
 *
 * Who may do what, all checked here and not only in the UI:
 *   - read: the admin view (admins, Pat, Alex).
 *   - save draft / publish / roll back: a team admin or the maintenance lead.
 *   - approve: only canManageMaintenance (Pat, simplr_admin and team admins).
 * Approval stamps (approvedBy / approvedAt) are NEVER taken from the client: saveDraft carries
 * them over from the stored draft, and drops them when the approved wording itself changed.
 */

const MAX_VERSIONS_SHOWN = 30;

function canEdit(org: { isAdmin: boolean; jobRoles: Doc<"memberships">["jobRoles"] }): boolean {
  return org.isAdmin || canManageMaintenance({ isAdmin: org.isAdmin, jobRoles: org.jobRoles ?? [] });
}

function nameOf(u: Doc<"users"> | null): string {
  if (!u) return "Unknown";
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Unknown";
}

/** Order-independent JSON, so a draft that merely round-tripped through the database compares equal. */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

async function rowFor(ctx: MutationCtx | QueryCtx, orgId: string) {
  return ctx.db
    .query("sarahConfig")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

/**
 * Takes the editable fields from `incoming` and the approval stamps from `prev` (the stored
 * draft), keeping a stamp only while what was approved is unchanged.
 */
function mergeApprovals(incoming: SarahConfig, prev: SarahConfig): SarahConfig {
  const callTypes = incoming.callTypes.map((t) => {
    const p = prev.callTypes.find((x) => x.key === t.key);
    return {
      key: t.key,
      enabled: t.enabled,
      ...(t.notes !== undefined ? { notes: t.notes } : {}),
      ...(p?.approvedBy ? { approvedBy: p.approvedBy, approvedAt: p.approvedAt } : {}),
    };
  });

  const emergencyScripts = incoming.emergencyScripts.map((s) => {
    const p = prev.emergencyScripts.find((x) => x.incident === s.incident);
    const same =
      !!p?.approvedBy &&
      p.wording.trim() === s.wording.trim() &&
      (p.phone ?? "").trim() === (s.phone ?? "").trim();
    return {
      incident: s.incident,
      wording: s.wording,
      ...(s.phone !== undefined ? { phone: s.phone } : {}),
      ...(same ? { approvedBy: p!.approvedBy, approvedAt: p!.approvedAt } : {}),
    };
  });

  const tr = incoming.tenantResponsibility;
  const ptr = prev.tenantResponsibility;
  const trSame =
    ptr.approved &&
    ptr.wording.trim() === tr.wording.trim() &&
    stable(ptr.items) === stable(tr.items);
  const tenantResponsibility = {
    items: tr.items,
    wording: tr.wording,
    approved: trSame,
    ...(trSame && ptr.approvedBy ? { approvedBy: ptr.approvedBy, approvedAt: ptr.approvedAt } : {}),
  };

  return { ...incoming, callTypes, emergencyScripts, tenantResponsibility };
}

/** Server-side lock on the call types that need sign-off. */
function assertApprovals(c: SarahConfig): void {
  for (const t of c.callTypes) {
    if (t.enabled && isApprovalRequired(t.key) && !t.approvedBy) {
      throw new Error(
        `"${t.key.replace(/_/g, " ")}" cannot be enabled until it has been approved. Save the draft, then use Approve.`,
      );
    }
  }
}

// --- Reads --------------------------------------------------------------------------------------

export const get = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const row = await rowFor(ctx, org.orgId);
    const draft = normalizeConfig(row?.draft ?? defaultConfig());
    const published = row?.published ? normalizeConfig(row.published) : null;

    const versions = await ctx.db
      .query("sarahConfigVersions")
      .withIndex("by_org_and_version", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .take(MAX_VERSIONS_SHOWN);
    const versionRows = await Promise.all(
      versions.map(async (r) => ({
        version: r.version,
        publishedAt: r.publishedAt,
        publishedBy: nameOf(await ctx.db.get(r.publishedBy)),
        note: r.note ?? null,
      })),
    );

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const members = (
      await Promise.all(
        memberships.map(async (m) => {
          const u = await ctx.db.get(m.userId);
          return u ? { id: m.userId, name: nameOf(u) } : null;
        }),
      )
    ).filter((m): m is { id: Id<"users">; name: string } => m !== null);

    return {
      exists: row !== null,
      draft,
      published,
      version: row?.version ?? 0,
      publishedAt: row?.publishedAt ?? null,
      // True when the draft differs from what is live (or nothing has ever been published).
      dirty: published === null ? true : stable(draft) !== stable(published),
      canEdit: canEdit(org),
      canApprove: canManageMaintenance(org),
      versions: versionRows,
      members,
    };
  },
});

export const publishedForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<SarahConfig | null> => publishedConfig(ctx, args.orgId),
});

export const draftForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<{ draft: SarahConfig; agentPrompt: string | null }> => {
    const row = await rowFor(ctx, args.orgId);
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    return { draft: normalizeConfig(row?.draft ?? defaultConfig()), agentPrompt: agent?.prompt ?? null };
  },
});

// --- Writes -------------------------------------------------------------------------------------

export const saveDraft = mutation({
  args: { config: sarahConfigValidator },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminView(ctx);
    if (!canEdit(org)) throw new Error("Only a team admin or the maintenance lead can change Sarah.");

    const row = await rowFor(ctx, org.orgId);
    const prev = normalizeConfig(row?.draft ?? defaultConfig());
    const incoming = normalizeConfig(args.config);
    validateConfigShape(incoming);
    const merged = mergeApprovals(incoming, prev);
    assertApprovals(merged);

    // Only people on this team can be escalation contacts.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const onTeam = new Set<string>(memberships.map((m) => m.userId));
    for (const e of merged.escalationContacts) {
      if (e.userIds.some((id) => !onTeam.has(id))) throw new Error("That person is not on your team.");
    }

    if (row) {
      await ctx.db.patch(row._id, { draft: merged, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("sarahConfig", { orgId: org.orgId, draft: merged, version: 0, updatedAt: Date.now() });
    }
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "config",
      entityId: "sarah",
      action: "config_draft_saved",
      actorUserId: org.user._id,
    });
  },
});

export const approve = mutation({
  args: {
    kind: v.union(v.literal("callType"), v.literal("emergencyScript"), v.literal("tenantResponsibility")),
    key: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminView(ctx);
    if (!canManageMaintenance(org)) throw new Error("Only the maintenance lead can approve.");
    const row = await rowFor(ctx, org.orgId);
    if (!row) throw new Error("Save the draft before approving anything.");

    const draft = normalizeConfig(row.draft);
    const by = nameOf(org.user);
    const at = Date.now();

    if (args.kind === "callType") {
      if (!draft.callTypes.some((t) => t.key === args.key)) throw new Error("Unknown call type.");
      draft.callTypes = draft.callTypes.map((t) => (t.key === args.key ? { ...t, approvedBy: by, approvedAt: at } : t));
    } else if (args.kind === "emergencyScript") {
      const s = draft.emergencyScripts.find((x) => x.incident === args.key);
      if (!s) throw new Error("Unknown incident.");
      if (!s.wording.trim()) throw new Error("Write the script before approving it.");
      if (args.key !== "gas_slight" && !(s.phone ?? "").trim()) {
        throw new Error("Add the phone number before approving this script.");
      }
      draft.emergencyScripts = draft.emergencyScripts.map((x) =>
        x.incident === args.key ? { ...x, approvedBy: by, approvedAt: at } : x,
      );
    } else {
      if (!draft.tenantResponsibility.wording.trim()) throw new Error("Write the wording before approving it.");
      draft.tenantResponsibility = { ...draft.tenantResponsibility, approved: true, approvedBy: by, approvedAt: at };
    }

    await ctx.db.patch(row._id, { draft, updatedAt: at });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "config",
      entityId: "sarah",
      action: "config_approved",
      actorUserId: org.user._id,
      note: `${args.kind}: ${args.key}`,
    });
  },
});

/**
 * Makes `config` (the draft, or an older version for rollback) the live one and records it.
 * Runs as one mutation so a version row and the published copy never disagree. The ElevenLabs
 * push happens afterwards, in the action, because mutations cannot call out.
 */
export const commitPublish = internalMutation({
  args: {
    orgId: v.string(),
    userId: v.id("users"),
    rollbackTo: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<number> => {
    const row = await rowFor(ctx, args.orgId);
    let config: SarahConfig;
    if (args.rollbackTo !== undefined) {
      const old = await ctx.db
        .query("sarahConfigVersions")
        .withIndex("by_org_and_version", (q) => q.eq("orgId", args.orgId).eq("version", args.rollbackTo!))
        .first();
      if (!old) throw new Error("That version does not exist.");
      config = normalizeConfig(old.config);
    } else {
      config = normalizeConfig(row?.draft ?? defaultConfig());
    }
    validateConfigShape(config);
    assertApprovals(config);

    const version = (row?.version ?? 0) + 1;
    const now = Date.now();
    await ctx.db.insert("sarahConfigVersions", {
      orgId: args.orgId,
      version,
      config,
      publishedBy: args.userId,
      publishedAt: now,
      note: args.rollbackTo !== undefined ? `Rollback to version ${args.rollbackTo}` : undefined,
    });
    const fields = {
      draft: config,
      published: config,
      publishedAt: now,
      publishedBy: args.userId,
      version,
      updatedAt: now,
    };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("sarahConfig", { orgId: args.orgId, ...fields });

    // The first message is stored on the agent row (Settings shows it), keep it in step.
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    if (agent) {
      await ctx.db.patch(agent._id, { firstMessage: config.identity.firstMessage, updatedAt: now });
    }

    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "config",
      entityId: "sarah",
      action: args.rollbackTo !== undefined ? "config_rolled_back" : "config_published",
      actorUserId: args.userId,
      to: String(version),
      from: args.rollbackTo !== undefined ? String(args.rollbackTo) : undefined,
      note: `version ${version}`,
    });
    return version;
  },
});

// --- Actions (they talk to ElevenLabs) ---------------------------------------------------------------

/** The prompt exactly as it would be sent if the current draft were published now. */
export const preview = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const { orgId } = await requireAdminViewId(ctx);
    const { draft, agentPrompt }: { draft: SarahConfig; agentPrompt: string | null } = await ctx.runQuery(
      internal.sarahConfig.draftForOrg,
      { orgId },
    );
    const questions: ScreeningQuestion[] = await ctx.runQuery(internal.screening.activeForOrg, { orgId });
    const disabledCore: string[] = await ctx.runQuery(internal.screening.disabledBuiltinsForOrg, { orgId });
    return composePrompt(agentPrompt ?? LEASING_PROMPT, questions, disabledCore, draft);
  },
});

async function commitAndPush(
  ctx: Parameters<typeof requireAdminViewId>[0],
  rollbackTo: number | undefined,
): Promise<number> {
  const org = await requireAdminViewId(ctx);
  if (!(org.isAdmin || canManageMaintenance({ isAdmin: org.isAdmin, jobRoles: org.jobRoles }))) {
    throw new Error("Only a team admin or the maintenance lead can publish.");
  }
  // Same guarantee as saveAgent: the team has an agent to push to.
  await ctx.runAction(internal.agents.ensure, { orgId: org.orgId, userId: org.userId });
  const version: number = await ctx.runMutation(internal.sarahConfig.commitPublish, {
    orgId: org.orgId,
    userId: org.userId,
    rollbackTo,
  });
  try {
    await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: org.orgId });
  } catch (err) {
    throw new Error(
      `Saved as version ${version}, but the voice service could not be updated (${
        err instanceof Error ? err.message : String(err)
      }). Publish again to retry.`,
    );
  }
  return version;
}

export const publish = action({
  args: {},
  handler: async (ctx): Promise<number> => commitAndPush(ctx, undefined),
});

export const rollback = action({
  args: { version: v.number() },
  handler: async (ctx, args): Promise<number> => commitAndPush(ctx, args.version),
});
