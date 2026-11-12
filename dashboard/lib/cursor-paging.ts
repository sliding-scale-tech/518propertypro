// Page-by-page paging over a Convex `.paginate` query (no total known), for the shared <Pagination>
// in cursor mode. Pure, no imports, so the node tests load it directly
// (scripts/probes/list_views.test.mjs). The hook is lib/use-cursor-paging.ts.

/** The cursor each visited page started from (the last is the page shown) and the row count of each page left behind. */
export type CursorState = { cursors: (string | null)[]; counts: number[] };

export const FIRST_PAGE: CursorState = { cursors: [null], counts: [] };

/** What the page shown reported: its row count, whether more follow, and the cursor of the next page. */
export type PageInfo = { rowsOnPage: number; hasNext: boolean; continueCursor: string | null };

/** The page shown (1-based). */
export const pageOf = (s: CursorState): number => s.cursors.length;

/** The cursor to query the page shown with. */
export const cursorOf = (s: CursorState): string | null => s.cursors[s.cursors.length - 1] ?? null;

/** Rows on the pages before this one (pages can be short, so this is a sum, not page x size). */
export const rowsBeforeOf = (s: CursorState): number => s.counts.reduce((a, b) => a + b, 0);

/**
 * Move to page `target`: back to any earlier page, or forward by exactly one when there is a next
 * page. Anything else (a page that was never visited, a next page that does not exist) is ignored.
 */
export function goToPage(s: CursorState, target: number, info: PageInfo): CursorState {
  const current = s.cursors.length;
  if (!Number.isInteger(target) || target < 1) return s;
  if (target < current) return { cursors: s.cursors.slice(0, target), counts: s.counts.slice(0, target - 1) };
  if (target === current + 1 && info.hasNext && info.continueCursor !== null) {
    return { cursors: [...s.cursors, info.continueCursor], counts: [...s.counts, info.rowsOnPage] };
  }
  return s;
}
