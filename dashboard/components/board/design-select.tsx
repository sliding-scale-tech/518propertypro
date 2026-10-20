"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui";

export type DesignOption = {
  value: string;
  label: string;
  /** Filled circle shown before the label. Priority uses this. */
  dot?: string;
};

type Variant = "toolbar" | "field" | "page";

const TRIGGER: Record<Variant, string> = {
  toolbar:
    "h-[38px] w-[170px] gap-2 rounded-[8px] border-[#cbd5e1] px-3 text-[14px] font-normal leading-5 text-[#1e293b]",
  field:
    "h-[34px] w-full gap-2 rounded-[8px] border-[#e2e8f0] px-[11px] text-[12px] font-medium leading-4 text-[#1e293b] disabled:bg-[#f7f7f7]",
  page: "h-[26px] w-auto gap-1 rounded-[8px] border-[#e2e8f0] pl-[13px] pr-2 text-[12px] font-normal leading-4 text-[#334155]",
};

const CHEVRON: Record<Variant, string> = {
  toolbar: "h-4 w-4",
  field: "h-3.5 w-3.5",
  page: "h-3.5 w-3.5",
};

/** Closed control and open list from the work-order frames (rounded 8px, slate border, 14/12px type). */
export function DesignSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  variant = "field",
  placeholder = "Select",
  className,
}: {
  value: string;
  options: DesignOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  variant?: Variant;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);

  const selected = options.find((o) => o.value === value);

  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, variant === "page" ? 112 : rect.width);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom - 8;
    const want = Math.min(options.length * 36 + 8, 280);
    const up = below < want && rect.top > below;
    const maxH = Math.min(280, up ? rect.top - 8 : below);
    const top = up ? Math.max(8, rect.top - maxH - 4) : rect.bottom + 4;
    setBox({ left, top, width, maxH });
  };

  const openMenu = () => {
    if (disabled || !onChange) return;
    place();
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    setActive(i);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const commit = (i: number) => {
    const o = options[i];
    if (!o || !onChange) return;
    onChange(o.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !onChange) return;
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openMenu();
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return (next + options.length) % options.length;
      });
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openMenu();
      else commit(active);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled || !onChange}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cx(
          "inline-flex items-center border bg-white text-left outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/30 disabled:cursor-default",
          TRIGGER[variant],
          className,
        )}
      >
        {selected?.dot ? (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: selected.dot }} />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden className={cx("shrink-0 text-[#64748b]", CHEVRON[variant])} />
      </button>
      {open && box && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={id}
              role="listbox"
              aria-label={ariaLabel}
              style={{ position: "fixed", left: box.left, top: box.top, width: box.width, maxHeight: box.maxH, zIndex: 80 }}
              className="overflow-y-auto rounded-[8px] border border-[#e2e8f0] bg-white py-1 shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
            >
              {options.map((o, i) => {
                const on = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => commit(i)}
                    className={cx(
                      "flex w-full items-center gap-2 px-3 py-2 text-left",
                      variant === "toolbar" ? "text-[14px] leading-5" : "text-[12px] leading-4",
                      on ? "bg-[#f2f8ff] font-medium text-[#2563eb]" : "text-[#1e293b]",
                      i === active && !on && "bg-[#f8fafc]",
                    )}
                  >
                    {o.dot ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.dot }} /> : null}
                    <span className="truncate">{o.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
