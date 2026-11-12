// Pure ordering for the exceptions queue (no Convex imports, so it can be unit tested).

export type ExceptionSortRow = {
  reason: string;
  /** 0 = emergency (worst) ... 3 = informational (see SEVERITY_RANK in maintenance.ts). */
  severityRank: number;
  createdAt: number;
};

/**
 * Orders the queue so every emergency is on page 1 before any non-emergency: reason groups go by
 * their WORST severity (emergency groups first; ties by reason name so a group stays contiguous),
 * then severity within a group, then oldest first.
 */
export function sortExceptionRows<T>(rows: T[], pick: (row: T) => ExceptionSortRow): T[] {
  const worst = new Map<string, number>();
  for (const r of rows) {
    const { reason, severityRank } = pick(r);
    const seen = worst.get(reason);
    if (seen === undefined || severityRank < seen) worst.set(reason, severityRank);
  }
  return [...rows].sort((a, b) => {
    const x = pick(a);
    const y = pick(b);
    return (
      (worst.get(x.reason) ?? 0) - (worst.get(y.reason) ?? 0) ||
      x.reason.localeCompare(y.reason) ||
      x.severityRank - y.severityRank ||
      x.createdAt - y.createdAt
    );
  });
}
