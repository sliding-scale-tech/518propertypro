// The Knowledge page's search and sort (pure, no React, so the node tests load it directly:
// scripts/probes/list_views.test.mjs).
import { sortRows, type SortState } from "../ui/table-sort";

export const DOC_SORT_KEYS = ["updated", "title"] as const;
export type DocSortKey = (typeof DOC_SORT_KEYS)[number];
export const DOC_SORT_DEFAULT: SortState<DocSortKey> = { key: "updated", dir: "desc" };

export type ViewDoc = { title: string; body: string; updatedAt: number };

/** Every word typed must appear in the title or the text (case-insensitive). */
export function matchesDocSearch(d: ViewDoc, q: string): boolean {
  const terms = q.trim().replace(/\s+/g, " ").toLowerCase().split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${d.title} ${d.body}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** Searched, then sorted (a missing updatedAt counts as the oldest). Ties keep title order. */
export function docsView<D extends ViewDoc>(docs: readonly D[], opts: { q: string; sort: SortState<DocSortKey> }): D[] {
  const kept = docs.filter((d) => matchesDocSearch(d, opts.q));
  const byTitle = sortRows(kept, (d) => d.title, "asc");
  return opts.sort.key === "title"
    ? sortRows(kept, (d) => d.title, opts.sort.dir)
    : sortRows(byTitle, (d) => d.updatedAt || 0, opts.sort.dir);
}
