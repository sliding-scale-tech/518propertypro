import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, mutation, query } from "./_generated/server";
import { currentOrg, requireOrg } from "./authz";
import { CORE_QUESTIONS, DISABLEABLE_KEYS, type CoreKey } from "./coreQuestions";

/**
 * The property manager's own pre-screening questions — the ones Sarah asks on top of the five
 * that are built in.
 *
 * These are stored as data rather than written into the prompt by hand for one reason: each
 * question has to become a typed property on that manager's check_qualification tool schema.
 * That is what makes the model normalize "yeah, I've got a co-signer lined up" into a real
 * `true`, the same way it already does for pets_wanted. Prompt text alone would give us a
 * sentence back, and convex/qualifyRules.ts cannot make a decision out of a sentence.
 */

const ANSWER_KIND = v.union(
  v.literal("yes_no"),
  v.literal("number"),
  v.literal("choice"),
  v.literal("text"),
);

const CRITERION = v.union(
  v.object({ kind: v.literal("yes_no"), mustBe: v.boolean() }),
  v.object({
    kind: v.literal("number"),
    op: v.union(v.literal("gte"), v.literal("lte")),
    value: v.number(),
  }),
  v.object({ kind: v.literal("choice"), allowed: v.array(v.string()) }),
);

/** A manager could reasonably add a dozen; a hundred would make every call unlistenable. */
const MAX_QUESTIONS = 15;

// --- Reads ----------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    // currentOrg, not requireOrg: a query renders an empty state, it does not crash the page.
    // A signed-in invitee has no team until they accept, and that is a normal state to be in.
    const org = await currentOrg(ctx);
    if (!org) return [];
    const rows = await ctx.db
      .query("screeningQuestions")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    return rows.sort((a, b) => a.order - b.order);
  },
});

/**
 * Enabled questions only, in ask order. This is the shape both the prompt renderer and the
 * check-qualification webhook consume, so a disabled question disappears from what the agent
 * is told to ask and from the rules at the same moment — never from one but not the other.
 *
 * `orgId` is optional for the same reason properties.currentInternal's is: a call to the
 * public landing-page demo agent has no signed-in team, and falls back to the template org's
 * questions so the demo behaves like a real tenant's agent rather than losing the questions
 * its prompt was rendered with.
 */
export const activeForOrg = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? (await ctx.db.query("agents").first())?.orgId;
    if (!orgId) return [];

    const rows = await ctx.db
      .query("screeningQuestions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .filter((r) => r.enabled)
      .sort((a, b) => a.order - b.order)
      .map((r) => ({
        key: r.key,
        question: r.question,
        answerKind: r.answerKind,
        choices: r.choices,
        criterion: r.criterion,
      }));
  },
});

/** Which built-in questions this manager has switched off. Empty when they have never touched them. */
export const builtins = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    const row = org
      ? await ctx.db
          .query("screeningBuiltins")
          .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
          .first()
      : null;
    const disabled = row?.disabled ?? [];
    return CORE_QUESTIONS.map((question) => ({
      ...question,
      enabled: !question.canDisable || !disabled.includes(question.key),
    }));
  },
});

/** Same optional-orgId fallback as activeForOrg, for the prompt renderer and the webhook. */
export const disabledBuiltinsForOrg = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? (await ctx.db.query("agents").first())?.orgId;
    if (!orgId) return [];
    const row = await ctx.db
      .query("screeningBuiltins")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return row?.disabled ?? [];
  },
});

// --- Writes ---------------------------------------------------------------

export const save = mutation({
  args: {
    id: v.optional(v.id("screeningQuestions")),
    question: v.string(),
    answerKind: ANSWER_KIND,
    choices: v.optional(v.array(v.string())),
    criterion: v.optional(CRITERION),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
    const question = args.question.trim();
    if (!question) throw new Error("Give the question some text.");

    const choices = args.choices?.map((c) => c.trim()).filter(Boolean);
    validate(args.answerKind, choices, args.criterion);

    const existing = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && (!existing || existing.orgId !== orgId)) {
      throw new Error("Question not found.");
    }

    const siblings = await ctx.db
      .query("screeningQuestions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    if (!existing && siblings.length >= MAX_QUESTIONS) {
      throw new Error(
        `That's the ${MAX_QUESTIONS}-question limit. Remove one before adding another — a caller will not sit through more.`,
      );
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        question,
        answerKind: args.answerKind,
        choices: args.answerKind === "choice" ? choices : undefined,
        criterion: args.criterion,
        enabled: args.enabled ?? existing.enabled,
        updatedAt: Date.now(),
        // `key` is deliberately not patched — see the schema comment. Rewording a question
        // keeps its key so answers already recorded against it stay attached.
      });
    } else {
      await ctx.db.insert("screeningQuestions", {
        orgId,
        userId: user._id,
        key: uniqueKey(question, siblings.map((s) => s.key)),
        question,
        answerKind: args.answerKind,
        choices: args.answerKind === "choice" ? choices : undefined,
        criterion: args.criterion,
        order: siblings.reduce((max, s) => Math.max(max, s.order), -1) + 1,
        enabled: args.enabled ?? true,
        updatedAt: Date.now(),
      });
    }

    await ctx.scheduler.runAfter(0, internal.agents.pushScreening, { orgId });
  },
});

export const remove = mutation({
  args: { id: v.id("screeningQuestions") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) return;
    await ctx.db.delete(args.id);
    await ctx.scheduler.runAfter(0, internal.agents.pushScreening, { orgId });
  },
});

/**
 * Switches one built-in question on or off.
 *
 * Silently refuses the two structural keys rather than trusting the client to have disabled
 * the toggle — turning `bedrooms` off would disqualify every caller, which is not something a
 * stray request should be able to do.
 */
export const setBuiltin = mutation({
  args: { key: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
    if (!DISABLEABLE_KEYS.includes(args.key as CoreKey)) {
      throw new Error("That question is required and cannot be switched off.");
    }

    const row = await ctx.db
      .query("screeningBuiltins")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const current = row?.disabled ?? [];
    const disabled = args.enabled
      ? current.filter((k) => k !== args.key)
      : current.includes(args.key)
        ? current
        : [...current, args.key];

    if (row) await ctx.db.patch(row._id, { disabled, updatedAt: Date.now() });
    else {
      await ctx.db.insert("screeningBuiltins", {
        orgId,
        userId: user._id,
        disabled,
        updatedAt: Date.now(),
      });
    }

    await ctx.scheduler.runAfter(0, internal.agents.pushScreening, { orgId });
  },
});

/** Takes the full ordered list of ids. Anything omitted keeps the order it already had. */
export const reorder = mutation({
  args: { ids: v.array(v.id("screeningQuestions")) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    for (const [index, id] of args.ids.entries()) {
      const row = await ctx.db.get(id);
      if (!row || row.orgId !== orgId) continue;
      await ctx.db.patch(id, { order: index, updatedAt: Date.now() });
    }
    await ctx.scheduler.runAfter(0, internal.agents.pushScreening, { orgId });
  },
});

// --- Helpers --------------------------------------------------------------

/**
 * Rejects the combinations that would otherwise reach evaluateQualification as a rule that can
 * never pass — a manager setting a trap for their own leads without being told.
 */
function validate(
  answerKind: "yes_no" | "number" | "choice" | "text",
  choices: string[] | undefined,
  criterion: { kind: string; allowed?: string[]; value?: number } | undefined,
) {
  if (answerKind === "choice" && (!choices || choices.length < 2)) {
    throw new Error("Give the caller at least two options to choose between.");
  }
  if (!criterion) return;

  if (answerKind === "text") {
    throw new Error(
      "A free-text answer can be recorded but cannot decide qualification — there is nothing for the rules to compare. Use Yes/No, a number, or a list of options.",
    );
  }
  if (criterion.kind !== answerKind) {
    throw new Error("That requirement does not match the kind of answer this question expects.");
  }
  if (criterion.kind === "number" && !Number.isFinite(criterion.value)) {
    throw new Error("Give the requirement a real number.");
  }
  if (criterion.kind === "choice") {
    const allowed = criterion.allowed ?? [];
    if (allowed.length === 0) {
      throw new Error("Pick at least one answer that passes, or this question fails everyone.");
    }
    const known = new Set((choices ?? []).map((c) => c.toLowerCase()));
    if (allowed.some((a) => !known.has(a.trim().toLowerCase()))) {
      throw new Error("Every passing answer has to be one of the options you listed.");
    }
  }
}

/**
 * A stable, schema-safe property name derived from the question's wording.
 *
 * Generated once and frozen thereafter, so this only has to be readable enough that a tool
 * call is debuggable in the ElevenLabs logs — it is not a display value.
 */
function uniqueKey(question: string, taken: string[]): string {
  const base =
    "q_" +
    (question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .split("_")
      .filter(Boolean)
      .slice(0, 6)
      .join("_") || "question");

  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
