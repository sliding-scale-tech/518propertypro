import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import * as resend from "./resendApi";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Plain inline-styled HTML, not a stylesheet or flexbox/grid: this has to render in Gmail,
 * Outlook and Apple Mail, none of which reliably support a `<style>` block or modern CSS
 * layout in an email body. Colors and radii are pulled from landing.css's own palette so the
 * email reads as the same product as the page the call happened on.
 */
/*
 * Plain-text half of the multipart message — see the note on sendEmail in resendApi.ts. A
 * transcript is a conversation, so it reads perfectly well as speaker-labelled lines.
 */
function renderTranscriptText(messages: Array<{ role: "user" | "agent"; text: string }>): string {
  const lines = messages.map((m) => `${m.role === "agent" ? "AI Receptionist" : "You"}: ${m.text}`);
  return ["Your Simplr demo call transcript", "", ...lines, "", "Simplr"].join("\n");
}

function renderTranscriptEmail(messages: Array<{ role: "user" | "agent"; text: string }>): string {
  const bubbles = messages
    .map((m) => {
      const isAgent = m.role === "agent";
      return `
        <div style="margin:0 0 14px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${
            isAgent ? "#2563eb" : "#68707d"
          };margin-bottom:4px;">${isAgent ? "AI Receptionist" : "You"}</div>
          <div style="display:inline-block;max-width:100%;padding:12px 14px;border-radius:14px;font-size:14px;line-height:1.5;color:#111318;background:${
            isAgent ? "#eef5ff" : "#f4f6fa"
          };">${escapeHtml(m.text)}</div>
        </div>`;
    })
    .join("");

  const dateStr = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef1f6;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 18px 60px rgba(34,68,112,0.10);">
            <tr>
              <td style="padding:32px 32px 24px;border-bottom:1px solid #e8edf4;">
                <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;">Simplr</div>
                <div style="font-size:22px;font-weight:700;color:#111318;margin-top:6px;">Your call transcript</div>
                <div style="font-size:14px;color:#68707d;margin-top:4px;">From your "Try yourself" demo call &middot; ${dateStr}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;">
                ${bubbles || `<div style="font-size:14px;color:#68707d;">No transcript was captured for this call.</div>`}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;border-top:1px solid #e8edf4;">
                <div style="font-size:13px;color:#8b94a3;line-height:1.6;">
                  This was a demo call with Simplr's AI leasing assistant, not a real apartment
                  inquiry. Want this answering calls for your own properties, day and night? Just
                  reply to this email.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export const ratingById = internalQuery({
  args: { ratingId: v.id("callRatings") },
  handler: (ctx, args) => ctx.db.get(args.ratingId),
});

/**
 * Fired once a "Try yourself" rating gets an email attached (see ratings.attachEmail). A
 * separate action rather than inline in that mutation because mutations can't make outbound
 * network calls — sending is a fetch to Resend, the same way ElevenLabs and Twilio calls work
 * elsewhere in this codebase.
 */
export const send = internalAction({
  args: { ratingId: v.id("callRatings") },
  handler: async (ctx, args): Promise<void> => {
    const rating = await ctx.runQuery(internal.transcriptEmail.ratingById, {
      ratingId: args.ratingId,
    });
    if (!rating?.email || !rating.conversationId) return;

    const transcript = await ctx.runQuery(api.conversations.transcript, {
      conversationId: rating.conversationId,
    });

    const html = renderTranscriptEmail(
      transcript.filter((m) => m.isFinal).map((m) => ({ role: m.role, text: m.text })),
    );

    await resend.sendEmail({
      to: rating.email,
      subject: "Your Simplr demo call transcript",
      html,
      text: renderTranscriptText(
        transcript.filter((m) => m.isFinal).map((m) => ({ role: m.role, text: m.text })),
      ),
    });
  },
});
