"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export type ListboxOption = {
  value: string;
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Non-selectable heading row (from <optgroup>). */
  group?: boolean;
};

const TRIGGER =
  "flex w-full items-center gap-2 rounded-xl border border-input bg-card px-[11px] py-2 text-left text-[13.5px] text-foreground outline-none transition-colors focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

type CoreProps = {
  value: string;
  options: ListboxOption[];
  onValueChange: (value: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  highlight?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

/**
 * Accessible custom listbox (combobox trigger + role=listbox popover) that replaces the OS-drawn
 * native <select> list. Focus stays on the trigger; the highlighted row is exposed through
 * aria-activedescendant. The popover is portalled so overflow-clipping ancestors (modals,
 * drawers) cannot cut it off, and flips upward near the viewport bottom.
 */
export function Listbox({
  value,
  options,
  onValueChange,
  id,
  name,
  disabled,
  placeholder,
  className,
  highlight = false,
  ...aria
}: CoreProps) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const listId = `${baseId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [coords, setCoords] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeBuf = useRef({ s: "", t: 0 });

  const selected = options.find((o) => !o.group && o.value === value);
  const enabledIdx = useMemo(
    () => options.map((o, i) => (o.group || o.disabled ? -1 : i)).filter((i) => i >= 0),
    [options],
  );

  const openMenu = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect || disabled) return;
    const est = Math.min(options.length * 36 + 12, 280);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < est && above > below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
    setCoords(
      up
        ? { left, width: rect.width, bottom: window.innerHeight - rect.top + 4, maxH: Math.min(280, above) }
        : { left, width: rect.width, top: rect.bottom + 4, maxH: Math.min(280, below) },
    );
    const cur = options.findIndex((o) => !o.group && o.value === value);
    setActive(cur >= 0 && !options[cur].disabled ? cur : (enabledIdx[0] ?? -1));
    setOpen(true);
  }, [disabled, options, value, enabledIdx]);

  const close = useCallback(() => setOpen(false), []);

  const commit = useCallback(
    (i: number) => {
      const o = options[i];
      if (!o || o.group || o.disabled) return;
      onValueChange(o.value);
      setOpen(false);
      btnRef.current?.focus();
    },
    [options, onValueChange],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, baseId]);

  const move = (dir: 1 | -1 | "first" | "last") => {
    if (enabledIdx.length === 0) return;
    if (dir === "first") return setActive(enabledIdx[0]);
    if (dir === "last") return setActive(enabledIdx[enabledIdx.length - 1]);
    const pos = enabledIdx.indexOf(active);
    const next = pos < 0 ? 0 : Math.min(enabledIdx.length - 1, Math.max(0, pos + dir));
    setActive(enabledIdx[next]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;
    if (k === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (k === "Tab") {
      if (open) setOpen(false);
      return;
    }
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      if (!open) return openMenu();
      return move(k === "ArrowDown" ? 1 : -1);
    }
    if (k === "Home" || k === "End") {
      if (!open) return;
      e.preventDefault();
      return move(k === "Home" ? "first" : "last");
    }
    if (k === "Enter" || k === " ") {
      if (k === " " && typeBuf.current.s) {
        // space inside a type-ahead word
      } else {
        e.preventDefault();
        if (!open) return openMenu();
        return commit(active);
      }
    }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const tb = typeBuf.current;
      tb.s = now - tb.t > 600 ? k.toLowerCase() : tb.s + k.toLowerCase();
      tb.t = now;
      const startAt = tb.s.length === 1 ? enabledIdx.indexOf(active) + 1 : Math.max(0, enabledIdx.indexOf(active));
      const ordered = [...enabledIdx.slice(startAt), ...enabledIdx.slice(0, startAt)];
      const hit = ordered.find((i) => options[i].label.toLowerCase().startsWith(tb.s));
      if (hit !== undefined) {
        e.preventDefault();
        if (open) setActive(hit);
        else onValueChange(options[hit].value);
      }
    }
  };

  const muted = !selected || (selected.value === "" && (selected.disabled || !!placeholder));
  const display = selected ? selected.label : (placeholder ?? "");

  return (
    <>
      <button
        ref={btnRef}
        id={baseId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${baseId}-opt-${active}` : undefined}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        aria-describedby={aria["aria-describedby"]}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cx(TRIGGER, highlight && "border-primary text-primary", className)}
      >
        {selected?.icon}
        <span className={cx("min-w-0 flex-1 truncate", muted && !highlight && "text-faint")}>{display || " "}</span>
        <ChevronDown
          aria-hidden
          className={cx("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open && coords ? (
                <motion.div
                  key="menu"
                  ref={menuRef}
                  id={listId}
                  role="listbox"
                  aria-label={aria["aria-label"]}
                  initial={{ opacity: 0, y: coords.bottom !== undefined ? 4 : -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: "fixed",
                    top: coords.top,
                    bottom: coords.bottom,
                    left: coords.left,
                    width: coords.width,
                    maxHeight: coords.maxH,
                  }}
                  className="z-[90] overflow-y-auto rounded-2xl border border-border bg-card p-1.5 shadow-card"
                >
                  {options.map((o, i) =>
                    o.group ? (
                      <div
                        key={`g${i}`}
                        role="presentation"
                        className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium uppercase tracking-wide text-faint"
                      >
                        {o.label}
                      </div>
                    ) : (
                      <div
                        key={`${o.value}-${i}`}
                        id={`${baseId}-opt-${i}`}
                        role="option"
                        aria-selected={o.value === value}
                        aria-disabled={o.disabled || undefined}
                        onMouseEnter={() => !o.disabled && setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => commit(i)}
                        className={cx(
                          "flex cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13.5px]",
                          o.disabled && "cursor-not-allowed opacity-45",
                          o.value === value ? "bg-accent text-accent-foreground" : "text-foreground",
                          i === active && o.value !== value && "bg-muted",
                        )}
                      >
                        {o.icon}
                        <span className="min-w-0 flex-1">
                          <span className={cx("block truncate", o.value === "" && o.disabled && "text-faint")}>{o.label}</span>
                          {o.sublabel ? (
                            <span className="block truncate text-xs text-muted-foreground">{o.sublabel}</span>
                          ) : null}
                        </span>
                        {o.value === value ? <Check aria-hidden className="h-4 w-4 shrink-0" /> : null}
                      </div>
                    ),
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

function nodeText(n: ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join("");
  if (isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return "";
}

type OptProps = { value?: string | number; disabled?: boolean; label?: string; children?: ReactNode; "data-sublabel"?: string };

function parseOptions(children: ReactNode, out: ListboxOption[] = []): ListboxOption[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<OptProps>;
    if (el.type === Fragment) {
      parseOptions(el.props.children, out);
    } else if (el.type === "optgroup") {
      out.push({ value: "", label: el.props.label ?? "", group: true });
      parseOptions(el.props.children, out);
    } else if (el.type === "option") {
      const label = nodeText(el.props.children);
      out.push({
        value: el.props.value !== undefined ? String(el.props.value) : label,
        label,
        disabled: el.props.disabled,
        sublabel: el.props["data-sublabel"],
      });
    }
  });
  return out;
}

/**
 * Drop-in replacement for the native select: same `<option>` children and
 * `onChange(e) => e.target.value` API, but renders the design-system listbox.
 */
export function Select({
  value,
  defaultValue,
  onChange,
  children,
  className,
  highlight,
  disabled,
  id,
  name,
  placeholder,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
}: {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  className?: string;
  highlight?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
  required?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const options = parseOptions(children);
  const [inner, setInner] = useState(String(defaultValue ?? options.find((o) => !o.group)?.value ?? ""));
  const current = value !== undefined ? String(value) : inner;
  return (
    <Listbox
      value={current}
      options={options}
      id={id}
      name={name}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      highlight={highlight}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      onValueChange={(v) => {
        if (value === undefined) setInner(v);
        const target = { value: v, name: name ?? "", id: id ?? "" };
        onChange?.({ target, currentTarget: target } as unknown as ChangeEvent<HTMLSelectElement>);
      }}
    />
  );
}
