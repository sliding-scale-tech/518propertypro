"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { cx } from "./cx";
import { PAGE_SIZES, cursorRange, pageCountOf, pageItems, rangeLabel } from "./pagination-model";
import { Listbox } from "./select";

export type PaginationProps = {
  /** The page shown (1-based). */
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  /**
   * Rows in the whole (filtered) list. Set: "Showing 51–100 of 483", page numbers, Previous/Next.
   * Omitted: a cursor-paged list (no total known): "Showing 51–100", "Page 2", Previous/Next only,
   * and `rowsOnPage` / `hasNext` are used.
   */
  total?: number;
  /** Cursor mode: rows on the page shown. */
  rowsOnPage?: number;
  /** Cursor mode: there is a next page. */
  hasNext?: boolean;
  /** Cursor mode: rows on the earlier pages (pages can be short); default (page - 1) × pageSize. */
  rowsBefore?: number;
  /** Set = a "Rows per page" select (25 / 50 / 100 by default). */
  onPageSize?: (size: number) => void;
  pageSizes?: readonly number[];
  /** Accessible name of the navigation landmark, e.g. "Rent payments pages". */
  label?: string;
  className?: string;
  /** Text of the page-size select (default "Rows per page"), e.g. "Buildings per page". */
  sizeLabel?: string;
  /** What is counted, added after the range: "Showing 1–10 of 57 buildings" (default: nothing). */
  noun?: string;
};

// Same look as the original Pager (components/asset-managers/shared.tsx): joined bordered buttons.
const BTN =
  "inline-flex h-9 min-w-9 items-center justify-center gap-1 border border-border bg-card px-2 text-[13px] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 focus-visible:relative focus-visible:z-[2] focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The one pagination bar of the app: "Showing 51–100 of 483", Previous / page numbers / Next and
 * an optional "Rows per page" select. Keyboard: every control is a native button (Tab, Enter /
 * Space); the current page has aria-current="page"; the range text is announced politely when it
 * changes. Renders nothing for an empty list.
 */
export function Pagination({
  page,
  pageSize,
  onPage,
  total,
  rowsOnPage = 0,
  hasNext = false,
  rowsBefore,
  onPageSize,
  pageSizes = PAGE_SIZES,
  label = "Pagination",
  className,
  sizeLabel = "Rows per page",
  noun,
}: PaginationProps) {
  const sizeId = useId();
  const cursorMode = total === undefined;
  if (!cursorMode && total === 0) return null;
  if (cursorMode && page <= 1 && rowsOnPage === 0) return null;

  const pageCount = cursorMode ? page + (hasNext ? 1 : 0) : pageCountOf(total, pageSize);
  const current = Math.min(Math.max(1, page), pageCount);
  const { from, to } = cursorMode
    ? cursorRange(current, pageSize, rowsOnPage, rowsBefore)
    : { from: (current - 1) * pageSize + 1, to: Math.min(total, current * pageSize) };
  const canPrev = current > 1;
  const canNext = cursorMode ? hasNext : current < pageCount;
  const go = (p: number) => {
    if (p !== current && p >= 1 && p <= pageCount) onPage(p);
  };

  return (
    <nav aria-label={label} className={cx("flex flex-wrap items-center justify-between gap-3 px-1 pt-4", className)}>
      <p className="text-[13px] text-muted-foreground" aria-live="polite">
        {rangeLabel(from, to, cursorMode ? null : total)}
        {noun ? ` ${noun}` : null}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSize ? (
          <div className="flex items-center gap-2">
            <span id={sizeId} className="text-[12.5px] text-muted-foreground">
              {sizeLabel}
            </span>
            <div className="w-[84px]">
              <Listbox
                aria-labelledby={sizeId}
                value={String(pageSize)}
                options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
                onValueChange={(v) => {
                  const n = Number(v);
                  if (Number.isFinite(n) && n !== pageSize) onPageSize(n);
                }}
              />
            </div>
          </div>
        ) : null}
        <div className="inline-flex">
          <button type="button" aria-label="Previous page" disabled={!canPrev} onClick={() => go(current - 1)} className={cx(BTN, "rounded-l-[10px]")}>
            <ChevronLeft aria-hidden className="h-4 w-4" />
            <span className="hidden sm:inline">Previous</span>
          </button>
          {cursorMode ? (
            <span aria-current="page" className={cx(BTN, "-ml-px cursor-default border-primary bg-accent font-semibold text-primary hover:bg-accent")}>
              Page {current}
            </span>
          ) : (
            pageItems(current, pageCount).map((p, i) =>
              p === "gap" ? (
                <span key={`gap-${i}`} aria-hidden className={cx(BTN, "-ml-px cursor-default text-muted-foreground hover:bg-card")}>
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  aria-label={`Page ${p}`}
                  aria-current={p === current ? "page" : undefined}
                  onClick={() => go(p)}
                  className={cx(BTN, "-ml-px", p === current && "z-[1] border-primary bg-accent font-semibold text-primary")}
                >
                  {p}
                </button>
              ),
            )
          )}
          <button type="button" aria-label="Next page" disabled={!canNext} onClick={() => go(current + 1)} className={cx(BTN, "-ml-px rounded-r-[10px]")}>
            <span className="hidden sm:inline">Next</span>
            <ChevronRight aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );
}
