// Pure helpers for the Tenants lists' URL filters (no imports, so node tests load it directly).

/** A `?param=` value that must be one of `allowed`, else `fallback`. */
export function readChoice<T extends string>(raw: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
}

/**
 * The query string after `updates` are applied to `current`: "" or null removes a key; the page
 * is always removed (a filter, search or sort change starts again at page 1). Returns "" when
 * nothing is left.
 */
export function nextQuery(current: string, updates: Record<string, string | null>, pageKey = "page"): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  next.delete(pageKey);
  return next.toString();
}

/** True when every filter in `current` equals its default (the search is passed in trimmed). */
export function filtersAtDefault(current: Record<string, string>, defaults: Record<string, string>): boolean {
  return Object.keys(defaults).every((k) => (current[k] ?? defaults[k]) === defaults[k]);
}
