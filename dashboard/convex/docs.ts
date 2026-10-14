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
import { currentOrg, requireOrg, requireOrgId } from "./authz";

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
const DEFAULT_DOCS: Array<{ title: string; body: string }> = [
  {
    title: "Common maintenance issues",
    body: "Guidance for the most frequent resident calls. Sarah gathers details and logs the request. Sarah never talks a resident through a repair.\n\nNo heat: Ask whether it is the whole unit or one room, and what the thermostat is set to. Ask whether neighbours are affected. In freezing weather this is an emergency. In mild weather it is urgent but not an emergency.\n\nNo hot water: Ask whether there is cold water, and whether it is every tap or only one. This is urgent. It is not an emergency if the heating still works.\n\nLeak or water coming in: Ask where the water is coming from, whether it is still running, and whether it is reaching another unit below. Any leak spreading to another unit is an emergency.\n\nNo power: Ask whether it is the whole unit or one room, and whether the neighbours have power. If the whole building is out it is likely a utility outage, and we may not have an earlier update than the utility company does.\n\nAppliance not working: Ask which appliance and what it is doing. Only appliances supplied by the property are covered. A resident's own appliance is not.\n\nPests: Ask what they are seeing, where, and for how long. Ask whether neighbours have mentioned the same. Repeated sightings across units are treated more seriously than a single one.\n\nNoise complaint: Take the details, the unit if they know it, and the time it happens. This is logged, not dispatched. Sarah does not promise anyone will be spoken to.\n\nLockout: Ask whether they are outside the building or outside their unit, and whether anyone else has a key. Late at night this is treated as urgent.\n\nBlocked drain or toilet: Ask whether it is overflowing. Overflowing is urgent. Draining slowly is routine.\n\nSmoke or fire alarm: Ask whether it is chirping intermittently or sounding continuously. Intermittent chirping is usually a low battery and is routine. An alarm sounding continuously and not resetting is a real problem, not routine, even if whatever set it off has already cleared. Sarah never tells a resident to remove, disconnect, or take the battery out of an alarm.\n\nIf a resident reports two problems, log the more serious one and mention the second in the description.",
  },
  {
    title: "Maintenance emergencies",
    body: "An emergency is anything that threatens safety, health, or is actively causing damage to the building.\n\nThese are emergencies:\nFire or the smell of smoke.\nAny smell of gas.\nFlooding, a burst pipe, or water coming through a ceiling.\nSewage backing up into the unit.\nNo heat when it is near or below freezing.\nNo water at all.\nA total loss of power to the unit.\nAn exterior door, window, or lock that will not secure.\nA break-in, or evidence of one.\nAnyone trapped in a lift.\nSparking outlets, exposed wiring, or a burning smell from an appliance.\n\nThese are not emergencies, even though they are frustrating:\nNo hot water, when there is heat.\nOne appliance broken.\nAir conditioning out in mild weather.\nA slow or dripping leak that is contained.\nNoise complaints.\nPests, unless there is an infestation affecting health.\nA lost key or a lockout, unless it is late at night.\n\nIf there is a gas smell, tell the resident to leave the building immediately and call the emergency services from outside before anything else. Do not keep them on the line to collect details.\n\nIf water is actively flooding, tell the resident to shut off the water at the valve if they can reach it safely, and to move belongings away from the water.\n\nIf there is a fire, they should be out of the building and calling emergency services, not on this call.\n\nFor every emergency, Sarah takes their name, unit, and a callback number, logs it, and hands the call to a staff member straight away. Sarah never promises a specific arrival time.",
  },
  {
    title: "Maintenance requests",
    body: "Residents report maintenance by calling this number, 24 hours a day. There is no separate maintenance line and no form to fill in. Sarah takes the details and logs the request; a staff member follows up.\n\nEvery request is scored for urgency from 1 to 10 and handled in that order, not in the order it was received. A resident does not need to argue that their issue is urgent. Sarah decides the score from what they describe.\n\nTarget response times, from when the request is logged:\nEmergency issues: someone is in contact the same day.\nUrgent issues: within one business day.\nRoutine repairs: within three business days, scheduled with the resident.\nInformational requests: answered on the next business day.\n\nBusiness hours are 9am to 5pm Monday to Friday. Emergencies are handled outside those hours; routine repairs are not.\n\nTo enter a unit for a repair, we give at least 24 hours notice, except in an emergency where entry may be immediate to stop damage or address a safety risk. Residents can ask for a specific window and we will try to match it, but we cannot guarantee an exact time.\n\nResidents do not need to be home for most repairs. If a resident wants to be present, say so when reporting and we will schedule around it.\n\nRepairs from normal wear and tear are covered by the property at no cost. Damage caused by a resident, a guest, or a pet may be billed to the resident. Sarah never tells a resident whether they will be charged. That decision is made by staff after the visit.\n\nResidents should not arrange their own contractor or attempt their own repair. Work done without approval is not reimbursed and may be charged back.",
  },
  {
    title: "Unit sizes",
    body: "Unit sizes (approximate, for reference):\nstudio: approx. 450-550 sq ft\n1br: approx. 650-750 sq ft\n2br: approx. 950-1050 sq ft\n3br: approx. 1200-1350 sq ft\n4br: approx. 1600-1800 sq ft\n5br: approx. 2000-2200 sq ft\n1 square yard = 9 square feet, for converting caller-provided measurements.",
  },
  {
    title: "Application Process",
    body: "To apply, fill out our online application and pay a $50 non-refundable application fee. We require proof of income (pay stubs or an offer letter) showing at least 3 times the monthly rent, a valid photo ID, and contact info for your two most recent landlords. Applications are usually processed within 2 business days. A holding deposit equal to one month rent is due within 24 hours of approval to reserve the unit.",
  },
  {
    title: "Support hours",
    body: "Our support team is available 9am to 5pm Monday through Friday, local time. We are closed on public holidays.",
  },
];

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
      .filter((d) => d.kbDocumentId !== undefined)
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
    await requireOrg(ctx);
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
    await requireOrgId(ctx);
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
    const { orgId, user } = await requireOrg(ctx);
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
    const { orgId } = await requireOrgId(ctx);
    const doc = await ctx.runQuery(internal.docs.getInternal, { docId: args.docId });
    if (!doc || doc.orgId !== orgId) return;

    if (doc.kbDocumentId) {
      await el.deleteKbDoc(doc.kbDocumentId, doc.ragIndexId);
    }
    await ctx.runMutation(internal.docs.deleteRow, { docId: args.docId });
    await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId });
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
      if (doc.kbDocumentId) {
        await el
          .deleteKbDoc(doc.kbDocumentId, doc.ragIndexId)
          .catch(() => {/* stale id; the fresh upload below is what matters */});
      }

      const created = await el.createKbDocFromText(doc.body, doc.title);
      const index = await el.computeRagIndex(created.id);

      await ctx.runMutation(internal.docs.markSync, {
        docId: args.docId,
        kbDocumentId: created.id,
        ragIndexId: index.id,
        syncState: "indexing",
      });

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
    const property = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    if (!property) return;

    const title = PROPERTY_DOC_TITLE;
    const body = [
      `${property.name}. Pets ${property.petsAllowed ? "allowed" : "not allowed"}. Move-in window: within ${property.moveInWindowDays} days.`,
      ...(property.address ? [`Address: ${property.address.formatted}`] : []),
      "Available units:",
      ...property.units.map(
        (u) =>
          `${u.bedrooms}: $${u.rentMin}-$${u.rentMax}/mo${u.available ? "" : " (currently unavailable)"}`,
      ),
    ].join("\n");

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

export const deleteRow = internalMutation({
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
