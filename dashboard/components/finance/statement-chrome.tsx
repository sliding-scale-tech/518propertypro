"use client";

import { AlertOctagon, AlertTriangle, Check, ChevronDown, Eye } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCurrency } from "@/convex/rosFormat";
import { DownloadStatementPdfButton } from "@/components/finance/pdf/download-button";
import { Btn, Select, cx } from "@/components/ui";
import { LinkBtn } from "./form-bits";
import {
  STEPS,
  nextStep,
  prevStep,
  stepIndex,
  stepLabel,
  type CheckItem,
  type StepId,
  type StepState,
  type StepStatus,
  type Totals,
} from "./statement-steps";

const STATUS_TEXT: Record<StepStatus, string> = {
  done: "Done",
  attention: "Needs attention",
  info: "Worth a look",
};

function StatusDot({ status, number, current }: { status: StepStatus; number: number; current: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12.5px] font-semibold",
        current ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-card text-muted-foreground",
      )}
    >
      {number}
      <span
        className={cx(
          "absolute -right-1 -top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-card text-[8px] font-bold leading-none text-white",
          status === "done" && "bg-success-ink",
          status === "attention" && "bg-danger-ink",
          status === "info" && "bg-warning-ink",
        )}
      >
        {status === "done" ? <Check className="h-2 w-2" strokeWidth={4} /> : status === "attention" ? "!" : ""}
      </span>
    </span>
  );
}

function stepSub(id: StepId, st: StepState, readOnly: boolean): string {
  if (readOnly) return id === "review" ? "Final" : "View only";
  if (id === "review") return st.fix > 0 ? "Blocked" : "Finalize";
  if (st.fix > 0) return `${st.fix} to fix`;
  if (st.look > 0) return `${st.look} to check`;
  return "Done";
}

/**
 * The step bar. Desktop: the five steps across, each with a status dot (✓ done / ! needs attention
 * / • worth a look). Mobile: "Step 2 of 5" with a dropdown to jump. Every step is open at any time.
 */
export function Stepper({
  current,
  states,
  readOnly,
  onSelect,
}: {
  current: StepId;
  states: Record<StepId, StepState>;
  readOnly: boolean;
  onSelect: (id: StepId) => void;
}) {
  const idx = stepIndex(current);
  return (
    <nav aria-label="Statement steps" className="mb-4">
      <ol className="hidden items-stretch gap-1 rounded-2xl border border-border bg-card p-1.5 md:flex">
        {STEPS.map((s, i) => {
          const st = states[s.id];
          const on = s.id === current;
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                aria-current={on ? "step" : undefined}
                onClick={() => onSelect(s.id)}
                className={cx(
                  "flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  on ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <StatusDot status={st.status} number={i + 1} current={on} />
                <span className="min-w-0">
                  <span className={cx("block truncate text-[13px]", on ? "font-semibold" : "font-medium")}>{s.label}</span>
                  <span
                    className={cx(
                      "block truncate text-[11.5px]",
                      readOnly
                        ? "text-muted-foreground"
                        : st.status === "attention"
                          ? "text-danger-ink"
                          : st.status === "info"
                            ? "text-warning-ink"
                            : "text-muted-foreground",
                    )}
                  >
                    {stepSub(s.id, st, readOnly)}
                  </span>
                  <span className="sr-only">{`, ${STATUS_TEXT[st.status]}`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-3 md:hidden">
        <StatusDot status={states[current].status} number={idx + 1} current />
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] text-muted-foreground">
            Step {idx + 1} of {STEPS.length}
          </div>
          <Select
            aria-label="Go to step"
            value={current}
            onChange={(e) => {
              const v = e.target.value as StepId;
              if (v) onSelect(v);
            }}
          >
            {STEPS.map((s, i) => (
              <option key={s.id} value={s.id} data-sublabel={`${STATUS_TEXT[states[s.id].status]} · ${stepSub(s.id, states[s.id], readOnly)}`}>
                {`${i + 1}. ${s.label}`}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </nav>
  );
}

/** Back / Continue at the bottom of a step. */
export function StepNav({ current, onSelect }: { current: StepId; onSelect: (id: StepId) => void }) {
  const prev = prevStep(current);
  const next = nextStep(current);
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      {prev ? <Btn onClick={() => onSelect(prev)}>← {stepLabel(prev)}</Btn> : <span />}
      {next ? (
        <Btn variant="pri" onClick={() => onSelect(next)}>
          Continue to {stepLabel(next)} →
        </Btn>
      ) : null}
    </div>
  );
}

/** The warnings about one step, shown above its content (the full list is on Check). */
export function StepBanner({ items }: { items: CheckItem[] }) {
  if (items.length === 0) return null;
  const fix = items.some((i) => i.tone === "fix");
  return (
    <div
      className={cx(
        "rounded-2xl border px-4 py-3",
        fix ? "border-danger-ink/30 bg-danger-soft" : "border-warning-ink/30 bg-warning-soft",
      )}
    >
      <ul className="flex flex-col gap-2 text-[13px]">
        {items.map((it) => (
          <li key={it.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="flex min-w-0 flex-1 items-start gap-2">
              {it.tone === "fix" ? (
                <AlertOctagon aria-label="Blocks finalizing" className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" />
              ) : (
                <AlertTriangle aria-label="Worth a look" className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" />
              )}
              <span>{it.message}</span>
            </span>
            {it.action?.kind === "href" ? (
              <LinkBtn href={it.action.href} className="self-start sm:self-auto">
                {it.action.label}
              </LinkBtn>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="whitespace-nowrap text-[11px] text-muted-foreground">
        {label}
        {hint ? <span className="sr-only"> ({hint})</span> : null}
      </div>
      <div className={cx("whitespace-nowrap tabular-nums", strong ? "text-[15px] font-semibold" : "text-[13.5px] font-medium")}>
        {value}
      </div>
    </div>
  );
}

/**
 * The totals (server figures) with Preview and the PDF, on every step. Desktop: a slim bar fixed
 * to the bottom of the window. Mobile: a compact card under the step bar.
 */
export function TotalsBar({
  totals,
  statementId,
  isFinal,
  canPdf,
  onPreview,
}: {
  totals: Totals;
  statementId: string;
  isFinal: boolean;
  /** False on a discarded draft (no PDF). */
  canPdf: boolean;
  onPreview: () => void;
}) {
  const [more, setMore] = useState(false);
  const sid = statementId as Id<"ownerStatements">;
  const items: { label: string; value: string; hint?: string; strong?: boolean }[] = [
    { label: "Income", value: formatCurrency(totals.incomeCents) },
    { label: "Expenses", value: formatCurrency(totals.expensesCents), hint: "Includes the management fee" },
    { label: "Fee", value: formatCurrency(totals.feeCents) },
    { label: "Owner draw", value: formatCurrency(totals.drawCents) },
    { label: "Ending cash", value: formatCurrency(totals.endingCents), strong: true },
    { label: "Available", value: formatCurrency(totals.availableCents), hint: "Available for payment", strong: true },
  ];
  const pdf: ReactNode = canPdf ? (
    <DownloadStatementPdfButton statementId={sid} draft={!isFinal} label={isFinal ? "Download PDF" : "Preview PDF"} />
  ) : null;
  const preview = (
    <Btn onClick={onPreview} aria-haspopup="dialog">
      <Eye aria-hidden className="h-4 w-4" /> Preview
    </Btn>
  );

  return (
    <>
      {/* Mobile and tablet: inline card. */}
      <section aria-label="Statement totals" className="mb-4 rounded-2xl border border-border bg-card px-4 py-3 lg:hidden">
        <div className="grid grid-cols-2 gap-3">
          <Stat {...items[4]} />
          <Stat {...items[5]} />
        </div>
        {more ? (
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
            {items.slice(0, 4).map((it) => (
              <Stat key={it.label} {...it} />
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className="mr-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring"
          >
            {more ? "Fewer totals" : "All totals"}
            <ChevronDown aria-hidden className={cx("h-3.5 w-3.5 transition-transform", more && "rotate-180")} />
          </button>
          {preview}
          {pdf}
        </div>
      </section>

      {/* Desktop: fixed to the bottom of the window (beside the sidebar). */}
      <section
        aria-label="Statement totals"
        className="fixed bottom-0 left-64 right-0 z-30 hidden border-t border-border bg-card/95 px-8 py-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm lg:block"
      >
        <div className="flex items-center gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-6 overflow-x-auto">
            {items.map((it, i) => (
              <div key={it.label} className={cx("flex items-center gap-6", i === 4 && "border-l border-border pl-6")}>
                <Stat {...it} />
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {preview}
            {pdf}
          </div>
        </div>
      </section>
    </>
  );
}
