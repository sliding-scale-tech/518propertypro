/**
 * Reason presets for closing a maintenance request without a work order (reject / out of scope).
 * Pure module (no server imports) so the Convex functions and the UI share one list; the
 * old per-page list in components/maintenance/request-detail.tsx should import from here.
 */
export const OUT_OF_SCOPE_REASONS = [
  "Tenant responsibility under the lease",
  "Not a repair · passed to leasing",
  "Duplicate of an open work order",
  "Resolved on the call",
  "Other",
] as const;

export type OutOfScopeReason = (typeof OUT_OF_SCOPE_REASONS)[number];
