import { cx } from "@/components/ui";
import { priorityMeta, STATUS_LABELS, STATUS_PILL, type StatusKey } from "./shared";

/** Named priority level (Emergency / Urgent / Routine / Informational) with an optional small "n/10". */
export function PriorityChip({ level, score }: { level: string; score?: number | null }) {
  const meta = priorityMeta(level);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-medium",
        meta.chip,
      )}
    >
      {meta.label}
      {typeof score === "number" && Number.isFinite(score) ? (
        <span className="text-[10px] font-normal opacity-70">{Math.round(score)}/10</span>
      ) : null}
    </span>
  );
}

export function StatusPill({ statusKey, label }: { statusKey: StatusKey; label?: string }) {
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
        STATUS_PILL[statusKey] ?? STATUS_PILL.closed,
      )}
    >
      {label ?? STATUS_LABELS[statusKey]}
    </span>
  );
}
