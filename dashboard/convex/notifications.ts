import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import * as twilio from "./twilioApi";

export const sendTourConfirmation = internalAction({
  args: { to: v.string(), propertyName: v.string(), slot: v.string() },
  handler: (_ctx, args) =>
    twilio.sendSms(
      args.to,
      `Your tour at ${args.propertyName} is confirmed for ${args.slot}. See you then!`,
    ),
});

/** Texts staff a one-line summary after every call ends, not just escalations. */
export const sendCallSummary = internalAction({
  args: { summary: v.string(), callerNumber: v.string(), durationSec: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const staffNumber = await ctx.runQuery(internal.orgSettings.staffPhoneNumberInternal, {});
    if (!staffNumber) return;

    const minutes = Math.floor(args.durationSec / 60);
    const seconds = args.durationSec % 60;
    await twilio
      .sendSms(
        staffNumber,
        `Call summary — ${args.callerNumber}, ${minutes}m ${seconds}s: ${args.summary}`.slice(
          0,
          320,
        ),
      )
      .catch(() => {
        // The summary is still visible in the dashboard even if the SMS ping fails.
      });
  },
});

export const sendEscalationAlert = internalAction({
  args: {
    to: v.string(),
    reason: v.string(),
    summary: v.string(),
    callerPhone: v.string(),
  },
  handler: (_ctx, args) =>
    twilio.sendSms(
      args.to,
      `Leasing line escalation (${args.reason}). Caller: ${args.callerPhone}. ${args.summary}`.slice(
        0,
        320,
      ),
    ),
});
