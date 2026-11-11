/**
 * The Finalize dialog's staleness guard (pure, so scripts/probes/ros_build.test.mjs covers it).
 * The figures are captured when the dialog OPENS; finalize is sent those, and the dialog refuses
 * while the live statement's previewHash differs from the captured one.
 */

export const STATEMENT_CHANGED = "The statement changed since you opened this. Review it again.";

/** What the user saw when the Finalize dialog opened. */
export type Reviewed = { previewHash: string; expectedEndingCents: number; expectedAvailableCents: number };

export function captureReviewed(data: {
  previewHash: string;
  result: { summary: { ending: { total: number }; available: { total: number } } };
}): Reviewed {
  return {
    previewHash: data.previewHash,
    expectedEndingCents: data.result.summary.ending.total,
    expectedAvailableCents: data.result.summary.available.total,
  };
}

/** True when the live statement is no longer the one the dialog opened on. */
export function reviewChanged(reviewed: Reviewed, livePreviewHash: string): boolean {
  return reviewed.previewHash !== livePreviewHash;
}

/** The finalize mutation's staleness arguments: always the captured values, never the live ones. */
export function finalizeArgs(statementId: string, reviewed: Reviewed) {
  return {
    statementId,
    expectedEndingCents: reviewed.expectedEndingCents,
    expectedAvailableCents: reviewed.expectedAvailableCents,
    expectedHash: reviewed.previewHash,
  };
}
