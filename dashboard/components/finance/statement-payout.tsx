"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { PropertyAdjustmentView } from "@/convex/rosBuild";
import { formatBps, formatCurrency } from "@/convex/rosFormat";
import { Btn, Card, Pill, cx } from "@/components/ui";
import { AdjustmentsForm } from "./adjustments-card";
import type { StatementData } from "./finalize-dialogs";
import { DepositsDialog } from "./statement-check";
import type { StatementActions } from "./statement-lines";
import { ANCHOR } from "./warning-links";

/**
 * Step 4 "Fees & payout": per property, the management fee, the reserve and other adjustments (they
 * change the suggested draw and Available for payment), the owner draw, and the property's bottom
 * line. Every figure is the server's (the property's generated fee / draw and its summary column).
 */
export function PayoutStep({
  data,
  ctl,
  banner,
}: {
  data: StatementData;
  ctl: StatementActions;
  banner?: ReactNode;
}) {
  const [deposits, setDeposits] = useState<string | null>(null);
  const isDraft = data.statement.status === "draft";
  const depositsProp = deposits ? data.properties.find((p) => p.propertyId === deposits) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[640px] text-[13px] text-muted-foreground">
        Check each property&apos;s management fee, what to hold back, and the owner draw. The reserve and unpaid bills
        lower the suggested draw; deposits and early payments lower Available for payment.
      </p>
      {banner}
      {data.properties.map((p) => (
        <PropertyPayout
          key={p.propertyId}
          data={data}
          p={p}
          ctl={ctl}
          isDraft={isDraft}
          onEditDeposits={() => setDeposits(p.propertyId)}
        />
      ))}
      {depositsProp ? (
        <DepositsDialog
          ownerId={data.owner._id}
          propertyId={depositsProp.propertyId}
          propertyName={depositsProp.name}
          onClose={() => setDeposits(null)}
        />
      ) : null}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h4 className="text-[13.5px] font-semibold">{title}</h4>
      {hint ? <p className="mb-2 text-[12px] text-muted-foreground">{hint}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

/** One fee / draw line: description, amount, state pill, actions. */
function GeneratedRow({
  description,
  amount,
  pill,
  actions,
}: {
  description: ReactNode;
  amount: ReactNode;
  pill?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1 text-[13px] text-muted-foreground">{description}</div>
      <div className="flex flex-wrap items-center gap-2">
        {pill}
        <span className="min-w-[6rem] text-right text-[15px] font-semibold tabular-nums">{amount}</span>
        {actions}
      </div>
    </div>
  );
}

function PropertyPayout({
  data,
  p,
  ctl,
  isDraft,
  onEditDeposits,
}: {
  data: StatementData;
  p: PropertyAdjustmentView;
  ctl: StatementActions;
  isDraft: boolean;
  onEditDeposits: () => void;
}) {
  const sid = data.statement._id as string;
  const s = data.result.summary;
  const i = data.result.columns.findIndex((c) => c.propertyId === p.propertyId);
  const col = (c: { byProperty: number[] }) => (i >= 0 ? formatCurrency(c.byProperty[i]) : "-");
  const ownerHref = (anchor: string) => `/owner-statements/owners/${encodeURIComponent(data.owner._id)}#${anchor}`;
  const feeBusy = ctl.busyKey === `fee:${p.propertyId}`;
  const drawBusy = ctl.busyKey === `draw:${p.propertyId}`;
  const { fee, draw } = p;

  const feeDescription = (
    <>
      {fee.bps !== null ? (
        <>
          <span className="font-medium text-foreground">{formatBps(fee.bps)}%</span>
          {p.feeSource === "own" ? " (this property's fee)" : p.feeSource === "default" ? " (default fee)" : ""} of{" "}
          {formatCurrency(fee.baseCents)} fee-base income
          {fee.overridden && !fee.excluded ? <>; calculated {formatCurrency(fee.computedCents)}</> : null}
        </>
      ) : (
        "The management fee % isn't set."
      )}
      {isDraft ? (
        <>
          {" · "}
          <Link href={ownerHref(ANCHOR.property(p.propertyId))} className="font-medium text-primary hover:underline">
            Change %
          </Link>
        </>
      ) : null}
    </>
  );

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[16px] font-semibold">{p.name}</h3>
        <span className="ml-auto text-[12.5px] text-muted-foreground">
          Available for payment{" "}
          <span className="text-[15px] font-semibold tabular-nums text-foreground">{col(s.available)}</span>
        </span>
      </div>
      <div className="flex flex-col gap-4">
        <Section title="Management fee">
          <GeneratedRow
            description={feeDescription}
            amount={fee.excluded ? <span className="text-muted-foreground">Skipped</span> : formatCurrency(fee.amountCents)}
            pill={fee.excluded ? <Pill>Skipped this month</Pill> : fee.overridden ? <Pill tone="warn">Edited</Pill> : null}
            actions={
              isDraft && (fee.excluded || fee.bps !== null) ? (
                fee.excluded ? (
                  <Btn sm disabled={feeBusy} onClick={() => ctl.setGeneratedExcluded(p.propertyId, "fee", false)}>
                    Put back
                  </Btn>
                ) : (
                  <>
                    <Btn sm onClick={() => ctl.openGenerated(p.propertyId, "fee")} disabled={feeBusy}>
                      Edit
                    </Btn>
                    <Btn sm disabled={feeBusy} onClick={() => ctl.setGeneratedExcluded(p.propertyId, "fee", true)}>
                      Skip
                    </Btn>
                  </>
                )
              ) : null
            }
          />
        </Section>

        <Section title="Hold back" hint="These don't change the cash balance.">
          <div className="mb-3 flex flex-wrap items-baseline gap-2 text-[13px]">
            <span className="text-muted-foreground">Tenant security deposits held:</span>
            <span className="font-medium tabular-nums">{formatCurrency(p.securityDepositsCents)}</span>
            {isDraft ? (
              <button
                type="button"
                onClick={onEditDeposits}
                className="text-[12.5px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Edit deposits…
              </button>
            ) : null}
          </div>
          <AdjustmentsForm
            // Re-seed the inputs when the saved values change (after a save or another tab's edit).
            key={`${p.propertyId}:${p.earlyPaymentsCents}:${p.unpaidBillsCents}:${p.propertyReserveCents}`}
            statementId={sid}
            p={p}
            readOnly={!isDraft}
          />
        </Section>

        <Section title="Owner draw" hint={data.owner.payeeName ? `Paid to ${data.owner.payeeName}.` : undefined}>
          <GeneratedRow
            description={
              <>
                Suggested <span className="font-medium text-foreground tabular-nums">{formatCurrency(draw.suggestedCents)}</span>{" "}
                (cash after expenses, less the reserve and unpaid bills)
              </>
            }
            amount={draw.excluded ? <span className="text-muted-foreground">Skipped</span> : formatCurrency(draw.amountCents)}
            pill={draw.excluded ? <Pill>Skipped this month</Pill> : draw.overridden ? <Pill tone="warn">Edited</Pill> : null}
            actions={
              isDraft ? (
                draw.excluded ? (
                  <Btn sm disabled={drawBusy} onClick={() => ctl.setGeneratedExcluded(p.propertyId, "draw", false)}>
                    Put back
                  </Btn>
                ) : (
                  <>
                    <Btn sm onClick={() => ctl.openGenerated(p.propertyId, "draw")} disabled={drawBusy}>
                      Edit amount
                    </Btn>
                    <Btn sm disabled={drawBusy} onClick={() => ctl.setGeneratedExcluded(p.propertyId, "draw", true)}>
                      Skip
                    </Btn>
                  </>
                )
              ) : null
            }
          />
        </Section>

        <Section title="Bottom line">
          <dl className="grid max-w-[420px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
            <BottomRow label="Ending cash" value={col(s.ending)} strong />
            <BottomRow label="Less deposits and early payments" value={col(s.depositsAndEarlyPayments)} />
            <BottomRow label="Less property reserve" value={col(s.propertyReserve)} />
            <BottomRow label="Less unpaid bills" value={col(s.unpaidBills)} />
            <BottomRow label="Less pending ePay (not live yet)" value={col(s.pendingEpay)} />
            <BottomRow label="Available for payment" value={col(s.available)} strong top />
          </dl>
        </Section>
      </div>
    </Card>
  );
}

function BottomRow({ label, value, strong, top }: { label: string; value: string; strong?: boolean; top?: boolean }) {
  return (
    <>
      <dt className={cx(strong ? "font-semibold" : "text-muted-foreground", top && "border-t border-border pt-1")}>{label}</dt>
      <dd className={cx("text-right tabular-nums", strong && "font-semibold", top && "border-t border-border pt-1")}>{value}</dd>
    </>
  );
}
