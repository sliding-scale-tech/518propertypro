"use client";

import { useAction } from "convex/react";
import { errorMessage } from "@/components/ui/toast";
import { Check, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { PropertyAddress } from "@/convex/placesApi";

const inputClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20";

type Suggestion = { placeId: string; mainText: string; secondaryText: string };

const ADDRESS_FALLBACK = "Address search is unavailable right now. You can still type the address and save it.";

/**
 * Address search backed by Google Places. Typing suggests real places; picking one stores the
 * exact address and coordinates. Typing without picking still saves the text as written, but
 * unpinned — the hint under the box says so, rather than silently pretending it is exact.
 */
export function AddressField({
  value,
  onChange,
}: {
  value: PropertyAddress | null;
  onChange: (address: PropertyAddress | null) => void;
}) {
  const autocomplete = useAction(api.places.autocomplete);
  const details = useAction(api.places.details);

  // null = show the saved address; a string = what they are typing right now.
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // One Google billing session per search: every keystroke plus the pick that ends it.
  const sessionRef = useRef<string | null>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    if (query === null || query.trim().length < 3) return;
    const handle = setTimeout(() => {
      sessionRef.current ??= crypto.randomUUID();
      const request = ++latestRequest.current;
      autocomplete({ input: query, sessionToken: sessionRef.current })
        .then((results) => {
          // A slower, older request must not overwrite suggestions for what is typed now.
          if (request !== latestRequest.current) return;
          setSuggestions(results);
          setOpen(true);
          setError(null);
        })
        .catch((err) => {
          if (request !== latestRequest.current) return;
          setError(errorMessage(err, ADDRESS_FALLBACK));
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [query, autocomplete]);

  const pick = async (suggestion: Suggestion) => {
    setPicking(true);
    try {
      const address = await details({
        placeId: suggestion.placeId,
        sessionToken: sessionRef.current ?? crypto.randomUUID(),
      });
      onChange(address);
      setQuery(null);
      setSuggestions([]);
      setOpen(false);
      setError(null);
      sessionRef.current = null;
    } catch (err) {
      setError(errorMessage(err, ADDRESS_FALLBACK));
    } finally {
      setPicking(false);
    }
  };

  const text = query ?? value?.formatted ?? "";
  const pinned = Boolean(value?.placeId) && query === null;

  return (
    <div className="relative">
      <span className="mb-2 block text-xs text-muted-foreground">Address</span>
      <div className="relative">
        <MapPin className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (next.trim().length < 3) {
              setSuggestions([]);
              setOpen(false);
            }
            // Keep what they typed even if they never pick — saved unpinned.
            onChange(next.trim() ? { formatted: next.trim() } : null);
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Start typing the property's street address"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="address-suggestions"
          className={`${inputClass} pl-9`}
        />
      </div>

      {open && suggestions.length > 0 ? (
        <div
          id="address-suggestions"
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              role="option"
              aria-selected={false}
              disabled={picking}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void pick(s)}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent disabled:opacity-50"
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{s.mainText}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.secondaryText}</span>
              </span>
            </button>
          ))}
          {/* Google Maps Platform requires attribution wherever Places results are shown
              without a Google map. */}
          <p className="border-t border-border px-4 py-1.5 text-right text-[11px] text-muted-foreground">
            Powered by Google
          </p>
        </div>
      ) : null}

      <p className="mt-2 text-xs">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : pinned && value ? (
          <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Check className="h-3.5 w-3.5" />
              Exact location saved
            </span>
            {value.mapsUrl ? (
              <a href={value.mapsUrl} target="_blank" rel="noopener noreferrer" className="underline">
                View on Google Maps
              </a>
            ) : null}
          </span>
        ) : value ? (
          <span className="text-muted-foreground">
            Pick a suggestion to pin the exact location — tour invites use this address.
          </span>
        ) : (
          <span className="text-muted-foreground">
            Used as the location of every tour in your team&apos;s calendars, and told to renters when Sarah
            books.
          </span>
        )}
      </p>
    </div>
  );
}

