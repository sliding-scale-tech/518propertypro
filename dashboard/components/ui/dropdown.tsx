"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A custom-styled listbox to replace the browser's native `<select>` popup — that one can't
 * take Tailwind classes (its option list is drawn by the OS, not the page), which is why every
 * native `<select>` in this app renders its open menu unstyled regardless of the trigger's look.
 *
 * The open panel renders through a portal into document.body rather than as a normal
 * absolutely-positioned child: a caller inside a modal or panel with `overflow-y-auto` would
 * otherwise get its panel clipped by that ancestor's edge instead of floating above it.
 * Rendering at the document root and positioning it with the trigger button's own screen
 * coordinates (via getBoundingClientRect) avoids that clipping entirely. Closing on scroll,
 * rather than tracking the trigger's position live, keeps this simple — the alternative (a
 * scroll listener that repositions the panel every frame) is more machinery than a dropdown
 * needs.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  buttonClassName,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Flip to open upward when there isn't room below — an always-downward menu can run off
    // the bottom of the screen for a trigger near it.
    const estimatedHeight = Math.min(options.length * 36 + 8, 256);
    const openUpward = window.innerHeight - rect.bottom < estimatedHeight + 8 && rect.top > estimatedHeight;
    const left = Math.min(rect.left, window.innerWidth - rect.width - 8);
    setCoords(
      openUpward
        ? { left, width: rect.width, bottom: window.innerHeight - rect.top + 4 }
        : { left, width: rect.width, top: rect.bottom + 4 },
    );
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    // Any ancestor's scroll (the modal body, the page) invalidates `coords`, computed once at
    // open time — closing is simpler and just as usable as repositioning on every scroll frame.
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`flex h-11 w-full items-center gap-2 rounded-xl border border-input bg-card px-3 text-left text-sm font-medium outline-none focus:ring-2 focus:ring-ring/20 ${
          buttonClassName ?? ""
        }`}
      >
        {current?.icon}
        <span className="flex-1 truncate">{current?.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              <button
                key="backdrop"
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setOpen(false)}
              />
              <motion.div
                key="panel"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                style={{
                  position: "fixed",
                  top: coords.top,
                  bottom: coords.bottom,
                  left: coords.left,
                  width: coords.width,
                }}
                className="z-50 max-h-64 overflow-auto rounded-xl border border-border bg-card py-1 shadow-lg"
              >
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                      opt.value === value ? "bg-accent/60 font-medium text-foreground" : "text-foreground/90"
                    }`}
                  >
                    {opt.icon}
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}
              </motion.div>
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}
