/**
 * What a tool result tells Sarah to say. Pure and free of Convex imports, so
 * scripts/probes/sarah_replies.test.mjs can run it directly.
 *
 * Sarah says it was logged once, when she closes the call. Only a life-safety result carries a say
 * line to speak straight away. A routine or urgent result carries closing_line instead: a say line
 * on an urgent result made her repeat "I've logged this" mid-intake
 * (conv_7301m6e31kq8fs8razf5mys7t6wj, request #1012).
 */
import type { SeverityLevel } from "./severity";

/**
 * ElevenLabs runs another LLM generation after every tool result, whether or not the caller has
 * spoken. Sent on results that can land after Sarah asked something, so she does not carry on and
 * answer her own question (conv_9001m6dzykqte399btbs28d2z4ss). It says nothing about skip_turn so it
 * also reads correctly on an agent that was published before skip_turn existed.
 */
export const WAIT_FOR_CALLER =
  "This result is not the caller's answer. If you have already asked something they have not answered, say nothing and wait for them.";

/** send_photo_link. Keeps the meaning (nothing is texted, the asset manager follows up) as a brief acknowledgement. */
export const PHOTO_SAY = "Thanks, your asset manager will follow up about photos.";

const EMERGENCY_ALERTED_SAY = "I've logged this as an emergency and alerted the team right away.";
const FOLLOW_UP_SOON = "I've logged this and the team will follow up with you as soon as possible.";
const OUT_OF_SCOPE_SAY =
  "I've noted that. This one is the resident's responsibility, so we won't be sending a technician for it.";

export type MaintenanceLogOutcome = {
  severity: SeverityLevel;
  /** True only when an emergency text was actually queued: Sarah may not claim it otherwise. */
  emergencyAlerted: boolean;
  /** The saved request, or null when there is no request row to report (the team was not resolved). */
  saved: { routedToAm: boolean; closedOutOfScope: boolean } | null;
};

export type MaintenanceLogLines =
  | { say: string; message: string }
  | { closing_line: string; message: string };

const speakNow = (say: string): MaintenanceLogLines => ({
  say,
  message: `Say the say line once. ${WAIT_FOR_CALLER}`,
});

const atClose = (closingLine: string): MaintenanceLogLines => ({
  closing_line: closingLine,
  message: `Logged. Keep going with the next step. Say closing_line once, only when you close the call. ${WAIT_FOR_CALLER}`,
});

/** The spoken part of a logged:true log_maintenance_request result. */
export function maintenanceLogLines({ severity, emergencyAlerted, saved }: MaintenanceLogOutcome): MaintenanceLogLines {
  if (saved?.closedOutOfScope) return speakNow(OUT_OF_SCOPE_SAY);
  if (severity === "emergency") return speakNow(emergencyAlerted ? EMERGENCY_ALERTED_SAY : FOLLOW_UP_SOON);
  if (!saved) return atClose("I've logged that and the team will follow up with you.");
  if (severity === "urgent") return atClose(FOLLOW_UP_SOON);
  return atClose(
    saved.routedToAm
      ? "I've logged that and sent it to the asset manager for your building to review. They'll follow up with you about next steps."
      : "I've logged that and the team will match it to your unit and follow up with you.",
  );
}
