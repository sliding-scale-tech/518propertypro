"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { AnimatePresence, motion } from "framer-motion";
import {
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  ListChecks,
  MapPin,
  Minus,
  PawPrint,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/toast";
import type { PropertyAddress } from "@/convex/placesApi";

type Unit = { bedrooms: string; rentMin: number; rentMax: number; available: boolean };

const EMPTY_UNIT: Unit = { bedrooms: "", rentMin: 0, rentMax: 0, available: true };
// The only bedroom counts the voice agent and qualification rules understand — see
// convex/schema.ts and convex/agents.ts's check_availability/check_qualification tool
// descriptions. A free-text field let someone type a value Sarah's tools would never match.
const UNIT_TYPES = ["studio", "1br", "2br", "3br+"] as const;
const inputClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20";

function parseUnitsCsv(text: string): Unit[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const hasHeader = lines[0].toLowerCase().includes("bedroom");
  return (hasHeader ? lines.slice(1) : lines)
    .filter((line) => line.trim())
    .map((line) => {
      const [bedrooms, rentMin, rentMax, available] = line.split(",").map((column) => column.trim());
      return {
        bedrooms: bedrooms ?? "",
        rentMin: Number(rentMin) || 0,
        rentMax: Number(rentMax) || 0,
        available: available === undefined ? true : /^(true|yes|1)$/i.test(available),
      };
    })
    .filter((unit) => unit.bedrooms.length > 0);
}

function formatUnitType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "studio") return "Studio";
  const match = normalized.match(/^(\d+)\s*(?:br|bed|bedroom)?(\+)?/);
  if (match) {
    const [, count, plus] = match;
    // "3br+" means three OR MORE bedrooms — a real category the agent and qualification rules
    // treat as one bucket (see schema.ts), not literally three. Dropping the "+" here silently
    // relabeled it as an exact three-bedroom unit.
    return `${count}${plus ?? ""} Bedroom${count === "1" && !plus ? "" : "s"}`;
  }
  return value;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function PropertyPage() {
  const property = useQuery(api.properties.current);
  const save = useMutation(api.properties.save);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const [name, setName] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [petsAllowed, setPetsAllowed] = useState(false);
  const [moveInWindowDays, setMoveInWindowDays] = useState(60);
  const [address, setAddress] = useState<PropertyAddress | null>(null);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [hydrated, setHydrated] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  /* The Convex query arrives after the first render; hydrate this editable draft once. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!property || hydrated) return;
    setName(property.name);
    setUnits(property.units);
    setPetsAllowed(property.petsAllowed);
    setMoveInWindowDays(property.moveInWindowDays);
    setAddress(savedAddress(property));
    setHydrated(true);
  }, [property, hydrated]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const restoreProperty = () => {
    if (!property) return;
    setName(property.name);
    setUnits(property.units);
    setPetsAllowed(property.petsAllowed);
    setMoveInWindowDays(property.moveInWindowDays);
    setAddress(savedAddress(property));
  };

  const handleSave = async () => {
    setStatus("saving");
    try {
      await save({ name, units, petsAllowed, moveInWindowDays, address: address ?? undefined });
      toast("Property saved — knowledge base is re-syncing");
    } finally {
      setStatus("idle");
    }
  };

  const handleModalSave = (unit: Unit) => {
    setUnits((current) => {
      if (editingIndex === null) return current;
      if (editingIndex === -1) return [...current, unit];
      return current.map((existing, index) => (index === editingIndex ? unit : existing));
    });
    setEditingIndex(null);
  };

  const handleDelete = (index: number) => {
    setUnits((current) => current.filter((_, unitIndex) => unitIndex !== index));
    setEditingIndex(null);
  };

  const handleCsvUpload = async (file: File) => {
    setCsvError(null);
    try {
      const parsed = parseUnitsCsv(await file.text());
      if (parsed.length === 0) {
        setCsvError("No valid rows found. Expect columns: bedrooms,rentMin,rentMax,available");
        return;
      }
      setUnits(parsed);
      toast(`Loaded ${parsed.length} units from CSV`);
    } catch {
      setCsvError("Could not read that file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-7 pb-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Property</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
          These rules drive the agent&apos;s qualification check on every call — they are not
          decided by the AI, they are read straight from here.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="mb-6 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Property profile</h2>
        </div>

        <label className="block">
          <span className="mb-2 block text-xs text-muted-foreground">Property name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
        </label>

        <div className="mt-5">
          <AddressField value={address} onChange={setAddress} />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="flex min-h-16 items-center rounded-xl border border-border px-4">
            <PawPrint className="mr-3 h-5 w-5 text-blue-500" />
            <span className="text-sm font-medium">Pets allowed</span>
            <button
              type="button"
              role="switch"
              aria-checked={petsAllowed}
              onClick={() => setPetsAllowed((current) => !current)}
              className={`ml-auto flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                petsAllowed ? "bg-primary" : "bg-slate-300"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
                  petsAllowed ? "translate-x-5 text-primary" : "translate-x-0 text-transparent"
                }`}
              >
                <Check className="h-3 w-3" />
              </span>
            </button>
            <span className="ml-2 w-7 text-sm">{petsAllowed ? "Yes" : "No"}</span>
          </div>

          <div className="flex min-h-16 items-center rounded-xl border border-border px-4">
            <CalendarDays className="mr-3 h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Move-in window</span>
            <div className="ml-auto flex h-9 items-center overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                aria-label="Decrease move-in window"
                onClick={() => setMoveInWindowDays((days) => Math.max(0, days - 1))}
                className="flex h-full w-9 items-center justify-center text-muted-foreground hover:bg-accent"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                value={moveInWindowDays}
                onChange={(event) => setMoveInWindowDays(Math.max(0, Number(event.target.value)))}
                className="h-full w-12 border-x border-border bg-card text-center text-sm tabular-nums outline-none"
              />
              <button
                type="button"
                aria-label="Increase move-in window"
                onClick={() => setMoveInWindowDays((days) => days + 1)}
                className="flex h-full w-9 items-center justify-center text-muted-foreground hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="ml-2 text-sm text-muted-foreground">days</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold">Unit inventory</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleCsvUpload(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-medium hover:bg-accent"
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </button>
            <button
              onClick={() => setEditingIndex(-1)}
              className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Add unit
            </button>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          CSV columns: bedrooms, rentMin, rentMax, available — uploading replaces the table below.
        </p>
        {csvError ? <p className="mt-2 text-xs text-destructive">{csvError}</p> : null}

        <div className="mt-5 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/45 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="px-6 py-3 font-medium">Unit type</th>
                <th className="px-5 py-3 font-medium">Monthly rent (min)</th>
                <th className="px-5 py-3 font-medium">Monthly rent (max)</th>
                <th className="px-5 py-3 font-medium">Availability</th>
              </tr>
            </thead>
            <tbody>
              {units.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    No units yet — add one or import a CSV.
                  </td>
                </tr>
              ) : null}
              {units.map((unit, index) => (
                <motion.tr
                  key={`${unit.bedrooms}-${index}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setEditingIndex(index)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-blue-50/40"
                >
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-3 font-semibold">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <BedDouble className="h-4 w-4" />
                      </span>
                      {formatUnitType(unit.bedrooms)}
                    </span>
                  </td>
                  <td className="px-5 py-4 tabular-nums">{formatCurrency(unit.rentMin)}</td>
                  <td className="px-5 py-4 tabular-nums">{formatCurrency(unit.rentMax)}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        unit.available
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          unit.available ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                      />
                      {unit.available ? "Available" : "Unavailable"}
                    </span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex justify-end gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <button
          type="button"
          onClick={restoreProperty}
          className="rounded-lg border border-input bg-card px-5 py-2.5 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={status === "saving"}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : "Save property"}
        </button>
      </div>

      <AnimatePresence>
        {editingIndex !== null ? (
          <UnitModal
            unit={editingIndex === -1 ? EMPTY_UNIT : units[editingIndex]}
            isNew={editingIndex === -1}
            onSave={handleModalSave}
            onDelete={editingIndex >= 0 ? () => handleDelete(editingIndex) : undefined}
            onClose={() => setEditingIndex(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The coded default property (shown before a team has its own row) has no address field. */
function savedAddress(property: object): PropertyAddress | null {
  return "address" in property && property.address ? (property.address as PropertyAddress) : null;
}

type Suggestion = { placeId: string; mainText: string; secondaryText: string };

/** convex/placesApi.ts sends its user-facing messages as ConvexError data; anything else is unexpected. */
function addressError(err: unknown): string {
  return err instanceof ConvexError && typeof err.data === "string"
    ? err.data
    : "Address search is unavailable right now. You can still type the address and save it.";
}

/**
 * Address search backed by Google Places. Typing suggests real places; picking one stores the
 * exact address and coordinates. Typing without picking still saves the text as written, but
 * unpinned — the hint under the box says so, rather than silently pretending it is exact.
 */
function AddressField({
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
          setError(addressError(err));
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
      setError(addressError(err));
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

function UnitModal({
  unit,
  isNew,
  onSave,
  onDelete,
  onClose,
}: {
  unit: Unit;
  isNew: boolean;
  onSave: (unit: Unit) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [bedrooms, setBedrooms] = useState(unit.bedrooms);
  const [rentMin, setRentMin] = useState(unit.rentMin);
  const [rentMax, setRentMax] = useState(unit.rentMax);
  const [available, setAvailable] = useState(unit.available);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="text-lg font-bold">{isNew ? "Add unit" : "Edit unit"}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-5 px-6 py-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Unit type</span>
            <select
              value={bedrooms}
              onChange={(event) => setBedrooms(event.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Select unit type
              </option>
              {UNIT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {formatUnitType(type)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label>
              <span className="mb-2 block text-sm font-medium">Rent min</span>
              <input
                type="number"
                value={rentMin}
                onChange={(event) => setRentMin(Number(event.target.value))}
                className={inputClass}
              />
            </label>
            <label>
              <span className="mb-2 block text-sm font-medium">Rent max</span>
              <input
                type="number"
                value={rentMax}
                onChange={(event) => setRentMax(Number(event.target.value))}
                className={inputClass}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={available}
              onChange={(event) => setAvailable(event.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            Available
          </label>
        </div>
        <div className="flex items-center border-t border-border bg-muted/30 px-6 py-4">
          {onDelete ? (
            <button
              onClick={onDelete}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave({ bedrooms, rentMin, rentMax, available })}
              disabled={!bedrooms.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
