import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdminView, requireAdminView, requireAdminViewId, viewFor } from "./authz";
import type { JobRole } from "./authz";
import type { SeverityLevel } from "./severity";
import { requireE164 } from "./phone";
import { writeAudit } from "./audit";
import { LEASING_PROMPT, composePrompt } from "./agents";
import type { ScreeningQuestion } from "./qualifyRules";
import {
  allItems,
  cleanText,
  DECISION_DRAFTS,
  decisionText,
  defaultConfig,
  EMERGENCY_BUNDLE_IDS,
  defaultFlows,
  FLOW_DEFS,
  FLOW_KEYS,
  flowOf,
  isApprovalRequired,
  isFlowKey,
  itemStatus,
  isValidPhone,
  isValidPhoneOrExt,
  itemFingerprint,
  normalizeConfig,
  pilotProgress,
  sarahConfigValidator,
  SCRIPT_DRAFTS,
  severityOf,
  SKIP_ESCALATION_ID,
  stableJson,
  TENANT_MESSAGE_KEYS,
  TENANT_RESPONSIBILITY_DRAFT,
  tenantMessagesOf,
  validateConfigShape,
} from "./sarahConfigLib";
import type { FlowKey, ItemExtra, SarahConfig, WorkflowRow } from "./sarahConfigLib";
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
 *   - save draft / publish / roll back: any Admin.
 *   - approve / request changes / reject: anyone in the admin view (team admin, executive, maintenance lead,
 *     simplr_admin). Every action is audited with actor and time; the stamp records who approved.
 * Approval stamps (approvedBy / approvedAt) are NEVER taken from the client: saveDraft carries
 * them over from the stored draft, and drops them when the approved wording itself changed.
 */

const MAX_VERSIONS_SHOWN = 30;

function canEdit(org: { isAdmin: boolean; jobRoles: Doc<"memberships">["jobRoles"] }): boolean {
  return isAdminView(org);
}

function nameOf(u: Doc<"users"> | null): string {
  if (!u) return "Unknown";
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Unknown";
}

const stable = stableJson;

const MAX_WORDING = 2000;
const MAX_ROUTING_ENTRIES = 9; // keys 1-9 on a phone keypad

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
function mergeApprovals(incoming: SarahConfig, prev: SarahConfig, gate = true): SarahConfig {
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

  // Same rule as the emergency scripts: a stamp survives only while the approved wording is unchanged.
  const inMsgs = tenantMessagesOf(incoming);
  const prevMsgs = tenantMessagesOf(prev);
  const tenantMessages = Object.fromEntries(
    TENANT_MESSAGE_KEYS.map((k) => {
      const m = inMsgs[k];
      const p = prevMsgs[k];
      const same = p.approved && !!p.approvedBy && p.wording.trim() === m.wording.trim();
      return [
        k,
        {
          wording: m.wording,
          approved: same,
          ...(same ? { approvedBy: p.approvedBy, approvedAt: p.approvedAt } : {}),
        },
      ];
    }),
  ) as ReturnType<typeof tenantMessagesOf>;

  // Call-type wording: the approval survives only while the wording is unchanged. A flow whose
  // wording is not approved cannot be on, so it is switched off here rather than failing the save.
  const inFlows = incoming.flows ?? defaultFlows();
  const prevFlows = prev.flows ?? defaultFlows();
  const flows = FLOW_KEYS.map((key) => {
    const f = inFlows.find((x) => x.key === key) ?? defaultFlows().find((x) => x.key === key)!;
    const p = prevFlows.find((x) => x.key === key);
    const same = !!p?.approved && !!p.approvedBy && p.wording.trim() === f.wording.trim();
    return {
      key,
      wording: f.wording,
      approved: same,
      ...(same ? { approvedBy: p!.approvedBy, approvedAt: p!.approvedAt } : {}),
    };
  });
  // Admins are not gated: adminStamp approves what they switched on in the same save.
  const gatedCallTypes = gate
    ? callTypes.map((t) => (isFlowKey(t.key) && !flows.find((f) => f.key === t.key)?.approved ? { ...t, enabled: false } : t))
    : callTypes;

  return { ...incoming, callTypes: gatedCallTypes, emergencyScripts, tenantResponsibility, tenantMessages, flows };
}

/** Server-side lock on the call types that need sign-off. */
function assertApprovals(c: SarahConfig): void {
  for (const t of c.callTypes) {
    if (t.enabled && isFlowKey(t.key)) {
      const f = (c.flows ?? []).find((x) => x.key === t.key);
      if (!f?.approved || !f.approvedBy) {
        throw new Error(
          `"${t.key.replace(/_/g, " ")}" cannot be enabled until its wording has been approved. Save the draft, then use Approve.`,
        );
      }
    }
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

    const ex = await extraFor(ctx, org.orgId);
    return {
      exists: row !== null,
      draft,
      published,
      // Every "Missing from Pat" item with its live status (approved ones included, so they stay reachable).
      items: allItems(draft, ex),
      // The five questions the panel shows, with progress.
      progress: pilotProgress(draft, ex),
      version: row?.version ?? 0,
      publishedAt: row?.publishedAt ?? null,
      // True when the draft differs from what is live (or nothing has ever been published).
      dirty: published === null ? true : stable(draft) !== stable(published),
      canEdit: canEdit(org),
      canApprove: canApproveItems(org),
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

/**
 * Read-only escalation rules for the Asset managers page (A6): the PUBLISHED severity levels
 * with their response targets and escalation contacts (names only, no phones), plus the
 * approval flags that decide what the page may claim. "Call forward" is only real when the
 * owner_routing call type is live; owner leads go to Alex only when owner_prospect is live.
 */
export const escalationSummary = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const row = await rowFor(ctx, org.orgId);
    const source = row?.published ?? null;
    const config = normalizeConfig(source ?? row?.draft ?? defaultConfig());

    const names = new Map<string, string>();
    for (const e of config.escalationContacts) {
      for (const id of e.userIds) {
        if (names.has(id)) continue;
        const m = await ctx.db
          .query("memberships")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .first();
        // Only people still on this team: a stale id never leaks another team's name.
        if (m && m.orgId === org.orgId) names.set(id, nameOf(await ctx.db.get(id)));
      }
    }
    // Who owner-prospect leads reach: members with the executive job role (names only).
    const teamMembers = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const ownerRecipients: Array<{ userId: Id<"users">; name: string }> = [];
    for (const m of teamMembers) {
      if (!(m.jobRoles ?? []).includes("executive")) continue;
      ownerRecipients.push({ userId: m.userId, name: nameOf(await ctx.db.get(m.userId)) });
    }
    const callType = (key: string) => config.callTypes.find((t) => t.key === key);
    const ownerRouting = callType("owner_routing");
    const ownerProspect = callType("owner_prospect");
    return {
      published: source !== null, // false = showing the draft because nothing has been published
      levels: config.severityLevels.map((s) => {
        const e = config.escalationContacts.find((x) => x.level === s.level);
        return {
          level: s.level,
          definition: s.definition,
          responseTarget: s.responseTarget,
          contacts: (e?.userIds ?? []).flatMap((id) => (names.has(id) ? [{ userId: id, name: names.get(id)! }] : [])),
          externalContactCount: e?.externalPhones.length ?? 0,
        };
      }),
      callForward: {
        enabled: !!ownerRouting?.enabled && !!ownerRouting.approvedBy && config.routingDirectory.enabled,
        approved: !!ownerRouting?.approvedBy,
      },
      ownerLeads: { enabled: !!ownerProspect?.enabled, recipients: ownerRecipients },
      canEdit: canEdit(org),
    };
  },
});

// --- Writes -------------------------------------------------------------------------------------

export const saveDraft = mutation({
  args: { config: sarahConfigValidator },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminView(ctx);
    if (!canEdit(org)) throw new Error("You don't have access to that.");

    const row = await rowFor(ctx, org.orgId);
    const prev = normalizeConfig(row?.draft ?? defaultConfig());
    const incoming = normalizeConfig(args.config);
    validateConfigShape(incoming);
    const admin = canApproveItems(org);
    let merged = mergeApprovals(incoming, prev, !admin);
    const wfs = await workflowMap(ctx, org.orgId);
    let autoApproved: string[] = [];
    if (admin) {
      // An admin's save re-approves what changed and approves what was switched on.
      const before = fingerprints(prev, wfs);
      const after = fingerprints(merged, wfs);
      const changed = new Set(Object.keys(after).filter((id) => before[id] !== after[id]));
      const res = adminStamp({
        merged,
        prev,
        wfsBefore: wfs,
        wfsAfter: wfs,
        changed,
        targets: new Set(),
        by: nameOf(org.user),
        at: Date.now(),
      });
      merged = res.config;
      autoApproved = res.ids;
      // Tenant texts that were approved stay approved when an admin reworded them.
      const prevMsgs = tenantMessagesOf(prev);
      const msgs = tenantMessagesOf(merged);
      const at = Date.now();
      merged = {
        ...merged,
        tenantMessages: Object.fromEntries(
          TENANT_MESSAGE_KEYS.map((k) => {
            const m = msgs[k];
            const reapprove = prevMsgs[k].approved && !m.approved && m.wording.trim() !== "";
            return [k, reapprove ? { wording: m.wording, approved: true, approvedBy: nameOf(org.user), approvedAt: at } : m];
          }),
        ) as ReturnType<typeof tenantMessagesOf>,
      };
    } else {
      // A tab edit to the severity levels, escalation contacts or routing menu voids their approval.
      if (itemFingerprint(prev, "emergency-type", wfs["emergency-type"]) !== itemFingerprint(merged, "emergency-type", wfs["emergency-type"])) {
        merged = dropCallTypeStamp(merged, "emergency");
      }
      if (itemFingerprint(prev, "owner-routing", wfs["owner-routing"]) !== itemFingerprint(merged, "owner-routing", wfs["owner-routing"])) {
        merged = dropCallTypeStamp(merged, "owner_routing");
      }
    }
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
    await recordAutoApprovals(ctx, org, merged, wfs, autoApproved, AUTO_NOTE);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "config",
      entityId: "sarah",
      action: "config_draft_saved",
      actorUserId: org.user._id,
    });
  },
});

// --- Per-item approval workflow ("Needs approval" modals) ---------------------------------------
//
// draft -> pending_approval -> approved | changes_requested (-> edit -> draft)
//
// Server-enforced, never taken from the client:
//   - orgId always comes from the session (requireAdminView), never from arguments.
//   - edit / submit / reset: anyone in the admin view (executive, maintenance_lead, simplr_admin, team admin).
//   - approve / request changes / reject: the same people (admin view). requireAdminView is the gate, and it is
//     called first in every handler. A single admin may edit AND approve; each action is audited (actor, time)
//     and the approval stamp records who approved. Non-admin views are rejected by requireAdminView.
//   - approving works from draft or pending_approval (no need to submit first).
//   - an approval or submission holds only while the content is unchanged (fingerprint), so any later
//     edit, here or on a tab, drops the item back to draft.

const MAX_NOTE = 1000;
const NOT_ADMIN_MSG = "Only an admin can approve.";

/** Org comes from requireAdminView, which already enforces the admin view; kept as a server-side re-check. */
function canApproveItems(org: { isAdmin: boolean; jobRoles: JobRole[] }): boolean {
  return viewFor(org.isAdmin, org.jobRoles) === "admin";
}

type Org = Awaited<ReturnType<typeof requireAdminView>>;

async function workflowMap(ctx: QueryCtx | MutationCtx, orgId: string): Promise<Record<string, WorkflowRow>> {
  const rows = await ctx.db
    .query("sarahConfigItems")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const out: Record<string, WorkflowRow> = {};
  for (const r of rows) {
    out[r.itemId] = {
      itemId: r.itemId,
      status: r.status,
      fingerprint: r.fingerprint,
      text: r.text,
      lastEditedBy: r.lastEditedBy,
      lastEditedByLabel: r.lastEditedByLabel,
      lastEditedAt: r.lastEditedAt,
      note: r.note,
      noteBy: r.noteBy,
      noteAt: r.noteAt,
      updatedAt: r.updatedAt,
    };
  }
  return out;
}

async function propertyList(ctx: QueryCtx | MutationCtx, orgId: string) {
  const rows = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return rows.map((p) => ({ id: p._id as string, name: p.name, phone: p.utilityGasPhone ?? "" }));
}

async function extraFor(ctx: QueryCtx | MutationCtx, orgId: string): Promise<ItemExtra> {
  return { workflow: await workflowMap(ctx, orgId), properties: await propertyList(ctx, orgId) };
}

/** Replaces (or creates) one workflow row. replace() is used so unset optional fields really go away. */
async function putWorkflow(ctx: MutationCtx, orgId: string, itemId: string, doc: Omit<WorkflowRow, "itemId">) {
  const existing = await ctx.db
    .query("sarahConfigItems")
    .withIndex("by_org_and_item", (q) => q.eq("orgId", orgId).eq("itemId", itemId))
    .first();
  const body = {
    orgId,
    itemId,
    status: doc.status,
    fingerprint: doc.fingerprint,
    ...(doc.text !== undefined ? { text: doc.text } : {}),
    ...(doc.lastEditedBy ? { lastEditedBy: doc.lastEditedBy as Id<"users"> } : {}),
    ...(doc.lastEditedByLabel ? { lastEditedByLabel: doc.lastEditedByLabel } : {}),
    ...(doc.lastEditedAt !== undefined ? { lastEditedAt: doc.lastEditedAt } : {}),
    ...(doc.note ? { note: doc.note } : {}),
    ...(doc.noteBy ? { noteBy: doc.noteBy } : {}),
    ...(doc.noteAt !== undefined ? { noteAt: doc.noteAt } : {}),
    updatedAt: doc.updatedAt,
  };
  if (existing) await ctx.db.replace(existing._id, body);
  else await ctx.db.insert("sarahConfigItems", body);
}

/** One history line (shown in the modal) plus the team-wide audit trail. */
async function logItem(
  ctx: MutationCtx,
  org: { orgId: string; user: Doc<"users"> },
  itemId: string,
  action: string,
  note?: string,
) {
  const name = nameOf(org.user);
  const clean = note ? cleanText(note).slice(0, MAX_NOTE) : undefined;
  await ctx.db.insert("sarahConfigAudit", {
    orgId: org.orgId,
    itemId,
    action,
    actorUserId: org.user._id,
    actorLabel: name,
    ...(clean ? { note: clean } : {}),
    at: Date.now(),
  });
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "config",
    entityId: `sarah:${itemId}`,
    action: `sarah_item_${action}`,
    actorUserId: org.user._id,
    note: clean,
  });
}

async function ensureRow(ctx: MutationCtx, orgId: string) {
  const row = await rowFor(ctx, orgId);
  if (row) return row;
  const id = await ctx.db.insert("sarahConfig", {
    orgId,
    draft: defaultConfig(),
    version: 0,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

const APPROVAL_IDS = (c: SarahConfig) => allItems(c).filter((i) => i.approval).map((i) => i.id);

function fingerprints(c: SarahConfig, wfs: Record<string, WorkflowRow>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of APPROVAL_IDS(c)) out[id] = itemFingerprint(c, id, wfs[id]);
  return out;
}

/** Removes the approval stamp (and switches the call type off) for the two call types that carry one. */
function dropCallTypeStamp(c: SarahConfig, key: "emergency" | "owner_routing"): SarahConfig {
  return {
    ...c,
    callTypes: c.callTypes.map((t) =>
      t.key === key ? { key: t.key, enabled: false, ...(t.notes !== undefined ? { notes: t.notes } : {}) } : t,
    ),
  };
}

async function assertOnTeam(ctx: MutationCtx, orgId: Id<"organizations">, userIds: Id<"users">[]) {
  if (userIds.length === 0) return;
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const onTeam = new Set<string>(memberships.map((m) => m.userId));
  if (userIds.some((id) => !onTeam.has(id))) throw new Error("That person is not on your team.");
}

/**
 * The one write path for edits and resets. Applies `mutate` to a copy of the draft, validates it,
 * strips every approval whose content changed, records the editor and history, and saves.
 */
async function applyChange(
  ctx: MutationCtx,
  org: Org,
  targetId: string,
  action: "edited" | "reset",
  mutate: (draft: SarahConfig) => void | Promise<void>,
  decision?: { id: "am-fallback" | "pilot-flows"; text: string | null },
): Promise<{ changed: boolean }> {
  const row = await ensureRow(ctx, org.orgId);
  const prev = normalizeConfig(row.draft);
  const wfs = await workflowMap(ctx, org.orgId);
  const next: SarahConfig = JSON.parse(JSON.stringify(prev));
  await mutate(next);
  validateConfigShape(next);
  const admin = canApproveItems(org);
  let merged = mergeApprovals(next, prev, !admin);

  const wfsAfter: Record<string, WorkflowRow> = { ...wfs };
  let decisionChanged = false;
  if (decision) {
    const before = decisionText(decision.id, wfs[decision.id]);
    const after = decision.text ?? DECISION_DRAFTS[decision.id];
    decisionChanged = before !== after;
    wfsAfter[decision.id] = {
      ...(wfs[decision.id] ?? { itemId: decision.id, status: "draft", fingerprint: "", updatedAt: 0 }),
      text: decision.text ?? undefined,
    };
  }

  const before = fingerprints(prev, wfs);
  const after = fingerprints(merged, wfsAfter);
  const changedIds = Object.keys(after).filter((id) => before[id] !== after[id]);
  const configChanged = stableJson(prev) !== stableJson(merged);
  if (!configChanged && !decisionChanged) return { changed: false };

  let autoApproved = new Set<string>();
  if (admin && action === "edited") {
    // Saving as an admin re-approves the edited item (and anything approved that changed with it).
    // A reset goes back to the draft wording and stays unapproved.
    const res = adminStamp({
      merged,
      prev,
      wfsBefore: wfs,
      wfsAfter,
      changed: new Set(changedIds),
      targets: new Set([targetId]),
      by: nameOf(org.user),
      at: Date.now(),
    });
    merged = res.config;
    autoApproved = new Set(res.ids);
  } else {
    if (changedIds.includes("emergency-type")) merged = dropCallTypeStamp(merged, "emergency");
    if (changedIds.includes("owner-routing")) merged = dropCallTypeStamp(merged, "owner_routing");
  }
  assertApprovals(merged);

  if (configChanged || changedIds.length > 0 || autoApproved.size > 0) {
    await ctx.db.patch(row._id, { draft: merged, updatedAt: Date.now() });
  }

  const now = Date.now();
  const editorName = nameOf(org.user);
  for (const id of changedIds) {
    await putWorkflow(ctx, org.orgId, id, {
      status: autoApproved.has(id) ? "approved" : "draft",
      fingerprint: after[id],
      text: wfsAfter[id]?.text,
      lastEditedBy: org.user._id,
      lastEditedByLabel: editorName,
      lastEditedAt: now,
      updatedAt: now,
    });
  }
  await logItem(ctx, org, targetId, action);
  for (const id of changedIds) {
    if (id !== targetId) await logItem(ctx, org, id, "edited", `Changed together with ${targetId}`);
  }
  for (const id of autoApproved) await logItem(ctx, org, id, "approved", AUTO_NOTE);
  return { changed: true };
}

function levelsOk(level: string): level is SeverityLevel {
  return severityOf(level) !== null;
}

function cleanPhones(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const p = cleanText(raw);
    if (!p) continue;
    if (!isValidPhone(p) || p === "911") throw new Error(`"${p.slice(0, 40)}" is not a valid phone number.`);
    if (!out.includes(p)) out.push(p);
  }
  if (out.length > 10) throw new Error("Too many outside numbers.");
  return out;
}

const payloadValidator = v.union(
  v.object({ kind: v.literal("text"), wording: v.string(), phone: v.optional(v.string()) }),
  v.object({
    kind: v.literal("gas"),
    phones: v.array(v.object({ propertyId: v.id("properties"), phone: v.string() })),
  }),
  v.object({ kind: v.literal("delia"), name: v.string(), phone: v.string(), hours: v.optional(v.string()) }),
  v.object({
    kind: v.literal("escalation"),
    level: v.string(),
    userIds: v.array(v.id("users")),
    externalPhones: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("routing"),
    entries: v.array(v.object({ label: v.string(), phone: v.string(), hours: v.optional(v.string()) })),
    fallback: v.string(),
    afterHours: v.string(),
  }),
  v.object({
    kind: v.literal("severity"),
    levels: v.array(
      v.object({ level: v.string(), definition: v.string(), examples: v.string(), responseTarget: v.string() }),
    ),
    escalation: v.array(v.object({ level: v.string(), userIds: v.array(v.id("users")), externalPhones: v.array(v.string()) })),
  }),
);

const MODAL_FOR_KIND: Record<string, string[]> = {
  text: ["text"],
  gas: ["contacts"],
  delia: ["contacts"],
  escalation: ["contacts"],
  routing: ["routing"],
  severity: ["severity"],
};

/** Saves an edit made in the item modal. Saving resets the item to draft and clears its approval. */
export const saveItem = mutation({
  args: { itemId: v.string(), payload: payloadValidator },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    const org = await requireAdminView(ctx);
    const id = args.itemId;
    const p = args.payload;
    const row = await rowFor(ctx, org.orgId);
    const def = allItems(normalizeConfig(row?.draft ?? defaultConfig())).find((i) => i.id === id);
    if (!def) throw new Error("Unknown item.");
    if (!MODAL_FOR_KIND[p.kind].includes(def.modal)) throw new Error("That edit does not belong to this item.");

    if (p.kind === "text") {
      const wording = cleanText(p.wording);
      if (!wording) throw new Error("Write the wording first.");
      if (wording.length > MAX_WORDING) throw new Error(`Wording can be at most ${MAX_WORDING} characters.`);
      if (id === "am-fallback" || id === "pilot-flows") {
        return applyChange(ctx, org, id, "edited", () => {}, { id, text: wording });
      }
      if (id.startsWith("script-")) {
        const incident = id.slice(7);
        const phone = p.phone === undefined ? undefined : cleanText(p.phone);
        if (phone && !isValidPhone(phone)) throw new Error("Enter a valid phone number, like 518-365-0996, or 911.");
        return applyChange(ctx, org, id, "edited", (d) => {
          d.emergencyScripts = d.emergencyScripts.map((s) => {
            if (s.incident !== incident) return s;
            const keepPhone = incident === "gas_slight" ? s.phone : phone;
            return { incident: s.incident, wording, ...(keepPhone ? { phone: keepPhone } : {}), ...stampOf0(s) };
          });
        });
      }
      if (id === "tenant-responsibility") {
        return applyChange(ctx, org, id, "edited", (d) => {
          d.tenantResponsibility = { ...d.tenantResponsibility, wording };
        });
      }
      if (id.startsWith("flow-")) {
        const key = id.slice(5);
        if (!isFlowKey(key)) throw new Error("Unknown call type.");
        return applyChange(ctx, org, id, "edited", (d) => {
          d.flows = FLOW_KEYS.map((k) => (k === key ? { ...flowOf(d, k), wording } : flowOf(d, k)));
        });
      }
      throw new Error("That item has no wording to edit.");
    }

    if (p.kind === "gas") {
      if (id !== "utility-number") throw new Error("That edit does not belong to this item.");
      let changed = 0;
      for (const entry of p.phones) {
        const prop = await ctx.db.get(entry.propertyId);
        if (!prop || prop.orgId !== org.orgId) throw new Error("Property not found.");
        const raw = cleanText(entry.phone);
        const next = raw === "" ? undefined : requireE164(raw, `Gas utility number for ${prop.name}`);
        if ((prop.utilityGasPhone ?? undefined) === next) continue;
        await ctx.db.patch(prop._id, { utilityGasPhone: next, updatedAt: Date.now() });
        changed++;
      }
      if (changed > 0) await logItem(ctx, org, id, "edited", `Updated ${changed} property number${changed === 1 ? "" : "s"}`);
      return { changed: changed > 0 };
    }

    if (p.kind === "delia") {
      if (id !== "delia-contact") throw new Error("That edit does not belong to this item.");
      const name = cleanText(p.name) || "Delia (Accounting)";
      const phone = cleanText(p.phone);
      const hours = cleanText(p.hours ?? "");
      if (name.length > 100) throw new Error("Name is too long.");
      if (hours.length > 200) throw new Error("Hours are too long.");
      if (phone && !isValidPhoneOrExt(phone)) throw new Error("Enter a valid phone number or extension.");
      return applyChange(ctx, org, id, "edited", (d) => {
        const entry = { label: name, phone, ...(hours ? { hours } : {}) };
        const idx = d.routingDirectory.entries.findIndex((e) => /delia/i.test(e.label));
        if (idx >= 0) d.routingDirectory.entries[idx] = entry;
        else d.routingDirectory.entries.push(entry);
        if (d.routingDirectory.entries.some((e) => !e.phone.trim())) d.routingDirectory.enabled = false;
      });
    }

    if (p.kind === "escalation") {
      if (!id.startsWith("escalation-") || id.slice(11) !== p.level || !levelsOk(p.level)) {
        throw new Error("That edit does not belong to this item.");
      }
      await assertOnTeam(ctx, org.orgId, p.userIds);
      const externalPhones = cleanPhones(p.externalPhones);
      const userIds = [...new Set(p.userIds)];
      return applyChange(ctx, org, id, "edited", (d) => {
        d.escalationContacts = d.escalationContacts.map((e) => (e.level === p.level ? { level: e.level, userIds, externalPhones } : e));
      });
    }

    if (p.kind === "routing") {
      if (id !== "routing-phones" && id !== "owner-routing") throw new Error("That edit does not belong to this item.");
      if (p.entries.length > MAX_ROUTING_ENTRIES) throw new Error(`The menu can have at most ${MAX_ROUTING_ENTRIES} entries.`);
      const entries = p.entries.map((e) => {
        const label = cleanText(e.label);
        if (!label) throw new Error("Every entry needs a name.");
        if (label.length > 100) throw new Error("A name is too long.");
        const phone = cleanText(e.phone);
        if (phone && !isValidPhoneOrExt(phone)) throw new Error(`"${phone.slice(0, 40)}" is not a valid phone number or extension.`);
        const hours = cleanText(e.hours ?? "");
        if (hours.length > 200) throw new Error("Hours are too long.");
        return { label, phone, ...(hours ? { hours } : {}) };
      });
      const fallback = cleanText(p.fallback);
      const afterHours = cleanText(p.afterHours);
      if (fallback.length > MAX_NOTE || afterHours.length > MAX_NOTE) throw new Error("Fallback and after-hours text can be at most 1000 characters.");
      return applyChange(ctx, org, id, "edited", (d) => {
        d.routingDirectory = {
          enabled: d.routingDirectory.enabled && entries.every((e) => e.phone !== ""),
          entries,
          ...(fallback ? { fallback } : {}),
          ...(afterHours ? { afterHours } : {}),
        };
      });
    }

    // severity
    if (id !== "emergency-type" && id !== "severity-signoff") throw new Error("That edit does not belong to this item.");
    for (const l of p.levels) if (!levelsOk(l.level)) throw new Error("Unknown severity level.");
    for (const e of p.escalation) if (!levelsOk(e.level)) throw new Error("Unknown severity level.");
    await assertOnTeam(ctx, org.orgId, p.escalation.flatMap((e) => e.userIds));
    const escalation = p.escalation.map((e) => ({ level: e.level as SeverityLevel, userIds: [...new Set(e.userIds)], externalPhones: cleanPhones(e.externalPhones) }));
    const levels = p.levels.map((l) => {
      const definition = cleanText(l.definition);
      if (!definition) throw new Error("Every severity level needs a definition.");
      return { level: l.level as SeverityLevel, definition, examples: cleanText(l.examples), responseTarget: cleanText(l.responseTarget) };
    });
    return applyChange(ctx, org, id, "edited", (d) => {
      d.severityLevels = d.severityLevels.map((s) => levels.find((l) => l.level === s.level) ?? s);
      d.escalationContacts = d.escalationContacts.map((e) => escalation.find((x) => x.level === e.level) ?? e);
    });
  },
});

/** The stamp fields of a script, so a rebuilt script object keeps them until mergeApprovals decides. */
function stampOf0(s: { approvedBy?: string; approvedAt?: number }) {
  return s.approvedBy ? { approvedBy: s.approvedBy, approvedAt: s.approvedAt } : {};
}

/**
 * "Delete" in the modal. Clears custom wording back to the draft default and turns the item off
 * (the UI calls it "Reset to draft" for required items). Gas utility numbers live on the properties
 * and are cleared one property at a time, so they cannot be reset here.
 */
export const resetItem = mutation({
  args: { itemId: v.string() },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    const org = await requireAdminView(ctx);
    const id = args.itemId;
    const d0 = defaultConfig();
    const row = await rowFor(ctx, org.orgId);
    const def = allItems(normalizeConfig(row?.draft ?? d0)).find((i) => i.id === id);
    if (!def) throw new Error("Unknown item.");
    if (id === "utility-number") throw new Error("Clear a property's number by emptying its field and saving.");

    if (id === "am-fallback" || id === "pilot-flows") {
      return applyChange(ctx, org, id, "reset", () => {}, { id, text: null });
    }
    return applyChange(ctx, org, id, "reset", (d) => {
      if (id.startsWith("script-")) {
        const incident = id.slice(7) as keyof typeof SCRIPT_DRAFTS;
        const dflt = SCRIPT_DRAFTS[incident];
        d.emergencyScripts = d.emergencyScripts.map((s) =>
          s.incident === incident ? { incident, wording: dflt.wording, ...(dflt.phone ? { phone: dflt.phone } : {}) } : s,
        );
      } else if (id === "tenant-responsibility") {
        d.tenantResponsibility = { ...d.tenantResponsibility, wording: TENANT_RESPONSIBILITY_DRAFT, approved: false };
        d.callTypes = d.callTypes.map((t) => (t.key === "maint_tenant_responsibility" ? { ...t, enabled: false } : t));
      } else if (id.startsWith("flow-")) {
        const key = id.slice(5);
        if (!isFlowKey(key)) throw new Error("Unknown call type.");
        const dflt = FLOW_DEFS.find((f) => f.key === key)!.wording;
        d.flows = FLOW_KEYS.map((k) => (k === key ? { key: k, wording: dflt, approved: false } : flowOf(d, k)));
        d.callTypes = d.callTypes.map((t) => (t.key === key ? { ...t, enabled: false } : t));
      } else if (id === "delia-contact") {
        const idx = d.routingDirectory.entries.findIndex((e) => /delia/i.test(e.label));
        if (idx >= 0) d.routingDirectory.entries[idx] = { label: d.routingDirectory.entries[idx].label, phone: "" };
        d.routingDirectory.enabled = false;
      } else if (id.startsWith("escalation-")) {
        const level = id.slice(11);
        d.escalationContacts = d.escalationContacts.map((e) => (e.level === level ? { level: e.level, userIds: [], externalPhones: [] } : e));
      } else if (id === "routing-phones" || id === "owner-routing") {
        d.routingDirectory = { enabled: false, entries: d0.routingDirectory.entries };
        d.callTypes = d.callTypes.map((t) => (t.key === "owner_routing" ? { ...t, enabled: false } : t));
      } else if (id === "emergency-type" || id === "severity-signoff") {
        d.severityLevels = d0.severityLevels;
        d.escalationContacts = d0.escalationContacts;
        if (id === "emergency-type") d.callTypes = d.callTypes.map((t) => (t.key === "emergency" ? { ...t, enabled: false } : t));
      }
    });
  },
});

export const submitItem = mutation({
  args: { itemId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminView(ctx);
    const row = await ensureRow(ctx, org.orgId);
    const draft = normalizeConfig(row.draft);
    const ex = await extraFor(ctx, org.orgId);
    const def = allItems(draft, ex).find((i) => i.id === args.itemId);
    if (!def) throw new Error("Unknown item.");
    if (!def.approval) throw new Error("This item does not need approval.");
    if (def.status === "approved") throw new Error("This item is already approved.");
    if (def.status === "pending_approval") throw new Error("This item is already waiting for approval.");
    assertHasContent(draft, def.id, ex.workflow[def.id]);
    const wf = ex.workflow[def.id];
    const now = Date.now();
    await putWorkflow(ctx, org.orgId, def.id, {
      status: "pending_approval",
      fingerprint: itemFingerprint(draft, def.id, wf),
      text: wf?.text,
      lastEditedBy: wf?.lastEditedBy,
      lastEditedByLabel: wf?.lastEditedByLabel,
      lastEditedAt: wf?.lastEditedAt,
      updatedAt: now,
    });
    await logItem(ctx, org, def.id, "submitted");
  },
});

function assertHasContent(draft: SarahConfig, id: string, wf?: WorkflowRow) {
  if (id.startsWith("script-")) {
    const s = draft.emergencyScripts.find((x) => x.incident === id.slice(7));
    if (!s?.wording.trim()) throw new Error("Write the script before sending it for approval.");
    if (id !== "script-gas_slight" && !(s.phone ?? "").trim()) throw new Error("Add the phone number first.");
  } else if (id === "tenant-responsibility") {
    if (!draft.tenantResponsibility.wording.trim()) throw new Error("Write the wording first.");
  } else if (id.startsWith("flow-")) {
    if (!flowOf(draft, id.slice(5) as FlowKey).wording.trim()) throw new Error("Write the wording first.");
  } else if (id === "am-fallback" || id === "pilot-flows") {
    if (!decisionText(id, wf).trim()) throw new Error("Write the proposal first.");
  }
}

/** Stamps the approval into the draft config for the items that carry one there. */
function stampApproval(draft: SarahConfig, id: string, by: string, at: number): SarahConfig {
  if (id === "emergency-type" || id === "owner-routing") {
    const key = id === "emergency-type" ? "emergency" : "owner_routing";
    return { ...draft, callTypes: draft.callTypes.map((t) => (t.key === key ? { ...t, approvedBy: by, approvedAt: at } : t)) };
  }
  if (id.startsWith("script-")) {
    return {
      ...draft,
      emergencyScripts: draft.emergencyScripts.map((s) => (s.incident === id.slice(7) ? { ...s, approvedBy: by, approvedAt: at } : s)),
    };
  }
  if (id === "tenant-responsibility") {
    return { ...draft, tenantResponsibility: { ...draft.tenantResponsibility, approved: true, approvedBy: by, approvedAt: at } };
  }
  if (id.startsWith("flow-")) {
    const key = id.slice(5);
    return { ...draft, flows: FLOW_KEYS.map((k) => (k === key ? { ...flowOf(draft, k), approved: true, approvedBy: by, approvedAt: at } : flowOf(draft, k))) };
  }
  return draft;
}

/** Removes an item's stamp (request changes on an approved item). Call types are also switched off. */
function clearApproval(draft: SarahConfig, id: string): SarahConfig {
  if (id === "emergency-type") return dropCallTypeStamp(draft, "emergency");
  if (id === "owner-routing") return dropCallTypeStamp(draft, "owner_routing");
  if (id.startsWith("script-")) {
    return {
      ...draft,
      emergencyScripts: draft.emergencyScripts.map((s) =>
        s.incident === id.slice(7) ? { incident: s.incident, wording: s.wording, ...(s.phone !== undefined ? { phone: s.phone } : {}) } : s,
      ),
    };
  }
  if (id === "tenant-responsibility") {
    return {
      ...draft,
      tenantResponsibility: { items: draft.tenantResponsibility.items, wording: draft.tenantResponsibility.wording, approved: false },
      callTypes: draft.callTypes.map((t) => (t.key === "maint_tenant_responsibility" ? { ...t, enabled: false } : t)),
    };
  }
  if (id.startsWith("flow-")) {
    const key = id.slice(5);
    return {
      ...draft,
      flows: FLOW_KEYS.map((k) => (k === key ? { key: k, wording: flowOf(draft, k).wording, approved: false } : flowOf(draft, k))),
      callTypes: draft.callTypes.map((t) => (t.key === key ? { ...t, enabled: false } : t)),
    };
  }
  return draft;
}

// --- Admin auto-approval ------------------------------------------------------------------------
//
// Every person who can reach this module is an Admin (requireAdminView), and an Admin has full
// power, so a separate sign-off step only adds friction. An admin's save re-approves what changed,
// switching a call type on approves its current wording, and publish approves whatever is still a
// draft among the things that are switched on. All of it is audited with the actor and the time.

const AUTO_NOTE = "Approved automatically (admin)";
const ADMIN_NOTE = "Approved on the admin's instruction";

/** Whether switching this item's call type on makes its approval required (so an admin's save stamps it). */
function enabledNeedsApproval(c: SarahConfig, id: string): boolean {
  const on = (key: string) => c.callTypes.find((t) => t.key === key)?.enabled === true;
  if (id.startsWith("flow-")) return on(id.slice(5));
  if (id.startsWith("script-") || id === "emergency-type" || id === "severity-signoff") return on("emergency");
  if (id === "owner-routing") return on("owner_routing");
  if (id === "tenant-responsibility") return on("maint_tenant_responsibility");
  return false;
}

function hasContent(c: SarahConfig, id: string, wf?: WorkflowRow): boolean {
  try {
    assertHasContent(c, id, wf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure. Re-approves, for an admin, (a) every item whose content changed and that was approved
 * before or is the item being edited, and (b) every item whose call type is switched on and is not
 * approved yet. Items without content (empty wording, script without a number) are left alone.
 */
function adminStamp(args: {
  merged: SarahConfig;
  prev: SarahConfig;
  wfsBefore: Record<string, WorkflowRow>;
  wfsAfter: Record<string, WorkflowRow>;
  changed: Set<string>;
  targets: Set<string>;
  by: string;
  at: number;
}): { config: SarahConfig; ids: string[] } {
  let c = args.merged;
  const ids: string[] = [];
  for (const item of allItems(c)) {
    if (!item.approval) continue;
    const id = item.id;
    const wf = args.wfsAfter[id];
    let needs: boolean;
    if (args.changed.has(id)) {
      const was = itemStatus(args.prev, id, true, { workflow: args.wfsBefore, properties: [] }) === "approved";
      needs = was || args.targets.has(id) || enabledNeedsApproval(c, id);
    } else {
      needs = itemStatus(c, id, true, { workflow: args.wfsAfter, properties: [] }) !== "approved" && enabledNeedsApproval(c, id);
    }
    if (!needs || !hasContent(c, id, wf)) continue;
    c = stampApproval(c, id, args.by, args.at);
    ids.push(id);
  }
  return { config: c, ids };
}

/** Writes the approved workflow row and the audit line for each auto-approved item. */
async function recordAutoApprovals(
  ctx: MutationCtx,
  org: { orgId: string; user: Doc<"users"> },
  config: SarahConfig,
  wfs: Record<string, WorkflowRow>,
  ids: string[],
  note: string,
) {
  const now = Date.now();
  const name = nameOf(org.user);
  for (const id of ids) {
    const wf = wfs[id];
    await putWorkflow(ctx, org.orgId, id, {
      status: "approved",
      fingerprint: itemFingerprint(config, id, wf),
      text: wf?.text,
      lastEditedBy: wf?.lastEditedBy ?? org.user._id,
      lastEditedByLabel: wf?.lastEditedByLabel ?? name,
      lastEditedAt: wf?.lastEditedAt ?? now,
      updatedAt: now,
    });
    await logItem(ctx, org, id, "approved", note);
  }
}

async function approveCore(ctx: MutationCtx, org: Org, itemId: string, expectedFingerprint?: string, note?: string): Promise<void> {
  if (!canApproveItems(org)) {
    throw new Error(NOT_ADMIN_MSG);
  }
  const row = await ensureRow(ctx, org.orgId);
  let draft = normalizeConfig(row.draft);
  const ex = await extraFor(ctx, org.orgId);
  const def = allItems(draft, ex).find((i) => i.id === itemId);
  if (!def) throw new Error("Unknown item.");
  if (!def.approval) throw new Error("This item does not need approval.");
  if (def.status === "approved") return;
  const wf = ex.workflow[itemId];
  const fp = itemFingerprint(draft, itemId, wf);
  if (expectedFingerprint !== undefined && expectedFingerprint !== fp) {
    throw new Error("This item changed after you opened it. Close it, open it again and review the new version.");
  }
  assertHasContent(draft, itemId, wf);
  const now = Date.now();
  const by = nameOf(org.user);
  const stamped = stampApproval(draft, itemId, by, now);
  if (stamped !== draft) {
    draft = stamped;
    await ctx.db.patch(row._id, { draft, updatedAt: now });
  }
  await putWorkflow(ctx, org.orgId, itemId, {
    status: "approved",
    fingerprint: fp,
    text: wf?.text,
    lastEditedBy: wf?.lastEditedBy,
    lastEditedByLabel: wf?.lastEditedByLabel,
    lastEditedAt: wf?.lastEditedAt,
    updatedAt: now,
  });
  await logItem(ctx, org, itemId, "approved", note);
}

export const approveItem = mutation({
  args: { itemId: v.string(), fingerprint: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminView(ctx);
    await approveCore(ctx, org, args.itemId, args.fingerprint);
  },
});

const BUNDLE_LABEL: Record<string, string> = {
  "script-fire": "Fire or smoke",
  "script-flooding": "Flooding",
  "script-gas_hissing": "Gas smell with hissing",
  "script-gas_slight": "Slight gas smell",
  "script-other": "Anything else life-threatening",
  "emergency-type": "Severity levels",
  "severity-signoff": "Severity levels",
};

/**
 * Approve the whole emergency card at once: every one of the 7 underlying items goes through
 * approveCore, so the same rules apply to each (role, "not your own last edit", content checks,
 * fingerprint of what the person was looking at). All or nothing: any failure rolls everything back.
 */
export const approveBundle = mutation({
  args: { items: v.array(v.object({ itemId: v.string(), fingerprint: v.string() })) },
  handler: async (ctx, args): Promise<{ approved: number }> => {
    const org = await requireAdminView(ctx);
    if (!canApproveItems(org)) {
      throw new Error(NOT_ADMIN_MSG);
    }
    const allowed = new Set<string>(EMERGENCY_BUNDLE_IDS);
    const seen = new Set<string>();
    for (const it of args.items) {
      if (!allowed.has(it.itemId) || seen.has(it.itemId)) throw new Error("That item is not part of this card.");
      seen.add(it.itemId);
    }
    let approved = 0;
    for (const id of EMERGENCY_BUNDLE_IDS) {
      const it = args.items.find((x) => x.itemId === id);
      if (!it) continue;
      try {
        await approveCore(ctx, org, id, it.fingerprint);
        approved++;
      } catch (e) {
        throw new Error(`${BUNDLE_LABEL[id] ?? id}: ${e instanceof Error ? e.message : "could not approve."}`);
      }
    }
    return { approved };
  },
});

/**
 * What "Approve all drafts" covers: the five emergency scripts, emergency handling, the severity
 * sign-off, the tenant-responsibility wording and every config-driven call type whose wording comes
 * from the Sarah Configuration document. Not included, because they lack data or conflict with the
 * PRD: vendor payment (no contact for Delia) and the owner routing menu.
 */
const ADMIN_BULK_IDS: string[] = [
  ...EMERGENCY_BUNDLE_IDS,
  "tenant-responsibility",
  ...FLOW_KEYS.filter((k) => k !== "vendor_payment").map((k) => `flow-${k}`),
];

/** Call types the one-time approval also switches on (each one's wording and data are complete). */
const ADMIN_ENABLE_KEYS: string[] = [
  "emergency",
  "maint_tenant_responsibility",
  "neighbor_dispute",
  "rent_fees",
  "application",
  "portal_login",
  "eviction",
  "non_renewal",
  "work_order_status",
  "renewal",
];

/** Idempotent: approves every draft in ADMIN_BULK_IDS and, when asked, switches the call types on. */
async function approveAllCore(
  ctx: MutationCtx,
  org: Org,
  opts: { enable: boolean; note: string },
): Promise<{ approved: string[]; enabled: string[] }> {
  if (!canApproveItems(org)) throw new Error(NOT_ADMIN_MSG);
  const approved: string[] = [];
  for (const id of ADMIN_BULK_IDS) {
    const row = await ensureRow(ctx, org.orgId);
    const ex = await extraFor(ctx, org.orgId);
    const item = allItems(normalizeConfig(row.draft), ex).find((i) => i.id === id);
    if (!item || item.status === "approved") continue;
    await approveCore(ctx, org, id, undefined, opts.note);
    approved.push(id);
  }
  const enabled: string[] = [];
  if (opts.enable) {
    const row = await ensureRow(ctx, org.orgId);
    const draft = normalizeConfig(row.draft);
    const toEnable = ADMIN_ENABLE_KEYS.filter((k) => draft.callTypes.find((t) => t.key === k)?.enabled !== true);
    if (toEnable.length > 0) {
      const callTypes = draft.callTypes.map((t) => (toEnable.includes(t.key) ? { ...t, enabled: true } : t));
      const next = { ...draft, callTypes };
      validateConfigShape(next);
      assertApprovals(next);
      await ctx.db.patch(row._id, { draft: next, updatedAt: Date.now() });
      enabled.push(...toEnable);
    }
  }
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "config",
    entityId: "sarah",
    action: "config_approved_all",
    actorUserId: org.user._id,
    note: `${opts.note}. Approved ${approved.length}, switched on ${enabled.length}.`,
  });
  return { approved, enabled };
}

/** "Approve all drafts" button: approves every draft listed above for the caller's team. Switches nothing on. */
export const approveAllDrafts = mutation({
  args: {},
  handler: async (ctx): Promise<{ approved: number }> => {
    const org = await requireAdminView(ctx);
    const res = await approveAllCore(ctx, org, { enable: false, note: "Approved all drafts by an admin" });
    return { approved: res.approved.length };
  },
});

/**
 * One-time approval by instruction of the admin (run from the CLI: npx convex run). Internal only,
 * attributed to `actorUserId`, who must be an admin of the team. Approves the drafts above and
 * switches the finished call types on. Safe to run again.
 */
export const adminApproveAll = internalMutation({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users") },
  handler: async (ctx, args): Promise<{ approved: string[]; enabled: string[] }> => {
    const user = await ctx.db.get(args.actorUserId);
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.actorUserId))
      .first();
    if (!user || !member || member.orgId !== args.orgId) throw new Error("That user is not on this team.");
    const isAdmin = member.role === "admin";
    const org: Org = { orgId: args.orgId, role: member.role, isAdmin, jobRoles: member.jobRoles ?? [], user };
    return approveAllCore(ctx, org, { enable: true, note: ADMIN_NOTE });
  },
});

/** "Skip, admins only" on the extra-alerts question. Admins are always texted; this only records the answer. */
export const setEscalationSkip = mutation({
  args: { skip: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminView(ctx);
    const existing = await ctx.db
      .query("sarahConfigItems")
      .withIndex("by_org_and_item", (q) => q.eq("orgId", org.orgId).eq("itemId", SKIP_ESCALATION_ID))
      .first();
    if (args.skip) {
      const now = Date.now();
      await putWorkflow(ctx, org.orgId, SKIP_ESCALATION_ID, {
        status: "approved",
        fingerprint: "skip",
        lastEditedBy: org.user._id,
        lastEditedByLabel: nameOf(org.user),
        lastEditedAt: now,
        updatedAt: now,
      });
    } else if (existing) {
      await ctx.db.delete(existing._id);
    }
    await logItem(ctx, org, "escalation-emergency", args.skip ? "skipped" : "unskipped");
  },
});

/** What the emergency card's modal shows: five scripts and the severity levels, with each one's state. */
export const emergencyBundle = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const row = await rowFor(ctx, org.orgId);
    const draft = normalizeConfig(row?.draft ?? defaultConfig());
    const ex = await extraFor(ctx, org.orgId);
    const items = allItems(draft, ex);
    const statusOf = (id: string) => items.find((i) => i.id === id)!.status;
    const fps = EMERGENCY_BUNDLE_IDS.map((id) => ({ itemId: id, fingerprint: itemFingerprint(draft, id, ex.workflow[id]) }));

    const scripts = draft.emergencyScripts.map((s) => ({
      id: `script-${s.incident}`,
      label: BUNDLE_LABEL[`script-${s.incident}`] ?? s.incident,
      wording: s.wording,
      phone: s.phone ?? "",
      status: statusOf(`script-${s.incident}`),
    }));
    const sevStatuses = [statusOf("emergency-type"), statusOf("severity-signoff")];
    const severityStatus =
      sevStatuses.every((x) => x === "approved")
        ? "approved"
        : sevStatuses.includes("changes_requested")
          ? "changes_requested"
          : sevStatuses.includes("pending_approval")
            ? "pending_approval"
            : "draft";
    const members = await teamMembers(ctx, org.orgId);
    const nameById = new Map(members.map((m) => [m.id as string, m.name]));
    const levels = draft.severityLevels.map((l) => {
      const e = draft.escalationContacts.find((x) => x.level === l.level);
      const alerted = [
        ...(e?.userIds ?? []).map((u) => nameById.get(u as string) ?? "Team member"),
        ...(e?.externalPhones ?? []),
      ];
      return { level: l.level, definition: l.definition, examples: l.examples, responseTarget: l.responseTarget, alerted };
    });

    const approveBlocked: string | null = canApproveItems(org) ? null : NOT_ADMIN_MSG;

    return {
      scripts,
      severity: { status: severityStatus, levels },
      fingerprints: fps,
      allApproved: EMERGENCY_BUNDLE_IDS.every((id) => statusOf(id) === "approved"),
      canApprove: canApproveItems(org),
      approveBlocked,
    };
  },
});

/** Request changes (needs a note), or reject. An approved item can be pulled back the same way. */
export const requestChanges = mutation({
  args: { itemId: v.string(), note: v.string(), reject: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminView(ctx);
    if (!canApproveItems(org)) {
      throw new Error(NOT_ADMIN_MSG);
    }
    const note = cleanText(args.note);
    if (!note) throw new Error("Add a note so the editor knows what to change.");
    if (note.length > MAX_NOTE) throw new Error(`The note can be at most ${MAX_NOTE} characters.`);
    const row = await ensureRow(ctx, org.orgId);
    let draft = normalizeConfig(row.draft);
    const ex = await extraFor(ctx, org.orgId);
    const def = allItems(draft, ex).find((i) => i.id === args.itemId);
    if (!def) throw new Error("Unknown item.");
    if (!def.approval) throw new Error("This item does not need approval.");
    const wf = ex.workflow[def.id];
    const now = Date.now();
    if (def.status === "approved") {
      const cleared = clearApproval(draft, def.id);
      if (cleared !== draft) {
        draft = cleared;
        await ctx.db.patch(row._id, { draft, updatedAt: now });
      }
    }
    await putWorkflow(ctx, org.orgId, def.id, {
      status: "changes_requested",
      fingerprint: itemFingerprint(draft, def.id, wf),
      text: wf?.text,
      lastEditedBy: wf?.lastEditedBy,
      lastEditedByLabel: wf?.lastEditedByLabel,
      lastEditedAt: wf?.lastEditedAt,
      note,
      noteBy: nameOf(org.user),
      noteAt: now,
      updatedAt: now,
    });
    await logItem(ctx, org, def.id, args.reject ? "rejected" : "changes_requested", note);
  },
});

/** What the item modal shows: the item, its current content, history and what this person may do. */
export const itemDetail = query({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const row = await rowFor(ctx, org.orgId);
    const draft = normalizeConfig(row?.draft ?? defaultConfig());
    const ex = await extraFor(ctx, org.orgId);
    const def = allItems(draft, ex).find((i) => i.id === args.itemId);
    if (!def) return null;
    const wf = ex.workflow[def.id];
    const id = def.id;

    let content:
      | { kind: "text"; wording: string; phone: string; defaultWording: string; phoneEditable: boolean; spoken: boolean }
      | { kind: "gas"; properties: Array<{ id: string; name: string; phone: string }> }
      | { kind: "delia"; name: string; phone: string; hours: string }
      | { kind: "escalation"; level: SeverityLevel; userIds: string[]; externalPhones: string[] }
      | { kind: "routing"; entries: Array<{ label: string; phone: string; hours: string }>; fallback: string; afterHours: string; enabled: boolean }
      | {
          kind: "severity";
          levels: SarahConfig["severityLevels"];
          escalation: SarahConfig["escalationContacts"];
        };

    if (id.startsWith("script-")) {
      const incident = id.slice(7) as keyof typeof SCRIPT_DRAFTS;
      const s = draft.emergencyScripts.find((x) => x.incident === incident)!;
      content = {
        kind: "text",
        wording: s.wording,
        phone: s.phone ?? "",
        defaultWording: SCRIPT_DRAFTS[incident].wording,
        phoneEditable: incident !== "gas_slight",
        spoken: true,
      };
    } else if (id === "tenant-responsibility") {
      content = { kind: "text", wording: draft.tenantResponsibility.wording, phone: "", defaultWording: TENANT_RESPONSIBILITY_DRAFT, phoneEditable: false, spoken: true };
    } else if (id.startsWith("flow-")) {
      const f = FLOW_DEFS.find((x) => x.key === id.slice(5))!;
      content = { kind: "text", wording: flowOf(draft, f.key).wording, phone: "", defaultWording: f.wording, phoneEditable: false, spoken: true };
    } else if (id === "am-fallback" || id === "pilot-flows") {
      content = { kind: "text", wording: decisionText(id, wf), phone: "", defaultWording: DECISION_DRAFTS[id], phoneEditable: false, spoken: false };
    } else if (id === "utility-number") {
      content = { kind: "gas", properties: ex.properties };
    } else if (id === "delia-contact") {
      const e = draft.routingDirectory.entries.find((x) => /delia/i.test(x.label));
      content = { kind: "delia", name: e?.label ?? "Delia (Accounting)", phone: e?.phone ?? "", hours: e?.hours ?? "" };
    } else if (id.startsWith("escalation-")) {
      const level = id.slice(11) as SeverityLevel;
      const e = draft.escalationContacts.find((x) => x.level === level);
      content = { kind: "escalation", level, userIds: e?.userIds ?? [], externalPhones: e?.externalPhones ?? [] };
    } else if (id === "routing-phones" || id === "owner-routing") {
      const r = draft.routingDirectory;
      content = {
        kind: "routing",
        entries: r.entries.map((e) => ({ label: e.label, phone: e.phone, hours: e.hours ?? "" })),
        fallback: r.fallback ?? "",
        afterHours: r.afterHours ?? "",
        enabled: r.enabled,
      };
    } else {
      content = { kind: "severity", levels: draft.severityLevels, escalation: draft.escalationContacts };
    }

    const history = (
      await ctx.db
        .query("sarahConfigAudit")
        .withIndex("by_org_and_item", (q) => q.eq("orgId", org.orgId).eq("itemId", id))
        .order("desc")
        .take(100)
    ).map((r) => ({ id: r._id as string, action: r.action, actor: r.actorLabel, note: r.note ?? null, at: r.at }));

    const fingerprint = itemFingerprint(draft, id, wf);
    const approver = canApproveItems(org);
    const approveBlocked: string | null = approver ? null : NOT_ADMIN_MSG;

    return {
      id,
      title: def.label,
      chip: def.chip,
      modal: def.modal,
      kind: def.kind,
      area: def.area,
      detail: def.detail,
      approval: def.approval,
      fallback: def.fallback,
      status: def.status,
      fingerprint,
      content,
      canEdit: true,
      canApprove: approver,
      approveBlocked,
      resettable: id !== "utility-number",
      note: def.status === "changes_requested" ? (wf?.note ?? null) : null,
      noteBy: def.status === "changes_requested" ? (wf?.noteBy ?? null) : null,
      noteAt: def.status === "changes_requested" ? (wf?.noteAt ?? null) : null,
      lastEditedBy: wf?.lastEditedByLabel ?? null,
      lastEditedAt: wf?.lastEditedAt ?? null,
      history,
      members: await teamMembers(ctx, org.orgId),
    };
  },
});

async function teamMembers(ctx: QueryCtx, orgId: Id<"organizations">): Promise<Array<{ id: Id<"users">; name: string }>> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const out = await Promise.all(
    memberships.map(async (m) => {
      const u = await ctx.db.get(m.userId);
      return u ? { id: m.userId, name: nameOf(u) } : null;
    }),
  );
  return out.filter((m): m is { id: Id<"users">; name: string } => m !== null);
}

/**
 * Legacy tab buttons ("Approve" next to a wording) go through the same rules as the modal, so the
 * role check, the self-approval rule and the history apply everywhere.
 */
export const approve = mutation({
  args: {
    kind: v.union(
      v.literal("callType"),
      v.literal("emergencyScript"),
      v.literal("tenantResponsibility"),
      v.literal("tenantMessage"),
      v.literal("flow"),
    ),
    key: v.string(), // tenantMessage: photoRequest | outOfScope | received
  },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireAdminView(ctx);
    if (!canApproveItems(org)) {
      throw new Error(NOT_ADMIN_MSG);
    }
    const row = await rowFor(ctx, org.orgId);
    if (!row) throw new Error("Save the draft before approving anything.");

    const itemId =
      args.kind === "emergencyScript"
        ? `script-${args.key}`
        : args.kind === "flow"
          ? `flow-${args.key}`
          : args.kind === "tenantResponsibility"
            ? "tenant-responsibility"
            : args.kind === "callType" && args.key === "emergency"
              ? "emergency-type"
              : args.kind === "callType" && args.key === "owner_routing"
                ? "owner-routing"
                : null;
    if (itemId) {
      const draft = normalizeConfig(row.draft);
      if (!allItems(draft).some((i) => i.id === itemId)) throw new Error("Unknown item.");
      await approveCore(ctx, org, itemId);
      return;
    }

    const draft = normalizeConfig(row.draft);
    const by = nameOf(org.user);
    const at = Date.now();
    if (args.kind === "callType") {
      if (!draft.callTypes.some((t) => t.key === args.key)) throw new Error("Unknown call type.");
      draft.callTypes = draft.callTypes.map((t) => (t.key === args.key ? { ...t, approvedBy: by, approvedAt: at } : t));
    } else if (args.kind === "tenantMessage") {
      const key = TENANT_MESSAGE_KEYS.find((k) => k === args.key);
      if (!key) throw new Error("Unknown tenant message.");
      const msgs = tenantMessagesOf(draft);
      if (!msgs[key].wording.trim()) throw new Error("Write the wording before approving it.");
      draft.tenantMessages = { ...msgs, [key]: { ...msgs[key], approved: true, approvedBy: by, approvedAt: at } };
    } else {
      throw new Error("Unknown item.");
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

    // An admin's publish approves whatever is switched on but still a draft. If a non-admin ever got
    // here, nothing is stamped, assertApprovals applies, and the prompt falls back to "call 911".
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const publisher = await ctx.db.get(args.userId);
    const isAdmin =
      !!member &&
      !!publisher &&
      String(member.orgId) === args.orgId &&
      isAdminView({ isAdmin: member.role === "admin", jobRoles: member.jobRoles ?? [] });
    if (isAdmin && publisher) {
      const wfs = await workflowMap(ctx, args.orgId);
      const res = adminStamp({
        merged: config,
        prev: config,
        wfsBefore: wfs,
        wfsAfter: wfs,
        changed: new Set(),
        targets: new Set(),
        by: nameOf(publisher),
        at: Date.now(),
      });
      config = res.config;
      await recordAutoApprovals(ctx, { orgId: args.orgId, user: publisher }, config, wfs, res.ids, AUTO_NOTE);
    }
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
): Promise<{ version: number; kbResynced: boolean }> {
  const org = await requireAdminViewId(ctx);
  if (!isAdminView(org)) throw new Error("You don't have access to that.");
  // Same guarantee as saveAgent: the team has an agent to push to.
  await ctx.runAction(internal.agents.ensure, { orgId: org.orgId, userId: org.userId });
  const version: number = await ctx.runMutation(internal.sarahConfig.commitPublish, {
    orgId: org.orgId,
    userId: org.userId,
    rollbackTo,
  });
  // Refresh the "policies" knowledge-base doc from what was just published. Never blocks a publish:
  // the doc is reference material, the prompt is what enforces the rules.
  try {
    await ctx.runAction(internal.sarahKb.regenerate, { orgId: org.orgId, userId: org.userId });
  } catch (err) {
    console.error("[sarahConfig.publish] policy doc refresh failed:", err);
  }
  let kbResynced = false;
  try {
    const pushed: { resynced: boolean } = await ctx.runAction(internal.agents.pushKnowledgeBase, {
      orgId: org.orgId,
    });
    kbResynced = pushed.resynced;
  } catch (err) {
    throw new Error(
      `Saved as version ${version}, but the voice service could not be updated (${
        err instanceof Error ? err.message : String(err)
      }). Publish again to retry.`,
    );
  }
  return { version, kbResynced };
}

export const publish = action({
  args: {},
  handler: async (ctx): Promise<{ version: number; kbResynced: boolean }> =>
    commitAndPush(ctx, undefined),
});

export const rollback = action({
  args: { version: v.number() },
  handler: async (ctx, args): Promise<{ version: number; kbResynced: boolean }> =>
    commitAndPush(ctx, args.version),
});
