"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-hand slide-over. Modal: scrim click and Escape close it, Tab is trapped inside, focus
 * moves in on open and returns to the opener on close. `title` labels the dialog.
 */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  headerTop,
  width = 560,
  hideHeader = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Small line above the title (id, severity chip, stage pill ...). */
  eyebrow?: ReactNode;
  headerTop?: ReactNode;
  width?: number;
  /** Caller draws the header. The title is still the dialog name for assistive tech. */
  hideHeader?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
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
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="scrim"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-scrim"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            style={{ width: `min(${width}px, 100%)` }}
            className="fixed inset-y-0 right-0 z-[51] flex flex-col overflow-y-auto bg-card text-card-foreground shadow-[-12px_0_40px_rgba(15,23,42,0.18)] outline-none"
          >
            <div className={hideHeader ? "sr-only" : "sticky top-0 z-[2] flex items-start gap-3 border-b border-border bg-card px-[22px] py-4"}>
              <div className="min-w-0 flex-1">
                {eyebrow || headerTop ? (
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                    {eyebrow}
                    {headerTop}
                  </div>
                ) : null}
                <h2 id={titleId} className="text-balance text-[19px] font-semibold tracking-[-0.01em]">
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={hideHeader ? "flex min-h-full flex-col" : "flex flex-col gap-[18px] px-[22px] pb-10 pt-[18px]"}>{children}</div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Drawer body section with the small uppercase heading. */
export function DrawerSection({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section>
      {title ? (
        <h4 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{title}</h4>
      ) : null}
      {children}
    </section>
  );
}

/** Definition list: 120px label column, value column. */
export function KeyValue({ items }: { items: Array<{ label: ReactNode; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Accent-tinted action panel at the top of a drawer. */
export function ActBox({
  lead,
  icon,
  children,
  note,
  bare = false,
}: {
  lead: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  bare?: boolean;
}) {
  if (bare) return <div className="flex flex-col gap-2">{children}</div>;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent-line bg-accent p-3.5">
      <div className="flex items-center gap-1.5 text-[13.5px] font-semibold [&_svg]:h-4 [&_svg]:w-4">
        {icon}
        {lead}
      </div>
      {children}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** Row of action buttons inside an ActBox. */
export function ActButtons({ children, stack = false }: { children: ReactNode; stack?: boolean }) {
  return <div className={stack ? "flex flex-col gap-2" : "flex flex-wrap gap-2"}>{children}</div>;
}

/** Dashed "nothing for you to do, here is why" note. */
export function WaitNote({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "flex items-center gap-2 rounded-[14px] border border-dashed border-border-strong px-3.5 py-3 text-[13px] text-muted-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
        className,
      )}
    >
      {icon}
      <div>{children}</div>
    </div>
  );
}
