"use client";

import type { ChangeEvent, ReactNode } from "react";
import { cx } from "./cx";
import { Select } from "./select";

/**
 * One compact row for a list's search and filters: the search grows on the left, the dropdowns sit
 * inline after it, and "Clear filters" shows at the end once anything is off its default. On narrow
 * screens the search takes a full row and the dropdowns wrap below it.
 */
export function FilterToolbar({
  search,
  children,
  active,
  onClear,
  className,
  leading,
  searchAfter = false,
}: {
  /** The search box (a <SearchBox>); leave out for a list with no search. */
  search?: ReactNode;
  /** Optional control shown before everything else, e.g. a segmented scope control (<Seg>). */
  leading?: ReactNode;
  /** Put the search after the filters (default: before them). */
  searchAfter?: boolean;
  /** <FilterSelect>s. */
  children: ReactNode;
  /** True when the search or any filter is not at its default. */
  active: boolean;
  onClear: () => void;
  className?: string;
}) {
  const searchBox = search ? <div className="min-w-0 basis-full sm:min-w-[240px] sm:flex-1 sm:basis-0">{search}</div> : null;
  return (
    <div role="search" className={cx("flex flex-wrap items-center gap-2", className)}>
      {leading}
      {searchAfter ? null : searchBox}
      {children}
      {searchAfter ? searchBox : null}
      {active ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg px-2 py-1.5 text-[13px] font-medium text-primary hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/**
 * A compact filter dropdown for a <FilterToolbar>. The closed control reads "Label: Value"; it gets
 * a primary border and soft fill when `active` (the filter is off its default). Children are
 * <option>s, like <Select>.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  active,
  children,
  className,
}: {
  /** Shown before the value, e.g. "Severity". Also the accessible name. */
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("min-w-[140px] flex-1 sm:w-44 sm:flex-none", className)}>
      <Select
        aria-label={`Filter by ${label.toLowerCase()}`}
        triggerPrefix={label}
        value={value}
        onChange={onChange}
        highlight={active}
        className={cx(active && "bg-accent/60")}
      >
        {children}
      </Select>
    </div>
  );
}

/**
 * An on/off filter chip for a <FilterToolbar>, same height as <FilterSelect>. Primary border and
 * soft fill when on.
 */
export function FilterToggle({
  label,
  pressed,
  onChange,
  className,
}: {
  label: string;
  pressed: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cx(
        "rounded-xl border px-[11px] py-2 text-[13.5px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
        pressed
          ? "border-primary bg-accent/60 text-primary"
          : "border-input bg-card text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      {label}
    </button>
  );
}
