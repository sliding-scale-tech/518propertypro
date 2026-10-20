import { Check, Image as ImageIcon, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";

/** One row in a card list: leading icon tile, title + subtitle, trailing content. */
export function ListRow({
  icon,
  title,
  sub,
  right,
  onClick,
  first = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  first?: boolean;
}) {
  const body = (
    <>
      {icon}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate font-medium group-hover:text-primary">{title}</div>
        {sub ? <div className="truncate text-[12.5px] text-muted-foreground">{sub}</div> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </>
  );
  const cls = cx("group flex w-full items-center gap-3 py-[11px]", first ? "pt-0.5" : "border-t border-border");
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, "focus-visible:outline-2 focus-visible:outline-ring")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Horizontal strip of big-number steps separated by dashed rules. */
export function FlowStrip({ steps }: { steps: Array<{ value: ReactNode; label: ReactNode }> }) {
  return (
    <div className="flex flex-wrap">
      {steps.map((s, i) => (
        <div
          key={i}
          className={cx(
            "min-w-[120px] flex-1 px-2.5",
            i === 0 ? "pl-0" : "border-l border-dashed border-border-strong",
          )}
        >
          <div className="text-[22px] font-semibold tabular-nums">{s.value}</div>
          <div className="text-xs text-muted-foreground">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export type Column<Row> = {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  align?: "left" | "right";
  className?: string;
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = "Nothing here yet.",
  caption,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  empty?: ReactNode;
  /** Screen-reader table name. */
  caption?: string;
}) {
  const onKey = (e: KeyboardEvent, row: Row) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row);
    }
  };
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  "bg-muted px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground",
                  c.align === "right" ? "text-right" : "text-left",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="border-t border-border px-3.5 py-6 text-center text-[12.5px] text-faint">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cx(onRowClick && "cursor-pointer hover:bg-muted focus-visible:bg-muted focus-visible:outline-none")}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      "border-t border-border px-3.5 py-[11px] align-middle",
                      c.align === "right" && "text-right",
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Vertical activity timeline; the last entry is highlighted as current. */
export function Timeline({ entries }: { entries: Array<{ id?: string; text: ReactNode; time?: ReactNode }> }) {
  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        return (
          <li key={e.id ?? i} className="relative flex gap-3 pb-3">
            {!last ? <span aria-hidden className="absolute bottom-0 left-1 top-3.5 w-px bg-border" /> : null}
            <span
              aria-hidden
              className={cx(
                "relative mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full",
                last ? "bg-primary ring-[3px] ring-accent" : "bg-border-strong",
              )}
            />
            <div>
              <div className="text-[13px]">{e.text}</div>
              {e.time ? <div className="text-[11.5px] text-muted-foreground">{e.time}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Read-only checklist (done items struck through). */
export function Checklist({ items }: { items: Array<{ label: ReactNode; done: boolean }> }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-[9px] text-[13.5px]">
          <span
            aria-hidden
            className={cx(
              "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-[1.5px]",
              it.done ? "border-success-ink bg-success-ink text-white" : "border-border-strong",
            )}
          >
            {it.done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
          </span>
          <span className={it.done ? "text-muted-foreground line-through" : undefined}>
            <span className="sr-only">{it.done ? "Done: " : "Open: "}</span>
            {it.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Grid of photo tiles (real image when `url` is set, striped placeholder otherwise). */
export function PhotoGrid({
  photos,
}: {
  /** onRemove: set only when the viewer may delete the photo; shows a hover/focus "x" (always visible on touch). */
  photos: Array<{ url?: string | null; caption?: string; alt?: string; onRemove?: () => void }>;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
      {photos.map((p, i) => (
        <div
          key={i}
          className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-border bg-[repeating-linear-gradient(135deg,var(--muted)_0_10px,var(--background)_10px_20px)]"
        >
          {p.url ? (
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.alt ?? p.caption ?? "Photo"} className="h-full w-full object-cover" />
            </a>
          ) : (
            <ImageIcon aria-hidden className="h-5 w-5 text-faint" />
          )}
          {p.caption ? (
            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-card px-1.5 text-[10.5px] font-semibold leading-4">
              {p.caption}
            </span>
          ) : null}
          {p.onRemove ? (
            <button
              type="button"
              aria-label="Remove photo"
              title="Remove photo"
              onClick={p.onRemove}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white hover:bg-rose-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
