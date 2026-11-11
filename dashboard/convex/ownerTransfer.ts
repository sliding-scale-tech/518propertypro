import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { CALL_SID_RE, ownerDialTwiml } from "./ownerRoutingLib";

/**
 * The Twilio half of transfer_owner_call (ownerRoutingLib.TRANSFER_MECHANISM "twilio_dial").
 * Scheduled by /tools/transfer-owner-call a few seconds after it returns, so Sarah has said her line.
 * Replaces the live call's TwiML with our own <Dial>, whose action URL (/twilio/owner-transfer-result)
 * keeps the caller on the line if the staff phone is busy or does not pick up.
 *
 * If this fails (Twilio refuses, the call already ended), nothing was redirected: the caller is still
 * talking to Sarah, who takes a message when they speak again (the prompt says so). A callback row is
 * written here too, so the team calls the owner back either way. Read-only GET first: never touches
 * a call that is not in progress.
 */
export const dial = internalAction({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    callSid: v.string(),
    label: v.string(),
    number: v.string(),
    digits: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const fail = async (why: string, callerNumber?: string) => {
      console.error(`[owner-transfer] ${args.elevenLabsConversationId}: ${why}`);
      await ctx.runMutation(internal.ownerRouting.logOwnerTransfer, {
        orgId: args.orgId,
        elevenLabsConversationId: args.elevenLabsConversationId,
        action: "owner_transfer_failed",
        to: args.label,
        note: `Could not put the call through to ${args.label}: ${why}. Sarah stays on the line to take a message.`,
      });
      try {
        await ctx.runMutation(internal.ownerRouting.takeStaffMessage, {
          orgId: args.orgId,
          elevenLabsConversationId: args.elevenLabsConversationId,
          person: args.label,
          callerNumber,
          message: `A verified owner asked to be put through to ${args.label}, but the transfer could not start (${why}). Please call them back.`,
        });
      } catch (err) {
        console.error("[owner-transfer] could not save the callback row:", err);
      }
    };

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const siteUrl = process.env.CONVEX_SITE_URL?.replace(/\/+$/, "");
    if (!sid || !token || !siteUrl) return fail("Twilio is not configured on this deployment");
    if (!CALL_SID_RE.test(args.callSid)) return fail("no phone call to transfer");

    const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${args.callSid}.json`;
    const auth = `Basic ${btoa(`${sid}:${token}`)}`;

    let call: { status?: string; to?: string; from?: string };
    try {
      const res = await fetch(callUrl, { headers: { Authorization: auth } });
      if (!res.ok) return fail(`Twilio would not look up the call (HTTP ${res.status})`);
      call = (await res.json()) as typeof call;
    } catch (err) {
      return fail(`Twilio lookup failed (${err instanceof Error ? err.message.slice(0, 120) : "network error"})`);
    }
    if (call.status !== "in-progress") return fail(`the call is ${call.status ?? "in an unknown state"}, not in progress`);
    // Sarah's own Twilio number (the number the owner rang). A number on the account, not the owner's
    // own: the blind transfer passed the owner's number through and the leg came back busy unrung.
    const callerId = call.to || process.env.TWILIO_SMS_FROM_NUMBER;
    if (!callerId) return fail("no caller ID to dial from", call.from);

    const twiml = ownerDialTwiml({
      number: args.number,
      digits: args.digits,
      callerId,
      actionUrl: `${siteUrl}/twilio/owner-transfer-result?c=${encodeURIComponent(args.elevenLabsConversationId)}`,
    });
    try {
      const res = await fetch(callUrl, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ Twiml: twiml }).toString(),
      });
      if (!res.ok) {
        let code = "";
        try {
          const j = (await res.json()) as { code?: number; message?: string };
          code = `${j.code ?? ""} ${(j.message ?? "").slice(0, 160)}`.trim();
        } catch {
          /* no body */
        }
        return fail(`Twilio refused the transfer (HTTP ${res.status}${code ? `, ${code}` : ""})`, call.from);
      }
    } catch (err) {
      return fail(`Twilio update failed (${err instanceof Error ? err.message.slice(0, 120) : "network error"})`, call.from);
    }
    await ctx.runMutation(internal.ownerRouting.logOwnerTransfer, {
      orgId: args.orgId,
      elevenLabsConversationId: args.elevenLabsConversationId,
      action: "owner_transfer_ringing",
      to: args.label,
      note: `Ringing ${args.label}. The caller hears ringing and stays on the line if nobody picks up.`,
    });
  },
});
