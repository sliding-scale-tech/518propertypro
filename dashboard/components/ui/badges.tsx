import type { ReactNode } from "react";
import { cx, TONE_SOFT, type Tone } from "./cx";

/** Small rounded status label. `dot` adds a leading coloured dot. */
export function Pill({
  tone = "neutral",
  dot = false,
  children,
  className,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-xs font-medium leading-5",
        TONE_SOFT[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export type SevLevel = "emergency" | "urgent" | "routine" | "informational";

const SEV_TONE: Record<SevLevel, string> = {
  emergency: "bg-danger-soft text-danger-ink",
  urgent: "bg-warning-soft text-warning-ink",
  routine: "bg-accent text-accent-foreground",
  informational: "bg-muted text-muted-foreground",
};
const SEV_LABEL: Record<SevLevel, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  routine: "Routine",
  informational: "Info",
};

/** Severity chip: "8/10" coloured by the named level, or the level label when there is no score. */
export function SevChip({ level, score, className }: { level: SevLevel; score?: number; className?: string }) {
  const hasScore = typeof score === "number" && Number.isFinite(score);
  return (
    <span
      title={SEV_LABEL[level]}
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-[7px] px-[7px] font-mono text-[11px] font-semibold leading-[18px]",
        SEV_TONE[level],
        className,
      )}
    >
      {hasScore ? `${Math.round(score)}/10` : SEV_LABEL[level]}
    </span>
  );
}

export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

const AVATAR_TONE: Record<"acc" | "vio" | "ok" | "warn", string> = {
  acc: "bg-accent text-accent-foreground",
  vio: "bg-violet-soft text-violet",
  ok: "bg-success-soft text-success-ink",
  warn: "bg-warning-soft text-warning-ink",
};

/** Initials avatar. Convention: admin = warn, asset manager = acc, technician = ok, accountant = vio. */
export function Avatar({
  name,
  tone = "acc",
  size = "md",
  className,
}: {
  name: string;
  tone?: "acc" | "vio" | "ok" | "warn";
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      title={name}
      aria-label={name}
      role="img"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" ? "h-[22px] w-[22px] text-[9.5px]" : "h-[30px] w-[30px] text-[11px]",
        AVATAR_TONE[tone],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** The 32px rounded icon square at the start of a ListRow. */
export function IconTile({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:h-4 [&_svg]:w-4",
        TONE_SOFT[tone],
      )}
    >
      {children}
    </span>
  );
}
