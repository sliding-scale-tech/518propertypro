import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { LIFE_SAFETY_BLOCK } from "./residentTriage";

/**
 * Written out rather than inferred. addLifeSafety references internal.promptMigration.* -- its
 * own module -- and Convex's codegen cannot resolve that cycle, so without explicit annotations
 * every function in the generated api degrades to `any` and the dashboard pages lose their types.
 */
type AgentRow = {
  _id: Id<"agents">;
  orgId: string;
  name: string;
  elevenLabsAgentId: string;
  hasBlock: boolean;
  promptChars: number;
};
type PatchResult = { changed: boolean; reason?: string; before?: number; after?: number };
type MigrationReport = { total: number; report: Array<Record<string, unknown>> };

/**
 * One-off: puts LIFE_SAFETY_BLOCK into every agent's stored prompt.
 *
 * Adding it to LEASING_PROMPT only covers agents created from here on. Every existing agent
 * holds its own snapshot of the prompt in `agents.prompt`, taken when it was created, and
 * saveAgent prefers that snapshot over the template forever after -- so without this, editing
 * the template changes nothing for anyone who already has an agent.
 *
 * Idempotent by marker: an agent whose prompt already contains the block's heading is skipped,
 * so re-running it cannot stack duplicate copies onto a prompt.
 *
 * Run per deployment, dry run first:
 *   npx convex run promptMigration:addLifeSafety '{"dryRun":true}' [--prod]
 *   npx convex run promptMigration:addLifeSafety '{}' [--prod]
 */

const MARKER = "LIFE-SAFETY EMERGENCIES:";

/**
 * Inserted directly above RESIDENT CALLS so it reads before the resident rules it overrides,
 * matching where it sits in LEASING_PROMPT. Prompts predating that section -- or ones a manager
 * has rewritten -- fall back to appending, which still places it after the escalation rules but
 * in the prompt all the same.
 */
function withLifeSafety(prompt: string): string {
  if (prompt.includes(MARKER)) return prompt;
  const anchor = "RESIDENT CALLS:";
  const at = prompt.indexOf(anchor);
  if (at === -1) return `${prompt}\n\n${LIFE_SAFETY_BLOCK}`;
  return `${prompt.slice(0, at)}${LIFE_SAFETY_BLOCK}\n\n${prompt.slice(at)}`;
}

export const listAgents = internalQuery({
  args: {},
  handler: async (ctx): Promise<AgentRow[]> =>
    (await ctx.db.query("agents").collect()).map((a) => ({
      _id: a._id,
      orgId: a.orgId,
      name: a.name,
      elevenLabsAgentId: a.elevenLabsAgentId,
      hasBlock: a.prompt.includes(MARKER),
      promptChars: a.prompt.length,
    })),
});

export const patchPrompt = internalMutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }): Promise<PatchResult> => {
    const agent = await ctx.db.get(agentId);
    if (!agent) return { changed: false, reason: "missing" };
    if (agent.prompt.includes(MARKER)) return { changed: false, reason: "already-present" };
    const next = withLifeSafety(agent.prompt);
    await ctx.db.patch(agentId, { prompt: next, updatedAt: Date.now() });
    return { changed: true, before: agent.prompt.length, after: next.length };
  },
});

export const addLifeSafety = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<MigrationReport> => {
    const agents: AgentRow[] = await ctx.runQuery(internal.promptMigration.listAgents, {});
    const report: Array<Record<string, unknown>> = [];

    for (const a of agents) {
      if (a.hasBlock) {
        report.push({ org: a.orgId, agent: a.name, status: "skipped (already present)" });
        continue;
      }
      if (dryRun) {
        report.push({ org: a.orgId, agent: a.name, status: "would update", chars: a.promptChars });
        continue;
      }

      const patched: PatchResult = await ctx.runMutation(
        internal.promptMigration.patchPrompt,
        { agentId: a._id },
      );
      if (!patched.changed) {
        report.push({ org: a.orgId, agent: a.name, status: `skipped (${patched.reason})` });
        continue;
      }

      // The stored prompt is only half of it -- ElevenLabs holds its own copy, and that is what
      // actually runs on a call. pushKnowledgeBase re-composes and re-uploads the agent, which
      // is the same path a Settings save takes.
      try {
        await ctx.runAction(internal.agents.pushKnowledgeBase, { orgId: a.orgId });
        report.push({
          org: a.orgId,
          agent: a.name,
          status: "updated + pushed",
          chars: `${patched.before} -> ${patched.after}`,
        });
      } catch (err) {
        report.push({
          org: a.orgId,
          agent: a.name,
          status: "DB updated but PUSH FAILED",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { total: agents.length, report };
  },
});
