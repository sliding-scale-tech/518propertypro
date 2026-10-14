/**
 * Deterministic lead score (0-100) — no LLM involved, so it's reproducible and explainable to
 * the property manager. Every point value here is mirrored in RUBRIC below, which the
 * Settings page renders verbatim so "why did this lead score 72?" always has a real answer.
 */

export type Qualification = {
  callerName?: string;
  callerPhone?: string;
  bedrooms?: string;
  moveInDate?: string;
  budget?: number;
  petsWanted?: boolean;
  qualifies?: boolean;
  tourConfirmed?: boolean;
} | null | undefined;

export const MAX_SCORE = 10;

export const RUBRIC = [
  { points: 1, label: "Base score", detail: "Every call starts here; the points above are added on top." },
  { points: 2, label: "Reachable", detail: "Provided a name and a callback number." },
  { points: 2, label: "Fully qualified", detail: "All five fields captured (unit, timeline, budget, pets, contact) — not an abandoned or partial call." },
  { points: 2, label: "Passed the fit check", detail: "Not disqualified on budget or pet policy — a real match for an available unit." },
  { points: 1, label: "Moving soon", detail: "Move-in timeline reads as within about 30 days — urgency signals a live search, not idle browsing." },
  { points: 2, label: "Tour booked", detail: "Actually scheduled a tour — the strongest buying signal in a call." },
] as const;

/** Very loose natural-language timeline check — deliberately permissive, not a date parser. */
function looksLikeSoon(moveInDate?: string): boolean {
  if (!moveInDate) return false;
  const s = moveInDate.toLowerCase();
  return /(asap|immediately|right away|this week|next week|within a month|30 days|two weeks|couple of weeks)/.test(
    s,
  );
}

export function computeLeadScore(q: Qualification): number {
  let score = 1; // base

  if (q?.callerName && q?.callerPhone) score += 2;
  if (q?.bedrooms && q?.moveInDate && q?.budget !== undefined && q?.petsWanted !== undefined) {
    score += 2;
  }
  if (q?.qualifies === true) score += 2;
  if (looksLikeSoon(q?.moveInDate)) score += 1;
  if (q?.tourConfirmed) score += 2;

  // A confirmed disqualification caps the score low regardless of the above — an unreachable
  // or ineligible lead isn't a near-term opportunity even if they were quick to respond.
  if (q?.qualifies === false) score = Math.min(score, 4);

  return Math.max(0, Math.min(MAX_SCORE, score));
}

export function scoreBand(score: number): "high" | "medium" | "low" {
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}
