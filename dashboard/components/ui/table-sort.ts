// Sortable table headers (pure, no imports, so node tests load it): the sort read from the URL,
// what a header click does, and a stable comparator.

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** `?sort=` / `?dir=`: a known key (else `fallback`) and "asc" / "desc" (else the key's default). */
export function readSort<K extends string>(
  rawKey: string | null | undefined,
  rawDir: string | null | undefined,
  keys: readonly K[],
  fallback: SortState<K>,
): SortState<K> {
  const key = (keys as readonly string[]).includes(rawKey ?? "") ? (rawKey as K) : fallback.key;
  const dir: SortDir = rawDir === "asc" || rawDir === "desc" ? rawDir : key === fallback.key ? fallback.dir : "asc";
  return { key, dir };
}

/** A header click: the same column flips direction; another column starts ascending. */
export function toggleSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
}

/** aria-sort for a column header. */
export function ariaSortOf<K extends string>(current: SortState<K>, key: K): "ascending" | "descending" | "none" {
  return current.key !== key ? "none" : current.dir === "asc" ? "ascending" : "descending";
}

/**
 * Sorts a copy by `value` (numbers, or strings compared naturally, case-insensitive), in `dir`.
 * null / undefined values always go last whatever the direction; ties keep their order (stable).
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => string | number | null | undefined, dir: SortDir): T[] {
  const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      const an = a.v === null || a.v === undefined;
      const bn = b.v === null || b.v === undefined;
      if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return (dir === "asc" ? c : -c) || a.i - b.i;
    })
    .map((x) => x.row);
}
