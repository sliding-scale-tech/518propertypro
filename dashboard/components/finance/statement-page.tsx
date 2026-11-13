"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatPeriod } from "@/convex/rosFormat";
import { Drawer, Pill } from "@/components/ui";
import { DownloadStatementPdfButton } from "@/components/finance/pdf/download-button";
import type { StatementData } from "./finalize-dialogs";
import { FinanceNav } from "./finance-nav";
import { Spinner } from "./form-bits";
import { StepBanner, StepNav, Stepper, TotalsBar } from "./statement-chrome";
import { CheckStep } from "./statement-check";
import { LinesStep, useStatementActions } from "./statement-lines";
import { PayoutStep } from "./statement-payout";
import { StatementPreview } from "./statement-preview";
import { ReviewStep } from "./statement-review";
import { groupWarnings, readStep, stepLabel, stepStates, totalsOf, type StepId } from "./statement-steps";
import { StatusPill } from "./statements-list";
import { revealSection } from "./warning-links";

/**
 * `/owner-statements/[id]` (spec 6.3), as a guided workflow: Check · Money in · Money out ·
 * Fees & payout · Review & finalize. The step is in the URL (`?step=`); every step can be opened at
 * any time, and the totals bar with Preview and the PDF is on every step. A final statement opens on
 * Review, read-only.
 */
export function StatementPage({ statementId }: { statementId: string }) {
  const data = useQuery(api.ownerStatements.get, { statementId });

  if (data === undefined) {
    return (
      <div className="pb-10">
        <FinanceNav active="statements" />
        <Spinner label="Building the statement…" />
      </div>
    );
  }
  return <Workflow data={data} />;
}

function Workflow({ data }: { data: StatementData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { statement, owner } = data;
  const isDraft = statement.status === "draft";
  const step = readStep(params.get("step"), statement.status);
  const [previewOpen, setPreviewOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The step a click asked for, and the section to reveal there, until that step renders. */
  const pending = useRef<{ step: StepId; reveal: string | null } | null>(null);
  const ctl = useStatementActions(data);

  const grouped = useMemo(
    () => groupWarnings(data.warnings, data.properties, owner._id),
    [data.warnings, data.properties, owner._id],
  );
  const states = useMemo(() => stepStates({ status: statement.status, warnings: data.warnings }), [statement.status, data.warnings]);
  const totals = totalsOf(data.result);

  const arrive = useCallback((reveal: string | null) => {
    requestAnimationFrame(() => {
      if (reveal && revealSection(reveal)) return;
      topRef.current?.scrollIntoView({ block: "start" });
      headingRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const goStep = useCallback(
    (next: StepId, reveal?: string | null) => {
      if (next === step) {
        arrive(reveal ?? null);
        return;
      }
      pending.current = { step: next, reveal: reveal ?? null };
      const q = new URLSearchParams(params.toString());
      q.set("step", next);
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [arrive, params, pathname, router, step],
  );

  // Once the asked-for step renders: back to the top of the steps (or to the section a Check item
  // points at), with focus on the step's heading for keyboard and screen-reader users.
  useEffect(() => {
    const p = pending.current;
    if (!p || p.step !== step) return;
    pending.current = null;
    arrive(p.reveal);
  }, [step, arrive]);

  const bannerFor = (s: StepId) => {
    const items = [grouped.statement, ...grouped.properties].flatMap((g) => [...g.fix, ...g.look]).filter((i) => i.step === s);
    return isDraft ? <StepBanner items={items} /> : null;
  };

  return (
    <div className="pb-10 lg:pb-24">
      <nav aria-label="Breadcrumb" className="mb-2 text-[12.5px] text-muted-foreground">
        <Link href="/owner-statements" className="hover:text-foreground hover:underline">
          Owner reports
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/owner-statements/owners/${owner._id}`} className="hover:text-foreground hover:underline">
          {owner.legalName}
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/owner-statements?month=${statement.month}`} className="hover:text-foreground hover:underline">
          {statement.monthLabel}
        </Link>
      </nav>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-balance text-[26px] font-bold leading-[1.2] tracking-[-0.02em]">
            {owner.legalName}: {statement.monthLabel}
          </h1>
          <StatusPill status={statement.status} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
          <span>{formatPeriod(statement.periodStart, statement.periodEnd)}</span>
          <span aria-hidden>·</span>
          <span>{data.properties.length === 1 ? "Property:" : `${data.properties.length} properties:`}</span>
          {data.properties.map((p) => (
            <Pill key={p.propertyId}>{p.name}</Pill>
          ))}
        </div>
      </header>

      {statement.status === "discarded" ? (
        <div className="mb-4 rounded-2xl border border-danger-ink/30 bg-danger-soft px-4 py-3 text-[13.5px] text-danger-ink">
          This draft was discarded. Nothing on it was billed. Generate the month again from the statements list.
        </div>
      ) : null}
      {statement.status === "final" ? (
        <p className="mb-3 text-[12.5px] text-muted-foreground">This statement is final. Every step is view only.</p>
      ) : null}

      <div ref={topRef} className="scroll-mt-20">
        <Stepper current={step} states={states} readOnly={!isDraft} onSelect={(s) => goStep(s)} />
      </div>
      <TotalsBar
        totals={totals}
        statementId={statement._id}
        isFinal={statement.status === "final"}
        canPdf={statement.status !== "discarded"}
        onPreview={() => setPreviewOpen(true)}
      />

      <section aria-labelledby="step-heading">
        <h2
          id="step-heading"
          ref={headingRef}
          tabIndex={-1}
          className="mb-3 text-[20px] font-semibold tracking-[-0.01em] outline-none"
        >
          {stepLabel(step)}
        </h2>
        {step === "check" ? <CheckStep data={data} grouped={grouped} onGoStep={goStep} /> : null}
        {step === "in" ? <LinesStep data={data} step="in" ctl={ctl} banner={bannerFor("in")} /> : null}
        {step === "out" ? <LinesStep data={data} step="out" ctl={ctl} banner={bannerFor("out")} /> : null}
        {step === "payout" ? <PayoutStep data={data} ctl={ctl} banner={bannerFor("payout")} /> : null}
        {step === "review" ? (
          <ReviewStep data={data} onGoStep={(s) => goStep(s)} onOpenPreview={() => setPreviewOpen(true)} />
        ) : null}
        <StepNav current={step} onSelect={(s) => goStep(s)} />
      </section>

      {ctl.dialogs}

      <Drawer
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Statement preview"
        eyebrow={isDraft ? "Draft: the numbers update as you edit" : undefined}
        width={1040}
      >
        <div className="flex flex-wrap items-center gap-2">
          {statement.status !== "discarded" ? (
            <DownloadStatementPdfButton
              statementId={statement._id}
              draft={statement.status !== "final"}
              label={statement.status === "final" ? "Download PDF" : "Preview PDF"}
            />
          ) : null}
          {isDraft ? <span className="text-xs text-muted-foreground">The preview PDF is marked DRAFT.</span> : null}
        </div>
        <StatementPreview view={data.view} draft={isDraft} />
      </Drawer>
    </div>
  );
}
