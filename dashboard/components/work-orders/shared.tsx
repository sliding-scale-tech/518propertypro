"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

export type WoPriority = "emergency" | "urgent" | "routine";
export type WoStatus = "created" | "assigned" | "in_progress" | "completed" | "reviewed_closed" | "cancelled";

const PRIORITY_STYLES: Record<WoPriority, string> = {
  emergency: "bg-danger-soft text-danger-ink",
  urgent: "bg-warning-soft text-warning-ink",
  routine: "bg-accent text-accent-foreground",
};

export function PriorityBadge({ priority }: { priority: WoPriority }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-[9px] text-xs font-medium leading-5 ${PRIORITY_STYLES[priority]}`}>
      {priority[0].toUpperCase() + priority.slice(1)}
    </span>
  );
}

export const STATUS_META: Record<WoStatus, { label: string; className: string }> = {
  created: { label: "Created", className: "bg-muted text-muted-foreground" },
  assigned: { label: "Assigned", className: "bg-accent text-accent-foreground" },
  in_progress: { label: "In progress", className: "bg-warning-soft text-warning-ink" },
  completed: { label: "Completed", className: "bg-success-soft text-success-ink" },
  reviewed_closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "bg-danger-soft text-danger-ink" },
};

export function StatusPill({ status }: { status: WoStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-[9px] text-xs font-medium leading-5 ${meta.className}`}>
      {meta.label}
    </span>
  );
}

/** Integer cents to dollars. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function MoneyCell({ cents, className }: { cents: number; className?: string }) {
  return <span className={`tabular-nums ${className ?? ""}`}>{formatCents(cents)}</span>;
}

export type GalleryFile = { _id: string; url: string | null; createdAt: number };

function Thumb({ file, label }: { file: GalleryFile; label: string }) {
  const [broken, setBroken] = useState(false);
  if (!file.url) return null;
  if (broken) {
    // Not an image (a PDF receipt): fall back to a link.
    return (
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-muted text-xs text-primary hover:underline"
      >
        <FileText className="h-5 w-5" />
        Open PDF
      </a>
    );
  }
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={file.url}
        alt={label}
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-28 w-28 rounded-xl border border-border object-cover"
      />
    </a>
  );
}

export function FileGallery({ files, emptyLabel, label }: { files: GalleryFile[]; emptyLabel: string; label: string }) {
  if (files.length === 0) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="flex flex-wrap gap-3">
      {files.map((f, i) => (
        <Thumb key={f._id} file={f} label={`${label} ${i + 1}`} />
      ))}
    </div>
  );
}
