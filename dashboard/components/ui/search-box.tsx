"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "./controls";

/** The search is applied this long after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 250;

/** A search field with a magnifier and a Clear (×) button; Escape clears too. */
export function SearchBox({
  id,
  label,
  value,
  onChange,
  onClear,
  placeholder,
}: {
  id: string;
  /** Screen-reader label, e.g. "Search payments". */
  label: string;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="search"
          value={value}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && value !== "") {
              e.preventDefault();
              onClear();
            }
          }}
          className="pl-9 pr-9"
        />
        {value !== "" ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={onClear}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A search kept in the URL as `?q=` (or `key`), applied live as you type (debounced). A new search
 * goes back to page 1 (`?page=` removed). `q` is the applied search (from the URL); `input` /
 * `setInput` drive the box; `clear` empties both at once. Needs a <Suspense> boundary.
 */
export function useUrlSearch(key = "q", pageKey = "page") {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get(key) ?? "";
  const [input, setInput] = useState(q);
  // The latest URL state, read inside the timer (so the effect doesn't re-run on every render).
  const latest = useRef({ params, pathname, router });
  useEffect(() => {
    latest.current = { params, pathname, router };
  });

  const apply = (value: string) => {
    const { params: p, pathname: path, router: r } = latest.current;
    const next = new URLSearchParams(p.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete(pageKey);
    const qs = next.toString();
    r.replace(qs ? `${path}?${qs}` : path);
  };

  useEffect(() => {
    if (input.trim() === q.trim()) return;
    const t = window.setTimeout(() => apply(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // `apply` reads the latest URL from a ref; only the typed text and the applied search matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, q]);

  return {
    q,
    input,
    setInput,
    clear: () => {
      setInput("");
      apply("");
    },
  };
}
