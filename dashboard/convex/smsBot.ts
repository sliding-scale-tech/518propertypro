import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import * as gemini from "./geminiApi";

const SMS_SYSTEM_PROMPT = `You are Sarah, the leasing assistant for the property, texting with a prospective or
current tenant. You answer only from the property information given below —
never guess or invent anything not in it. Keep replies short, plain, and friendly, the way a
real person texts (no markdown, no bullet points).

Qualification for a tour is based only on: unit type wanted, move-in timeline, budget, and
pets. Never let anything else (how someone writes, their name, anything else about them)
factor into it. If someone's stated budget or pet needs don't fit an available unit, say so
plainly and don't suggest a tour you know would be rejected.

You must set can_answer to false — handing the conversation to a human — whenever:
- The person asks to speak to a human, and you've already tried once to help.
- They mention anything urgent as an existing tenant: no heat, flooding, no water, a
  lockout, anything safety-related.
- The question is not about leasing at all (maintenance, billing, anything you don't
  actually have information for here).
- You're not confident you understood what they're asking after they've clarified once.

When can_answer is false, still write a short, reassuring reply telling them someone will
follow up shortly — never leave the reply blank, and never guess at an answer you don't
have. Set escalation_reason to a short phrase a staff member can read at a glance.

PROPERTY INFORMATION:
{{PROPERTY}}

ADDITIONAL KNOWLEDGE:
{{DOCS}}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildSystemContext(ctx: any): Promise<string> {
  const property: {
    name: string;
    petsAllowed: boolean;
    moveInWindowDays: number;
    units: Array<{ bedrooms: string; rentMin: number; rentMax: number; available: boolean }>;
  } = await ctx.runQuery(internal.properties.currentInternal, {});
  const docs: Array<{ title: string; body: string }> = await ctx.runQuery(
    internal.docs.syncedTextInternal,
    {},
  );

  const propertyText = [
    `Name: ${property.name}`,
    `Pets allowed: ${property.petsAllowed ? "yes" : "no"}`,
    `Move-in window: within ${property.moveInWindowDays} days`,
    "Units:",
    ...property.units.map(
      (u: { bedrooms: string; rentMin: number; rentMax: number; available: boolean }) =>
        `  ${u.bedrooms}: $${u.rentMin}-$${u.rentMax}/mo, ${u.available ? "available" : "not available"}`,
    ),
  ].join("\n");

  const docsText =
    docs.length > 0 ? docs.map((d) => `${d.title}: ${d.body}`).join("\n\n") : "(none)";

  return SMS_SYSTEM_PROMPT.replace("{{PROPERTY}}", propertyText).replace("{{DOCS}}", docsText);
}

/**
 * Generates and sends (or escalates) a reply to the most recent inbound message on a thread.
 * Called by the inbound SMS webhook right after the customer's message is recorded.
 */
export const respond = internalAction({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args): Promise<void> => {
    const thread = await ctx.runQuery(internal.threads.getInternal, {
      threadId: args.threadId,
    });
    if (!thread || thread.status !== "bot") return;

    const history: Array<{ sender: "customer" | "bot" | "staff"; text: string }> =
      await ctx.runQuery(internal.threads.recentMessages, {
        threadId: args.threadId,
        limit: 20,
      });

    const systemContext = await buildSystemContext(ctx);
    const decision = await gemini.generateSmsReply(systemContext, history);

    if (decision.canAnswer && decision.reply) {
      await ctx.runAction(internal.threads.sendMessage, {
        threadId: args.threadId,
        sender: "bot",
        text: decision.reply,
      });
      return;
    }

    // Escalate: still send whatever reassuring reply the model wrote (if any), then hand off.
    if (decision.reply) {
      await ctx.runAction(internal.threads.sendMessage, {
        threadId: args.threadId,
        sender: "bot",
        text: decision.reply,
      });
    }
    await ctx.runAction(internal.threads.escalate, {
      threadId: args.threadId,
      reason: decision.escalationReason ?? "Bot could not confidently answer.",
    });
  },
});
