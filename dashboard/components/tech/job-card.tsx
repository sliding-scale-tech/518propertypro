"use client";

import { AlertTriangle, MapPin, PawPrint } from "lucide-react";
import { PriorityBadge, TechBadge, TechCard, TechLinkButton } from "./ui";
import { STATUS_LABEL, formatDate, mapsUrl } from "./lib";

export type TechJob = {
  _id: string;
  number: number;
  title: string;
  priority: "emergency" | "urgent" | "routine";
  status: string;
  accessNotes?: string;
  dueDate?: number;
  window?: string;
  unitNumber?: string;
  propertyName?: string;
  /** Formatted street address. workOrders.list does not return it yet; used when present. */
  address?: string;
  isOverdue: boolean;
  actionRequired?: { kind: "sent_back" | "info_requested" } | null;
};

export function JobCard({ job }: { job: TechJob }) {
  const place = job.propertyName ?? "Unknown property";
  const hasPets = /\b(pet|pets|dog|dogs|cat|cats)\b/i.test(job.accessNotes ?? "");
  // The maps link prefers the formatted address; the property name is only a fallback.
  const destination = job.address || place;
  const primary = job.status === "in_progress" || !!job.actionRequired;
  const meta = [job.address, job.window, `WO-${job.number}`].filter(Boolean) as string[];
  return (
    <TechCard as="li">
      <div className="flex flex-col gap-2">
        <p className="break-words text-base font-semibold">{job.title}</p>
        <div className="flex flex-wrap gap-2">
          <PriorityBadge level={job.priority} />
          <TechBadge tone="info">{STATUS_LABEL[job.status] ?? job.status}</TechBadge>
          {job.actionRequired ? (
            <TechBadge tone="warning">
              <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> Action required
            </TechBadge>
          ) : null}
          {job.dueDate !== undefined && (
            <TechBadge tone={job.isOverdue ? "danger" : "neutral"}>
              Due {formatDate(job.dueDate)}
              {job.isOverdue ? " (overdue)" : ""}
            </TechBadge>
          )}
        </div>
      </div>

      <div>
        <p className="break-words text-base font-semibold">
          {place}
          {job.unitNumber ? ` · Unit ${job.unitNumber}` : ""}
        </p>
        <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {meta.map((m) => (
            <p key={m} className="break-words">
              {m}
            </p>
          ))}
        </div>
      </div>

      {job.accessNotes && (
        <p
          className={`flex gap-2 rounded-[8px] p-3 text-xs ${hasPets ? "bg-warning-soft font-medium text-warning-ink" : "bg-muted text-muted-foreground"}`}
        >
          {hasPets && <PawPrint aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="line-clamp-2 break-words">{job.accessNotes}</span>
        </p>
      )}

      <a
        href={mapsUrl(destination)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
      >
        <MapPin aria-hidden className="h-4 w-4 shrink-0" />
        Directions
      </a>

      <TechLinkButton href={`/tech/jobs/${job._id}`} variant={primary ? "primary" : "secondary"}>
        {primary ? "Open job" : "View details"}
      </TechLinkButton>
    </TechCard>
  );
}
