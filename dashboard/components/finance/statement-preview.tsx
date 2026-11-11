"use client";

import type { DetailViewLine, StatementView, ViewRow } from "@/convex/rosView";
import { Card, cx } from "@/components/ui";

/**
 * On-screen preview of the statement (spec 6.3 "Preview tab"): the server's StatementView rendered
 * as HTML tables in the PDF's order. No number is computed here; every string comes from `view`.
 */
export function StatementPreview({ view, draft }: { view: StatementView; draft: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold tracking-[-0.01em]">{view.header.title}</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[13px]">
              <dt className="text-muted-foreground">{view.header.periodLabel}</dt>
              <dd className="tabular-nums">{view.header.period}</dd>
              <dt className="text-muted-foreground">{view.header.dateLabel}</dt>
              <dd className="tabular-nums">
                {view.header.date}
                {draft ? <span className="ml-2 text-xs text-warning-ink">(draft: set when finalized)</span> : null}
              </dd>
            </dl>
          </div>
          <address className="text-right text-[12.5px] not-italic text-muted-foreground">
            {view.header.preparedBy.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </address>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-[15px] font-semibold">{view.summary.title}</h3>
        <ViewTable columns={view.summary.columns} rows={view.summary.rows} />
      </Card>

      <Card>
        <h3 className="mb-3 text-[15px] font-semibold">{view.incomeStatement.title}</h3>
        <ViewTable columns={view.incomeStatement.columns} rows={view.incomeStatement.rows} />
      </Card>

      <Card>
        <h3 className="mb-3 text-[15px] font-semibold">{view.detail.title}</h3>
        <DetailTable detail={view.detail} />
      </Card>
    </div>
  );
}

function ViewTable({ columns, rows }: { columns: string[]; rows: ViewRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border-strong">
            <th scope="col" className="py-2 pr-3 text-left font-medium text-muted-foreground">
              <span className="sr-only">Line</span>
            </th>
            {columns.map((c, i) => (
              <th key={`${c}-${i}`} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const strong = r.kind !== "row";
            return (
              <tr
                key={`${r.label}-${i}`}
                className={cx(
                  r.kind === "total" && "border-t border-border",
                  r.kind === "grand" && "border-t border-border border-b-[3px] border-double border-b-foreground",
                )}
              >
                <th
                  scope="row"
                  className={cx("py-1.5 pr-3 text-left", strong ? "font-semibold" : "pl-4 font-normal")}
                >
                  {r.label}
                </th>
                {r.values.map((v, j) => (
                  <td key={j} className={cx("whitespace-nowrap px-3 py-1.5 text-right tabular-nums", strong && "font-semibold")}>
                    {v}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailTable({ detail }: { detail: StatementView["detail"] }) {
  const n = detail.columns.length;
  const lineRow = (l: DetailViewLine, i: number) => (
    <tr key={i} className="border-t border-border/60 align-top">
      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{l.date}</td>
      <td className="py-1.5 pr-3">{l.property}</td>
      <td className="whitespace-nowrap py-1.5 pr-3">{l.unit}</td>
      <td className="py-1.5 pr-3">{l.account}</td>
      <td className="py-1.5 pr-3">{l.name}</td>
      <td className="py-1.5 pr-3">{l.memo}</td>
      <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{l.amount}</td>
      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{l.balance}</td>
    </tr>
  );
  const labelRow = (label: string, value: string, key: string, bold = true) => (
    <tr key={key} className="border-t border-border">
      <td colSpan={n - 1} className={cx("py-2 pr-3", bold && "font-semibold")}>
        {label}
      </td>
      <td className={cx("whitespace-nowrap py-2 text-right tabular-nums", bold && "font-semibold")}>{value}</td>
    </tr>
  );
  const totalRow = (label: string, amount: string, key: string) => (
    <tr key={key} className="border-t border-border">
      <td colSpan={n - 2} className="py-2 pr-3 font-semibold">
        {label}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums">{amount}</td>
      <td />
    </tr>
  );
  const section = (title: string, key: string) => (
    <tr key={key}>
      <td colSpan={n} className="pb-1 pt-3 font-semibold">
        {title}
      </td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border-strong">
            {detail.columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cx("whitespace-nowrap py-2 pr-3 font-semibold", i >= n - 2 ? "text-right" : "text-left")}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labelRow(detail.beginning.label, detail.beginning.balance, "beginning")}
          {section(detail.additionsTitle, "add-title")}
          {detail.additions.map(lineRow)}
          {totalRow(detail.additionsTotal.label, detail.additionsTotal.amount, "add-total")}
          {section(detail.subtractionsTitle, "sub-title")}
          {detail.subtractions.map((l, i) => lineRow(l, i + detail.additions.length))}
          {totalRow(detail.subtractionsTotal.label, detail.subtractionsTotal.amount, "sub-total")}
          {labelRow(detail.ending.label, detail.ending.balance, "ending")}
        </tbody>
      </table>
    </div>
  );
}
