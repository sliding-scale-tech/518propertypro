"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pill, cx } from "@/components/ui";

export type AmStatus = "active" | "on_leave" | "inactive";

export function StatusBadge({ status }: { status: AmStatus }) {
  if (status === "on_leave") return <Pill tone="warn">On Leave</Pill>;
  if (status === "inactive") return <Pill tone="neutral">Inactive</Pill>;
  return <Pill tone="ok">Active</Pill>;
}

/** Round avatar with initials (or the profile picture when there is one). */
export function PersonAvatar({
  initials,
  imageUrl,
  size = 36,
  name,
}: {
  initials: string;
  imageUrl?: string | null;
  size?: number;
  name: string;
}) {
  const safe = imageUrl && /^https:\/\//.test(imageUrl) ? imageUrl : null;
  return safe ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={safe} alt={name} width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      role="img"
      aria-label={name}
      style={{ width: size, height: size, fontSize: Math.round(size / 3) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
    >
      {initials}
    </span>
  );
}

/** Underline tabs (page-level and in-modal). */
export function UnderlineTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-6 border-b border-border">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "-mb-px border-b-2 px-0.5 pb-2.5 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              on ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** "Showing 1 to 10 of 42 records" + page buttons. */
export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  noun = "records",
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  noun?: string;
  onPage: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, i) => start + i);
  const btn =
    "inline-flex h-9 min-w-9 items-center justify-center border border-border bg-card px-2 text-[13px] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-4">
      <p className="text-[13px] text-muted-foreground">
        Showing {from} to {to} of {total} {noun}
      </p>
      <div className="inline-flex">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className={cx(btn, "rounded-l-[10px]")}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPage(p)}
            className={cx(btn, "-ml-px", p === page && "z-[1] border-primary bg-accent font-semibold text-primary")}
          >
            {p}
          </button>
        ))}
        <button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)} className={cx(btn, "-ml-px rounded-r-[10px]")}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export type MenuItem = { label: string; onSelect: () => void };

/** "..." button with a fixed-position popover menu (escapes overflow-clipped tables). */
export function ActionMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = coords !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setCoords(null);
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menuRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) return setCoords(null);
          const r = btnRef.current?.getBoundingClientRect();
          if (!r) return;
          const menuH = items.length * 36 + 12;
          const top = r.bottom + menuH > window.innerHeight - 8 ? Math.max(8, r.top - menuH - 4) : r.bottom + 4;
          setCoords({ top, right: Math.max(8, window.innerWidth - r.right) });
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              style={{ position: "fixed", top: coords.top, right: coords.right }}
              className="z-[90] min-w-[170px] rounded-2xl border border-border bg-card p-1.5 shadow-card"
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCoords(null);
                    it.onSelect();
                  }}
                  className="flex w-full rounded-[10px] px-2.5 py-2 text-left text-[13.5px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  {it.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Small uppercase-free labelled value (label above, value below). */
export function LabelValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-[14px] font-medium">{children}</div>
    </div>
  );
}

export function fmtStamp(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
