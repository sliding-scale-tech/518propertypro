"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortState } from "./table-sort";

/**
 * A clickable column header: the label and an arrow (up = ascending, down = descending, faint
 * both-ways = not sorted by this column). A native button, so Tab / Enter / Space work; pass the
 * same `sort` to the Column's `sort` (aria-sort on the header cell).
 */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: "left" | "right";
}) {
  const on = sort.key === sortKey;
  const Icon = !on ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={
        "inline-flex items-center gap-1 rounded uppercase tracking-[0.06em] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" +
        (align === "right" ? " flex-row-reverse" : "") +
        (on ? " text-foreground" : "")
      }
    >
      {label}
      <Icon aria-hidden className={on ? "h-3.5 w-3.5" : "h-3.5 w-3.5 opacity-40"} />
      <span className="sr-only">{on ? (sort.dir === "asc" ? ", sorted ascending" : ", sorted descending") : ", sort"}</span>
    </button>
  );
}
