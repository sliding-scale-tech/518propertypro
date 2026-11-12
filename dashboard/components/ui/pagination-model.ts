// Page maths for the shared <Pagination> (components/ui/pagination.tsx). Pure, no imports, so the
// node tests load it directly (scripts/probes/pagination.test.mjs).

/** The page sizes offered everywhere ("Rows per page"). */
export const PAGE_SIZES: readonly number[] = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 50;

/** A `?size=` value: one of `sizes`, else `fallback`. */
export function readPageSize(
  raw: string | number | null | undefined,
  sizes: readonly number[] = PAGE_SIZES,
  fallback: number = DEFAULT_PAGE_SIZE,
): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return sizes.includes(n) ? n : fallback;
}

/** A `?page=` value: a whole number from 1, else 1. (Too-high pages are clamped by `paginate`.) */
export function readPage(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

export type PageSlice<T> = {
  /** The rows on this page. */
  rows: T[];
  /** The page shown, clamped to 1..pageCount. */
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** 1-based position of the first and last row shown (0 and 0 when there are none). */
  from: number;
  to: number;
};

/** Number of pages for `total` rows (at least 1, so an empty list is "page 1 of 1"). */
export function pageCountOf(total: number, pageSize: number): number {
  const size = Math.max(1, Math.floor(pageSize));
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/** The rows of one page. A page past the end shows the last page; below 1 shows the first. */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = rows.length;
  const pageCount = pageCountOf(total, size);
  const p = Math.min(Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)), pageCount);
  const start = (p - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: p,
    pageCount,
    pageSize: size,
    total,
    from: slice.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

/**
 * Rows shown on a cursor-paged list (no known total): page `page` holding `rowsOnPage` rows, after
 * `rowsBefore` rows on the earlier pages (default: full pages of `pageSize`).
 */
export function cursorRange(page: number, pageSize: number, rowsOnPage: number, rowsBefore?: number): { from: number; to: number } {
  if (rowsOnPage <= 0) return { from: 0, to: 0 };
  const start = rowsBefore ?? (Math.max(1, page) - 1) * pageSize;
  return { from: start + 1, to: start + rowsOnPage };
}

/**
 * "Showing 51–100 of 483" (en dash); "Showing 1 of 1" for a single row; "Showing 0 of 0" when empty.
 * `total` null = a cursor-paged list: "Showing 51–100".
 */
export function rangeLabel(from: number, to: number, total: number | null): string {
  const range = from === 0 ? "0" : from === to ? `${from}` : `${from}–${to}`;
  return total === null ? `Showing ${range}` : `Showing ${range} of ${total}`;
}

/**
 * The page buttons: always the first and last page, the current page and `siblings` pages either
 * side, with "gap" where pages are skipped. A single skipped page is shown instead of a gap.
 * pageItems(6, 20) -> [1, "gap", 5, 6, 7, "gap", 20].
 */
export function pageItems(page: number, pageCount: number, siblings = 1): (number | "gap")[] {
  if (pageCount <= 1) return [1];
  const p = Math.min(Math.max(1, page), pageCount);
  const keep = new Set<number>([1, pageCount]);
  for (let i = p - siblings; i <= p + siblings; i++) if (i >= 1 && i <= pageCount) keep.add(i);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev === 2) out.push(n - 1);
    else if (n - prev > 2) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
}
