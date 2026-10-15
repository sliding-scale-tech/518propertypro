/** Joins class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "neutral" | "acc" | "ok" | "warn" | "bad" | "vio";

/** Soft background + ink colour per tone, shared by Pill, IconTile and Avatar. */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  acc: "bg-accent text-accent-foreground",
  ok: "bg-success-soft text-success-ink",
  warn: "bg-warning-soft text-warning-ink",
  bad: "bg-danger-soft text-danger-ink",
  vio: "bg-violet-soft text-violet",
};
