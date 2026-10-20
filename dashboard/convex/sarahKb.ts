import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as el from "./elevenLabsApi";
import { requireAdminViewId } from "./authz";
import { composePolicyDoc, defaultConfig, normalizeConfig, POLICY_DOC_TITLE } from "./sarahConfigLib";
import type { SarahConfig } from "./sarahConfigLib";

/**
 * The "518 Property Pro — policies" knowledge-base document, generated from the PUBLISHED Sarah
 * config (see composePolicyDoc). It only ever contains approved, switched-on wording, so the voice
 * agent's retrieval cannot surface a policy Pat has not signed off. It is rebuilt on every publish
 * and on demand from /sarah. Saving the doc goes through the normal docs pipeline
 * (syncDoc -> pollRagIndex -> pushKnowledgeBase), so the agent picks it up once indexed.
 */

/** Creates or updates this team's policy doc. Skips the ElevenLabs re-sync when nothing changed. */
export const upsertPolicyDoc = internalMutation({
  args: { orgId: v.string(), userId: v.id("users"), body: v.string() },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    const existing = await ctx.db
      .query("docs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .filter((q) => q.eq(q.field("title"), POLICY_DOC_TITLE))
      .first();
    const now = Date.now();
    if (existing) {
      if (existing.body === args.body && existing.syncState !== "failed") return { changed: false };
      await ctx.db.patch(existing._id, {
        body: args.body,
        syncState: "pending",
        syncError: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.docs.syncDoc, { docId: existing._id });
      return { changed: true };
    }
    const docId = await ctx.db.insert("docs", {
      orgId: args.orgId,
      userId: args.userId,
      title: POLICY_DOC_TITLE,
      body: args.body,
      syncState: "pending",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.docs.syncDoc, { docId });
    return { changed: true };
  },
});

/** Rebuilds the doc from the published config. Internal: called by publish and by regenerateNow. */
export const regenerate = internalAction({
  args: { orgId: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    const published: SarahConfig | null = await ctx.runQuery(internal.sarahConfig.publishedForOrg, {
      orgId: args.orgId,
    });
    // Nothing published yet: build from the defaults, where nothing is approved, so the doc says so.
    const config = published ?? normalizeConfig(defaultConfig());
    return await ctx.runMutation(internal.sarahKb.upsertPolicyDoc, {
      orgId: args.orgId,
      userId: args.userId,
      body: composePolicyDoc(config),
    });
  },
});

/** The admin button on /sarah. Same permission as publishing. */
export const regenerateNow = action({
  args: {},
  handler: async (ctx): Promise<{ changed: boolean }> => {
    const org = await requireAdminViewId(ctx);
    return await ctx.runAction(internal.sarahKb.regenerate, { orgId: org.orgId, userId: org.userId });
  },
});

/** Internal admin helper: removes docs (ElevenLabs KB doc + row) by exact title for one org, then re-pushes the KB. */
export const deleteDocsByTitle = internalAction({
  args: { orgId: v.string(), titles: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ deleted: string[] }> => {
    const docs: Array<{ _id: Id<"docs">; title: string; kbDocumentId?: string; ragIndexId?: string }> =
      await ctx.runQuery(internal.sarahKb.docsForOrg, { orgId: args.orgId });
    const deleted: string[] = [];
    const removed: typeof docs = [];
    for (const d of docs) {
      if (!args.titles.includes(d.title)) continue;
      await ctx.runMutation(internal.docs.deleteRow, { docId: d._id });
      deleted.push(d.title);
      removed.push(d);
    }
    // Detach from the agent first, then delete the ElevenLabs documents.
    await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: args.orgId });
    for (const d of removed) {
      if (d.kbDocumentId) await el.deleteKbDoc(d.kbDocumentId, d.ragIndexId).catch(() => {});
    }
    return { deleted };
  },
});

export const docsForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) =>
    ctx.db.query("docs").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect(),
});
