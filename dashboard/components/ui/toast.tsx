"use client";

/**
 * The one toast system. No provider state: a module-level store, so `toast.success(...)` works
 * anywhere (event handlers, hooks, promise chains). Mount <Toaster /> once in app/layout.tsx.
 *
 *   toast("Saved")                       // success
 *   toast.success / .error / .info / .warning(message, opts?)
 *   toast.promise(promise, { loading, success, error })
 *   toast.dismiss(id?)
 *   errorMessage(err, fallback?)         // ConvexError message, else the generic fallback
 *
 * `useToast()` returns the same `toast` object (kept so older call sites `toast(msg, "error")`
 * keep working). Passing a caught error to toast.error() runs it through errorMessage().
 */

import { ConvexError } from "convex/values";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, X } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";
type Kind = ToastVariant | "loading";
type ToastItem = { id: number; message: string; kind: Kind; duration: number };
type Options = { duration?: number; id?: number };

const DEFAULT_MS = 4000;
const ERROR_MS = 6000;
const MAX_VISIBLE = 4;

/**
 * The one place client code turns a caught error into text for a person. Only a ConvexError (the
 * server's deliberate, user-facing message) is shown. Anything else (a plain Error, a network
 * failure, a redacted "Server Error", a string) is unexpected, so it gets the generic `fallback`;
 * `error.message` of a non-ConvexError is never displayed.
 */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  let raw: string | undefined;
  // `instanceof` can miss across bundles, so also accept the ConvexError shape ({ data }).
  if (e instanceof ConvexError || (e && typeof e === "object" && "data" in e)) {
    const data = (e as { data?: unknown }).data;
    if (typeof data === "string") raw = data;
    else if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
      raw = (data as { message: string }).message;
    }
  }
  const text = raw?.trim();
  if (!text) return fallback;
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

// --- store -----------------------------------------------------------------------------------

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function dismiss(id?: number) {
  if (id === undefined) {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    items = [];
  } else {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    items = items.filter((i) => i.id !== id);
  }
  emit();
}

function schedule(id: number, ms: number) {
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  if (ms > 0 && typeof window !== "undefined") timers.set(id, setTimeout(() => dismiss(id), ms));
}

function push(kind: Kind, input: unknown, opts: Options = {}): number {
  // A string is text the caller wrote; anything else (a caught error) goes through errorMessage().
  const message = typeof input === "string" ? input : kind === "error" ? errorMessage(input) : String(input ?? "");
  const duration = kind === "loading" ? 0 : (opts.duration ?? (kind === "error" ? ERROR_MS : DEFAULT_MS));
  const id = opts.id ?? nextId++;
  const item: ToastItem = { id, message, kind, duration };
  items = items.some((i) => i.id === id) ? items.map((i) => (i.id === id ? item : i)) : [...items, item];
  // Keep the stack short: oldest non-loading toasts fall off first.
  while (items.length > MAX_VISIBLE) {
    const drop = items.find((i) => i.kind !== "loading") ?? items[0];
    dismiss(drop.id);
  }
  schedule(id, duration);
  emit();
  return id;
}

type ToastFn = {
  (message: string, variant?: ToastVariant, opts?: Options): number;
  success: (message: string, opts?: Options) => number;
  error: (messageOrError: unknown, opts?: Options) => number;
  info: (message: string, opts?: Options) => number;
  warning: (message: string, opts?: Options) => number;
  promise: <T>(
    p: Promise<T>,
    msgs: { loading: string; success: string | ((v: T) => string); error?: string | ((e: unknown) => string) },
  ) => Promise<T>;
  dismiss: (id?: number) => void;
};

export const toast: ToastFn = Object.assign(
  (message: string, variant: ToastVariant = "success", opts?: Options) => push(variant, message, opts),
  {
    success: (m: string, o?: Options) => push("success", m, o),
    error: (m: unknown, o?: Options) => push("error", m, o),
    info: (m: string, o?: Options) => push("info", m, o),
    warning: (m: string, o?: Options) => push("warning", m, o),
    dismiss,
    promise: async <T,>(
      p: Promise<T>,
      msgs: { loading: string; success: string | ((v: T) => string); error?: string | ((e: unknown) => string) },
    ): Promise<T> => {
      const id = push("loading", msgs.loading);
      try {
        const v = await p;
        push("success", typeof msgs.success === "function" ? msgs.success(v) : msgs.success, { id });
        return v;
      } catch (e) {
        const m = msgs.error;
        push("error", typeof m === "function" ? m(e) : (m ?? e), { id });
        throw e;
      }
    },
  },
);

export function useToast(): ToastFn {
  return toast;
}

// --- view ------------------------------------------------------------------------------------

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const EMPTY: ToastItem[] = [];

const ICON: Record<Kind, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-success-ink" aria-hidden />,
  error: <XCircle className="h-4 w-4 text-danger-ink" aria-hidden />,
  info: <Info className="h-4 w-4 text-accent-foreground" aria-hidden />,
  warning: <AlertTriangle className="h-4 w-4 text-warning-ink" aria-hidden />,
  loading: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />,
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  const reduce = useReducedMotion();
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end sm:px-0"
    >
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduce}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
            transition={reduce ? { duration: 0 } : { type: "spring", damping: 24, stiffness: 280 }}
            role={t.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-[380px] items-start gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3 text-[13.5px] text-card-foreground shadow-card"
          >
            <span className="mt-0.5 shrink-0">{ICON[t.kind]}</span>
            <p className="min-w-0 flex-1 break-words leading-[1.4]">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-mr-1 shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Back-compat wrapper: layout used `<ToastProvider>`; it now only adds the Toaster. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
