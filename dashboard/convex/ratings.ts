import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { realValue } from "./sanitize";

/**
 * Feedback from the landing page's "Try yourself" demo (see call-demo-widget.tsx and
 * use-live-call.ts) — never shown on the dashboard's own /call.
 *
 * Submitted in two steps, matching the two-step popup: this writes the star rating the
 * moment it's picked, so a rating is captured even if the person closes the modal at the
 * email prompt that follows. attachEmail below patches an email onto that same row only if
 * they go on to give one.
 */
export const submit = mutation({
  args: {
    sessionId: v.string(),
    conversationId: v.optional(v.id("conversations")),
    rating: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) {
      throw new Error("rating must be a whole number from 1 to 5");
    }
    return ctx.db.insert("callRatings", {
      sessionId: args.sessionId,
      conversationId: args.conversationId,
      rating: args.rating,
      createdAt: Date.now(),
    });
  },
});

/**
 * Attaches an email to an already-submitted rating and sends the transcript to it. Silently
 * does nothing on a blank or placeholder value ("n/a", "none", ...) rather than storing
 * garbage — see sanitize.ts.
 *
 * The send is scheduled rather than awaited here: a mutation can't make the outbound fetch to
 * Resend itself, and a customer closing the modal shouldn't wait on an email provider anyway.
 */
export const attachEmail = mutation({
  args: {
    ratingId: v.id("callRatings"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const email = realValue(args.email);
    if (!email) return;
    await ctx.db.patch(args.ratingId, { email });
    await ctx.scheduler.runAfter(0, internal.transcriptEmail.send, { ratingId: args.ratingId });
  },
});
