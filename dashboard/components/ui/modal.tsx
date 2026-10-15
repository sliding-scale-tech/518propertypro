"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { IconBtn } from "./controls";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SIZE = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl" } as const;

/**
 * Centered dialog: 20px radius, scrim, sticky header (title + close), 22px padding.
 * Escape and scrim click close it, Tab is trapped, focus returns to the opener on close.
 * Render it conditionally, or pass `open`.
 */
export function Modal({
  open = true,
  title,
  eyebrow,
  onClose,
  size = "md",
  footer,
  bare = false,
  children,
}: {
  open?: boolean;
  title: ReactNode;
  eyebrow?: ReactNode;
  onClose: () => void;
  size?: keyof typeof SIZE;
  footer?: ReactNode;
  /** Skip body padding (caller supplies its own padded sections). */
  bare?: boolean;
  children?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return e.preventDefault();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[20px] border border-border bg-card text-card-foreground shadow-card outline-none sm:rounded-[20px]",
          SIZE[size],
        )}
      >
        <div className="sticky top-0 z-[2] flex items-start justify-between gap-3 border-b border-border bg-card px-[22px] py-4">
          <div className="min-w-0">
            {eyebrow ? <div className="mb-1 text-xs text-muted-foreground">{eyebrow}</div> : null}
            <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.01em]">
              {title}
            </h2>
          </div>
          <IconBtn label="Close" onClick={onClose}>
            <X />
          </IconBtn>
        </div>
        <div className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto", !bare && "p-[22px]")}>{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-border px-[22px] py-3.5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
