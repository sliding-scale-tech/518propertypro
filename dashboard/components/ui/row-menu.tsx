"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean; /** Hover hint (native tooltip). */ title?: string };

/**
 * "⋯" button with a fixed-position menu (portalled, so a table's scroll box can't clip it).
 * Keyboard: the first item takes focus on open, ArrowUp / ArrowDown move, Escape closes and returns
 * focus to the button, Tab closes. Used by the Payments page rows and the property's unit table.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
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
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") {
        e.preventDefault();
        // Don't let an enclosing dialog or drawer close too.
        e.stopPropagation();
      }
      setCoords(null);
      btnRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next]?.focus();
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) return setCoords(null);
          const r = btnRef.current?.getBoundingClientRect();
          if (!r) return;
          const menuH = items.length * 36 + 12;
          const top = r.bottom + menuH > window.innerHeight - 8 ? Math.max(8, r.top - menuH - 4) : r.bottom + 4;
          setCoords({ top, right: Math.max(8, window.innerWidth - r.right) });
        }}
        className={cx(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          open && "bg-muted text-foreground",
        )}
      >
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKey}
              style={{ position: "fixed", top: coords.top, right: coords.right }}
              className="z-[90] min-w-[170px] rounded-2xl border border-border bg-card p-1.5 shadow-card"
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  title={it.title}
                  onClick={() => {
                    setCoords(null);
                    it.onSelect();
                  }}
                  className={cx(
                    "flex w-full rounded-[10px] px-2.5 py-2 text-left text-[13.5px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                    it.danger ? "text-danger-ink hover:bg-danger-soft focus-visible:bg-danger-soft" : "text-foreground",
                  )}
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
