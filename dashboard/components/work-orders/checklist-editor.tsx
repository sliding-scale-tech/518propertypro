"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

export type ChecklistDraftItem = { key: string; label: string; required: boolean };

let counter = 0;
export function newDraftItem(label = "", required = true): ChecklistDraftItem {
  counter += 1;
  return { key: `d${counter}`, label, required };
}

const MAX_ITEMS = 40;

export function ChecklistEditor({
  items,
  onChange,
}: {
  items: ChecklistDraftItem[];
  onChange: (items: ChecklistDraftItem[]) => void;
}) {
  const update = (key: string, patch: Partial<ChecklistDraftItem>) =>
    onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const move = (index: number, dir: -1 | 1) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {items.length === 0 ? <p className="text-sm text-muted-foreground">No checklist items.</p> : null}
      {items.map((item, index) => (
        <div key={item.key} className="flex items-center gap-2">
          <input
            value={item.label}
            maxLength={200}
            onChange={(e) => update(item.key, { label: e.target.value })}
            aria-label={`Checklist item ${index + 1}`}
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
          />
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={item.required}
              onChange={(e) => update(item.key, { required: e.target.checked })}
            />
            Required
          </label>
          <button
            type="button"
            onClick={() => move(index, -1)}
            disabled={index === 0}
            aria-label="Move up"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => move(index, 1)}
            disabled={index === items.length - 1}
            aria-label="Move down"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChange(items.filter((i) => i.key !== item.key))}
            aria-label="Remove item"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={items.length >= MAX_ITEMS}
        onClick={() => onChange([...items, newDraftItem()])}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-input px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Add item
      </button>
    </div>
  );
}

/** Drops blank rows; the shape workOrders.create / editScope expect. */
export function toChecklistArgs(items: ChecklistDraftItem[]) {
  return items.filter((i) => i.label.trim()).map((i) => ({ label: i.label.trim(), required: i.required }));
}
