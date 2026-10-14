/**
 * Resident issue severity, 1-10. Unlike leadScoring, this number is the agent's judgment
 * rather than a deterministic computation — triage genuinely needs to weigh what the caller
 * describes. SEVERITY_RUBRIC is the single source of truth for what each band means: it is
 * interpolated into the agent's system prompt AND rendered verbatim on the Tenants page, so
 * "why is this a 7?" always has the same answer in both places.
 *
 * Staff can override any score on the page; the original is preserved on the issue row.
 */

export const MAX_SEVERITY = 10;

export const SEVERITY_RUBRIC = [
  {
    band: "9-10",
    label: "Emergency",
    detail:
      "Fire, gas smell, flooding, sewage backup, no heat in freezing weather, a break-in — " +
      "anything with a safety or medical dimension.",
  },
  {
    band: "7-8",
    label: "Urgent",
    detail:
      "Unlivable within a day: no hot water, no power, no A/C in heat, dead fridge, lockout, " +
      "broken exterior door or lock.",
  },
  {
    band: "5-6",
    label: "Real problem",
    detail:
      "Needs a real repair but the unit is livable: contained leak, broken appliance, pests, " +
      "a repeated noise complaint, or a smoke or fire alarm sounding continuously and not " +
      "resetting.",
  },
  {
    band: "3-4",
    label: "Routine",
    detail:
      "Minor and schedulable: dripping faucet, burnt-out bulb, squeaky door, an alarm " +
      "chirping intermittently for a low battery, parking or amenity question.",
  },
  {
    band: "1-2",
    label: "Informational",
    detail: "No repair needed: billing question, lease copy, a package, a general question.",
  },
] as const;

export type SeverityBand = "high" | "medium" | "low";

/** Groups the 1-10 score into the three buckets the UI colours by. */
export function severityBand(severity: number): SeverityBand {
  if (severity >= 7) return "high";
  if (severity >= 4) return "medium";
  return "low";
}

/**
 * Server-side guard on anything the model sends. In practice it will occasionally hand back
 * "7" as a string, or a 0, or an 11 — none of which should reach the database or throw.
 * Defaults to the middle of the scale rather than an extreme when the value is unusable.
 */
export function clampSeverity(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return 5;
  return Math.min(MAX_SEVERITY, Math.max(1, Math.round(n)));
}
