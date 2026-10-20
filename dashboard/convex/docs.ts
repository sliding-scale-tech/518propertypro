import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import * as el from "./elevenLabsApi";
import { currentOrg, requireAdminView, requireAdminViewId } from "./authz";

// Shared with cloneDefaultsForOrg below, so the two never drift into disagreeing on which
// title marks a doc as generated rather than authored content worth cloning verbatim.
export const PROPERTY_DOC_TITLE = "Property details (auto-generated)";

/**
 * The starting knowledge base every brand-new team gets — coded here rather than copied out
 * of whichever live org happens to own the oldest agent (see agents.templateOrgId), the same
 * way LEASING_PROMPT/DEFAULT_FIRST_MESSAGE in agents.ts are coded rather than read off a
 * "first" row. That earlier approach made every fresh sign-up's knowledge base depend on one
 * specific org's docs never being edited or deleted; a fixed list has no such dependency and
 * needs no query to seed. The auto-generated property doc is deliberately not here — it's
 * produced by properties.syncPropertyDoc from each org's own (also cloned) property row.
 */
// Deliberately empty. Earlier defaults (support hours, unit sizes, maintenance guidance) were
// invented facts. The only seeded knowledge is generated from approved data: the policies doc
// (sarahKb.regenerate, from the published Sarah config) and the property doc (syncPropertyDoc).
const DEFAULT_DOCS: Array<{ title: string; body: string }> = [];

// --- Reads ----------------------------------------------------------------

/** The signed-in team's knowledge base. Empty (not an error) when signed out. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    return ctx.db
      .query("docs")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .collect();
  },
});

export const syncedEntries = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("docs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return docs
      // Only docs that finished indexing: a doc being re-synced (pending/indexing/failed) has
      // an old kbDocumentId that syncDoc is deleting, and the agent must never reference it.
      .filter((d) => d.syncState === "synced" && d.kbDocumentId !== undefined)
      .map((d) => ({
        type: "text" as const,
        id: d.kbDocumentId!,
        name: d.title,
        usage_mode: "auto" as const,
      }));
  },
});

/**
 * Seeds a brand-new team's knowledge base from the fixed DEFAULT_DOCS list above. A no-op if
 * this team already has knowledge — never clobbers real work.
 *
 * The auto-generated property doc doesn't count as knowledge here. properties.cloneForOrg
 * schedules it just before this runs, and it can land first; counting it would skip every
 * default doc, and since agents.ensure never runs again once the agent exists, the team would
 * be left with only the property doc for good.
 *
 * Each seeded doc goes through the normal syncDoc → pollRagIndex → pushKnowledgeBase pipeline,
 * the same as a doc saved by hand — there is no shortcut for "this text is already indexed
 * somewhere," since ElevenLabs KB documents aren't shared across agents.
 */
export const cloneDefaultsForOrg = internalMutation({
  args: {
    orgId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("docs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .filter((q) => q.neq(q.field("title"), PROPERTY_DOC_TITLE))
      .first();
    if (existing) return;

    const now = Date.now();
    for (const doc of DEFAULT_DOCS) {
      const docId = await ctx.db.insert("docs", {
        orgId: args.orgId,
        userId: args.userId,
        title: doc.title,
        body: doc.body,
        syncState: "pending",
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.docs.syncDoc, { docId });
    }
  },
});

/**
 * Plain title+body text for grounding the SMS bot — distinct from syncedEntries, which
 * returns ElevenLabs KB references for the voice agent.
 *
 * Deliberately NOT scoped by user: the SMS/WhatsApp bot predates multi-tenancy and remains
 * the single self-contained island described at the top of schema.ts, reading across every
 * user's synced docs rather than one owner's. Scoping it is a real, separate decision — it
 * wasn't part of what "Leads, Tenants, Knowledge, Property, Agent" asked for, so it stays as
 * it was rather than silently changing WhatsApp's behavior as a side effect of this migration.
 */
export const syncedTextInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("docs").filter((q) => q.eq(q.field("syncState"), "synced")).collect();
    return docs.map((d) => ({ title: d.title, body: d.body }));
  },
});

// --- Writes ---------------------------------------------------------------

/** Short-lived URL the dashboard POSTs a PDF or Word file to before we extract its text. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminView(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Reads an uploaded PDF or .docx through the Node extractor, then returns plain text the
 * editor can save through the normal docs.save path.
 */
export const extractFile = action({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args): Promise<{ title: string; body: string }> => {
    await requireAdminViewId(ctx);
    return await ctx.runAction(internal.docsImport.extractFile, args);
  },
});

/**
 * Saving a doc schedules its sync immediately. The write returns as soon as the row lands so
 * the editor stays responsive; the badge tracks the sync from there.
 */
export const save = mutation({
  args: {
    id: v.optional(v.id("docs")),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId, user } = await requireAdminView(ctx);
    const now = Date.now();
    let docId = args.id;

    if (docId) {
      const existing = await ctx.db.get(docId);
      // A docId for another team's doc, or one that's gone — either way, not this write's to make.
      if (!existing || existing.orgId !== orgId) throw new Error("Doc not found.");
      await ctx.db.patch(docId, {
        title: args.title,
        body: args.body,
        syncState: "pending",
        syncError: undefined,
        updatedAt: now,
      });
    } else {
      docId = await ctx.db.insert("docs", {
        orgId,
        userId: user._id,
        title: args.title,
        body: args.body,
        syncState: "pending",
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.docs.syncDoc, { docId });
    return docId;
  },
});

export const remove = action({
  args: { docId: v.id("docs") },
  handler: async (ctx, args): Promise<void> => {
    const { orgId } = await requireAdminViewId(ctx);
    const doc = await ctx.runQuery(internal.docs.getInternal, { docId: args.docId });
    if (!doc || doc.orgId !== orgId) return;

    // Row first, then detach from the agent, and only then delete the ElevenLabs document, so the
    // agent never references a deleted doc.
    await ctx.runMutation(internal.docs.deleteRow, { docId: args.docId });
    await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId });
    if (doc.kbDocumentId) {
      await el.deleteKbDoc(doc.kbDocumentId, doc.ragIndexId).catch(() => {/* already gone */});
    }
  },
});

// --- Sync pipeline --------------------------------------------------------

/**
 * Pushes one doc to the ElevenLabs knowledge base and kicks off RAG indexing.
 *
 * Replace-on-edit rather than update-in-place: the text endpoint creates documents, it does
 * not revise them, so an edited doc becomes a new KB document and the old one is dropped.
 */
export const syncDoc = internalAction({
  args: { docId: v.id("docs") },
  handler: async (ctx, args): Promise<void> => {
    const doc = await ctx.runQuery(internal.docs.getInternal, { docId: args.docId });
    if (!doc) return;

    try {
      // Create the replacement first and swap the row over to it; the old document is deleted
      // only afterwards. Deleting first left the row pointing at a deleted id whenever the
      // upload failed or a push ran mid-sync.
      const created = await el.createKbDocFromText(doc.body, doc.title);
      const index = await el.computeRagIndex(created.id);

      await ctx.runMutation(internal.docs.markSync, {
        docId: args.docId,
        kbDocumentId: created.id,
        ragIndexId: index.id,
        syncState: "indexing",
      });

      if (doc.kbDocumentId && doc.kbDocumentId !== created.id) {
        await el
          .deleteKbDoc(doc.kbDocumentId, doc.ragIndexId)
          .catch(() => {/* stale id; the fresh upload above is what matters */});
      }

      // Indexing is asynchronous; the agent cannot retrieve from the doc until it succeeds.
      await ctx.scheduler.runAfter(2000, internal.docs.pollRagIndex, { docId: args.docId });
    } catch (err) {
      await ctx.runMutation(internal.docs.markSync, {
        docId: args.docId,
        syncState: "failed",
        syncError: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

export const pollRagIndex = internalAction({
  args: { docId: v.id("docs"), attempt: v.optional(v.number()) },
  handler: async (ctx, args): Promise<void> => {
    const attempt = args.attempt ?? 0;
    const doc = await ctx.runQuery(internal.docs.getInternal, { docId: args.docId });
    if (!doc?.kbDocumentId) return;

    try {
      const { indexes } = await el.getRagIndexes(doc.kbDocumentId);
      const index = indexes.find((i) => i.id === doc.ragIndexId) ?? indexes[0];

      if (index?.status === "succeeded") {
        await ctx.runMutation(internal.docs.markSync, {
          docId: args.docId,
          syncState: "synced",
        });
        // Only now is the doc actually answerable, so attach it to the agent. doc.orgId is
        // always set by this point — every doc that can reach a synced state was created
        // through docs.save or syncPropertyDoc, both of which stamp it at insert time.
        if (doc.orgId) await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: doc.orgId });
        return;
      }

      if (index?.status === "failed" || attempt > 20) {
        await ctx.runMutation(internal.docs.markSync, {
          docId: args.docId,
          syncState: "failed",
          syncError:
            index?.status === "failed"
              ? "RAG indexing failed at ElevenLabs."
              : "RAG indexing timed out after ~40s.",
        });
        return;
      }

      await ctx.scheduler.runAfter(2000, internal.docs.pollRagIndex, {
        docId: args.docId,
        attempt: attempt + 1,
      });
    } catch (err) {
      await ctx.runMutation(internal.docs.markSync, {
        docId: args.docId,
        syncState: "failed",
        syncError: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

/**
 * Keeps a KB document in sync with the property table, so a standalone question like "what's
 * the rent for a 2BR?" is answerable straight from the knowledge base without requiring the
 * agent to first gather all five qualification fields.
 */
export const syncPropertyDoc = internalMutation({
  args: { orgId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const units = await ctx.db
      .query("units")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const title = PROPERTY_DOC_TITLE;
    const blocks: string[] = [];
    for (const p of properties) {
      const lines = [`Property: ${p.name}`];
      if (p.address) lines.push(`Address: ${p.address.formatted}`);
      lines.push(`Pets: ${p.petsAllowed ? "allowed" : "not allowed"}`);
      const open = units.filter((u) => u.propertyId === p._id && u.available);
      if (open.length === 0) {
        lines.push("Available units: none listed. Do not offer a unit; say the team will follow up.");
      } else {
        lines.push("Available units:");
        for (const u of open) {
          const parts = [`${u.bedrooms}`, `unit ${u.unitNumber}`];
          if (u.rent !== undefined) parts.push(`rent $${u.rent}/mo`);
          else parts.push("rent not entered, do not quote one");
          if (u.availableFrom) parts.push(`available from ${u.availableFrom}`);
          lines.push(`- ${parts.join(", ")}`);
        }
      }
      blocks.push(lines.join("\n"));
    }
    const body = blocks.length
      ? blocks.join("\n\n")
      : "No property or unit data has been entered yet. Do not state rents or availability; say the team will follow up.";

    // Scoped to this team's own docs: two different teams' properties both produce a doc
    // titled "Property details (auto-generated)", and without the orgId filter this would
    // find and overwrite whichever one happened to exist first.
    const existing = await ctx.db
      .query("docs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .filter((q) => q.eq(q.field("title"), title))
      .first();

    let docId;
    if (existing) {
      docId = existing._id;
      await ctx.db.patch(docId, {
        body,
        syncState: "pending",
        syncError: undefined,
        updatedAt: Date.now(),
      });
    } else {
      docId = await ctx.db.insert("docs", {
        orgId: args.orgId,
        userId: args.userId,
        title,
        body,
        syncState: "pending",
        updatedAt: Date.now(),
      });
    }

    await ctx.scheduler.runAfter(0, internal.docs.syncDoc, { docId });
  },
});

// --- Internal helpers -----------------------------------------------------

export const getInternal = internalQuery({
  args: { docId: v.id("docs") },
  handler: (ctx, args) => ctx.db.get(args.docId),
});

/**
 * A knowledge-base document this team's row points at no longer exists in ElevenLabs. Forget the
 * dead id and queue a fresh upload; syncDoc -> pollRagIndex re-attaches it to the agent.
 */
export const invalidateKbDoc = internalMutation({
  args: { orgId: v.string(), kbDocumentId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const docs = await ctx.db
      .query("docs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const doc = docs.find((d) => d.kbDocumentId === args.kbDocumentId);
    if (!doc) return false;
    await ctx.db.patch(doc._id, {
      kbDocumentId: undefined,
      ragIndexId: undefined,
      syncState: "pending",
      syncError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.docs.syncDoc, { docId: doc._id });
    return true;
  },
});

export const deleteRow =internalMutation({
  args: { docId: v.id("docs") },
  handler: (ctx, args) => ctx.db.delete(args.docId),
});

export const markSync = internalMutation({
  args: {
    docId: v.id("docs"),
    kbDocumentId: v.optional(v.string()),
    ragIndexId: v.optional(v.string()),
    syncState: v.union(
      v.literal("pending"),
      v.literal("indexing"),
      v.literal("synced"),
      v.literal("failed"),
    ),
    syncError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { docId, ...rest } = args;
    const patch: Record<string, unknown> = { syncState: rest.syncState };
    if (rest.kbDocumentId !== undefined) patch.kbDocumentId = rest.kbDocumentId;
    if (rest.ragIndexId !== undefined) patch.ragIndexId = rest.ragIndexId;
    patch.syncError = rest.syncError;
    await ctx.db.patch(docId, patch);
  },
});
