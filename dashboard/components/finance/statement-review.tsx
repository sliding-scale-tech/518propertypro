"use client";

import { AlertOctagon, CheckCircle2, Clock, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate, formatPeriod } from "@/convex/rosFormat";
import { DownloadStatementPdfButton } from "@/components/finance/pdf/download-button";
import { Btn, Card } from "@/components/ui";
import { DiscardDialog, FinalizeDialog, finalizeBlocker, type StatementData } from "./finalize-dialogs";
import { captureReviewed, type Reviewed } from "./finalize-guard";
import { HistoryCard } from "./history-card";
import { formatStamp } from "./months";
import { StatementPreview } from "./statement-preview";
import { lockSummary, type StepId } from "./statement-steps";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Step 5 "Review & finalize": is it ready, the statement summary (summary by property and income
 * statement, the preview's own strings), what finalizing locks, Finalize (the frozen-review guard)
 * and the PDF. Discard is secondary. A final statement opens here, read-only, with Download PDF.
 */
export function ReviewStep({
  data,
  onGoStep,
  onOpenPreview,
}: {
  data: StatementData;
  onGoStep: (step: StepId) => void;
  onOpenPreview: () => void;
}) {
  const router = useRouter();
  const { statement } = data;
  const isDraft = statement.status === "draft";
  const isFinal = statement.status === "final";
  const [finalizing, setFinalizing] = useState<Reviewed | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const sid = statement._id as Id<"ownerStatements">;
  const blocker = finalizeBlocker(data);
  const nBlocking = data.warnings.blocking.length;
  const lock = lockSummary(data.lines);
  const names = data.properties.map((p) => p.name).join(", ");

  return (
    <div className="flex flex-col gap-4">
      {isDraft ? (
        <Card className={nBlocking > 0 ? "!border-danger-ink/40" : data.canFinalize ? "!border-success-ink/40" : undefined}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {nBlocking > 0 ? (
                <AlertOctagon aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-danger-ink" />
              ) : data.canFinalize ? (
                <CheckCircle2 aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-success-ink" />
              ) : (
                <Clock aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-warning-ink" />
              )}
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold">
                  {nBlocking > 0
                    ? `${plural(nBlocking, "item", "items")} to fix before finalizing`
                    : data.canFinalize
                      ? "Ready to finalize"
                      : "Not ready to finalize yet"}
                </h3>
                <p className="text-[13px] text-muted-foreground">
                  {nBlocking > 0
                    ? "Fix them on the Check step, then come back here."
                    : data.canFinalize
                      ? "Look over the summary below (or the full preview), then finalize."
                      : blocker}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {nBlocking > 0 ? (
                <Btn onClick={() => onGoStep("check")}>Go to Check</Btn>
              ) : null}
              <Btn
                variant="pri"
                disabled={!data.canFinalize}
                title={blocker ?? undefined}
                aria-describedby={blocker ? `${statement._id}-blocker` : undefined}
                onClick={() => setFinalizing(captureReviewed(data))}
              >
                <Lock aria-hidden className="h-4 w-4" /> Finalize…
              </Btn>
              {blocker ? (
                <p id={`${statement._id}-blocker`} className="sr-only">
                  {blocker}
                </p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : isFinal ? (
        <Card className="!border-success-ink/40">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <CheckCircle2 aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-success-ink" />
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold">Final</h3>
                <p className="text-[13px] text-muted-foreground">
                  {statement.statementDate ? `Statement date ${formatDate(statement.statementDate)}. ` : ""}
                  {statement.finalizedAt !== undefined
                    ? `Finalized ${formatStamp(statement.finalizedAt)}${statement.finalizedByName ? ` by ${statement.finalizedByName}` : ""}. `
                    : ""}
                  Corrections go on next month&apos;s statement. Emailing statements to owners comes later.
                </p>
              </div>
            </div>
            <DownloadStatementPdfButton statementId={sid} draft={false} label="Download PDF" />
          </div>
        </Card>
      ) : null}

      <StatementPreview view={data.view} draft={isDraft} sections={["summary", "income"]} />
      <div className="-mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span>The detail of every transaction is in the full preview and the PDF.</span>
        <button type="button" onClick={onOpenPreview} className="font-medium text-primary hover:underline">
          Open full preview
        </button>
      </div>

      {isDraft ? (
        <Card>
          <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
            <Lock aria-hidden className="h-4 w-4 text-muted-foreground" /> What finalizing locks
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]">
            <li>
              {statement.monthLabel} ({formatPeriod(statement.periodStart, statement.periodEnd)}) for {names}. Nothing on it
              can change afterwards; corrections go on next month&apos;s statement.
            </li>
            {lock.workOrders.length > 0 ? (
              <li>
                {plural(lock.workOrders.length, "work order is", "work orders are")} billed to the owner:{" "}
                {lock.workOrders.join(", ")}.
              </li>
            ) : null}
            {lock.rentPayments > 0 ? <li>{plural(lock.rentPayments, "rent payment is", "rent payments are")} marked billed.</li> : null}
            {lock.transactions > 0 ? (
              <li>{plural(lock.transactions, "other transaction is", "other transactions are")} marked billed.</li>
            ) : null}
            {lock.fees + lock.draws > 0 ? (
              <li>
                The management fee{lock.fees === 1 ? "" : "s"} and owner draw{lock.draws === 1 ? "" : "s"} are written to the
                owner ledger.
              </li>
            ) : null}
            <li>Lines left off stay unbilled and come back on next month&apos;s draft.</li>
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DownloadStatementPdfButton statementId={sid} draft label="Preview PDF" />
            <span className="text-xs text-muted-foreground">The preview PDF is marked DRAFT.</span>
          </div>
        </Card>
      ) : null}

      <HistoryCard statementId={statement._id} />

      {isDraft ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-[12.5px] text-muted-foreground">
          <span>Started this month by mistake?</span>
          <button
            type="button"
            onClick={() => setDiscarding(true)}
            className="font-medium text-danger-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Discard this draft
          </button>
        </div>
      ) : null}

      {finalizing ? (
        <FinalizeDialog
          data={data}
          reviewed={finalizing}
          onClose={() => setFinalizing(null)}
          onDone={() => setFinalizing(null)}
        />
      ) : null}
      {discarding ? (
        <DiscardDialog
          statementId={statement._id}
          onClose={() => setDiscarding(false)}
          onDone={() => router.push(`/owner-statements?month=${statement.month}`)}
        />
      ) : null}
    </div>
  );
}
