"use client";

import Link from "next/link";
import { CheckSquare, MapPin, PawPrint } from "lucide-react";
import { PRIORITY_BAR, STATUS_LABEL, formatDate, mapsUrl } from "./lib";

export type TechJob = {
  _id: string;
  title: string;
  priority: string;
  status: string;
  accessNotes?: string;
  dueDate?: number;
  unitNumber?: string;
  propertyName?: string;
  checklistDone: number;
  checklistTotal: number;
  isOverdue: boolean;
};

export function JobCard({ job }: { job: TechJob }) {
  const place = job.propertyName ?? "Unknown property";
  const hasPets = /\b(pet|pets|dog|dogs|cat|cats)\b/i.test(job.accessNotes ?? "");
  return (
    <li className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${PRIORITY_BAR[job.priority] ?? "bg-muted"}`} aria-hidden />
      <div className="pl-5 pr-4 pt-3">
        <a
          href={mapsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
        >
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">
            {place}
            {job.unitNumber ? ` · Unit ${job.unitNumber}` : ""}
          </span>
        </a>
      </div>
      <Link href={`/tech/jobs/${job._id}`} className="block min-h-11 py-2 pb-4 pl-5 pr-4">
        <p className="text-base font-semibold leading-snug">{job.title}</p>
        {job.accessNotes && (
          <p
            className={`mt-2 line-clamp-2 flex gap-1.5 rounded-lg px-2 py-1 text-sm ${
              hasPets ? "bg-warning/15 font-medium" : "text-muted-foreground"
            }`}
          >
            {hasPets && <PawPrint className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{job.accessNotes}</span>
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
          {job.dueDate !== undefined && (
            <span className={job.isOverdue ? "font-semibold text-destructive" : ""}>
              Due {formatDate(job.dueDate)}
              {job.isOverdue ? " (overdue)" : ""}
            </span>
          )}
          {job.checklistTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckSquare className="h-3.5 w-3.5" />
              {job.checklistDone}/{job.checklistTotal}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
