"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  ChevronRight,
  PhoneCall,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";

type LeadStatus = "tour_booked" | "escalated" | "disqualified" | "qualified" | "contacted" | "new";

const STATUS_STYLES: Record<LeadStatus, { label: string; className: string }> = {
  tour_booked: { label: "Tour Booked", className: "border-blue-100 bg-blue-50 text-blue-600" },
  qualified: { label: "Qualified", className: "border-amber-100 bg-amber-50 text-amber-700" },
  contacted: { label: "Contacted", className: "border-purple-100 bg-purple-50 text-purple-600" },
  new: { label: "New", className: "border-emerald-100 bg-emerald-50 text-emerald-600" },
  disqualified: { label: "Disqualified", className: "border-slate-200 bg-slate-50 text-slate-500" },
  escalated: { label: "Escalated", className: "border-red-100 bg-red-50 text-red-600" },
};

const PRIORITY_STYLES: Record<string, { label: string; className: string }> = {
  high: { label: "High", className: "border-red-100 bg-red-50 text-red-500" },
  medium: { label: "Medium", className: "border-amber-100 bg-amber-50 text-amber-600" },
  low: { label: "Low", className: "border-sky-100 bg-sky-50 text-sky-600" },
};

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function greeting(at: Date): string {
  const hour = at.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Today" / "Yesterday" / "Sep 12" — the same shorthand the lead log and task rows use. */
function relativeDay(at: number): string {
  const then = new Date(at);
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(then, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(then, yesterday)) return "Yesterday";
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (sameDay(then, tomorrow)) return "Tomorrow";
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(at);
}

/** "2br" → "2 Bedroom", "studio" → "Studio" — bedrooms are stored as the agent captured them. */
function formatBedrooms(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "studio") return "Studio";
  const match = normalized.match(/^(\d+)/);
  return match ? `${match[1]} Bedroom` : value;
}

export default function DashboardPage() {
  const { user } = useUser();
  const data = useQuery(api.dashboard.overview, { fallbackTimeZone: browserTimeZone() });
  const tasks = useQuery(api.tasks.list);
  const toggleTask = useMutation(api.tasks.toggleComplete);

  const now = new Date();
  const firstName = user?.firstName?.trim() || user?.fullName?.split(" ")[0] || "there";

  const myTasks = (tasks ?? [])
    .filter((t) => t.status !== "completed")
    .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
    .slice(0, 4);

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            {greeting(now)}, {firstName} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Here&apos;s what&apos;s happening with your properties today.
          </p>
        </div>
        <div className="sm:text-right">
          <div className="text-sm font-semibold text-foreground">
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground-subtle">
            Let&apos;s make it a productive day.
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <StatCard
              icon={UsersRound}
              label="New Leads"
              value={data?.stats.newLeads.value}
              changePct={data?.stats.newLeads.changePct ?? null}
            />
            <StatCard
              icon={PhoneCall}
              label="Calls Handled"
              value={data?.stats.callsHandled.value}
              changePct={data?.stats.callsHandled.changePct ?? null}
            />
            <StatCard
              icon={CalendarCheck}
              label="Tours Booked"
              value={data?.stats.toursBooked.value}
              changePct={data?.stats.toursBooked.changePct ?? null}
            />
          </div>

          <Card>
            <CardHeader title="Recent Leads" href="/leads" linkLabel="View all" />
            {data && data.recentLeads.length === 0 ? (
              <EmptyState>No leads yet. They&apos;ll show up here as Sarah takes calls.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-left">
                      {["Name", "Property", "Source", "Status", "Date"].map((heading) => (
                        <th
                          key={heading}
                          className="pb-3 pr-4 text-xs font-normal text-muted-foreground-subtle"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recentLeads ?? []).map((lead) => {
                      const status = STATUS_STYLES[lead.status as LeadStatus] ?? STATUS_STYLES.new;
                      return (
                        <tr key={lead.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-3.5 pr-4 text-xs font-medium text-foreground">
                            {lead.name}
                          </td>
                          <td className="py-3.5 pr-4 text-xs text-muted-foreground">{lead.property}</td>
                          <td className="py-3.5 pr-4 text-xs capitalize text-muted-foreground">
                            {lead.source}
                          </td>
                          <td className="py-3.5 pr-4">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
                            >
                              {status.label}
                            </span>
                          </td>
                          <td className="py-3.5 text-xs text-muted-foreground">
                            {relativeDay(lead.startedAt)}
                          </td>
                        </tr>
                      );
                    })}
                    {!data
                      ? Array.from({ length: 4 }).map((_, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0">
                            <td colSpan={5} className="py-3.5">
                              <div className="h-4 w-full animate-pulse rounded bg-muted" />
                            </td>
                          </tr>
                        ))
                      : null}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Today's Schedule" href="/calendar" linkLabel="View Calendar" />
            {data && data.todaysTours.length === 0 ? (
              <EmptyState>Nothing scheduled today.</EmptyState>
            ) : (
              <div className="flex flex-col">
                {(data?.todaysTours ?? []).map((tour, index) => (
                  <Link
                    key={tour.id}
                    href="/calendar"
                    className={`flex items-center gap-3 rounded-lg py-3 transition-colors hover:bg-muted/40 ${
                      index > 0 ? "border-t border-slate-100" : ""
                    }`}
                  >
                    <span className="w-14 shrink-0 text-xs font-medium leading-4 text-muted-foreground">
                      {formatTime(tour.start, tour.timeZone)}
                    </span>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">
                        Tour – {tour.propertyName}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground-subtle">
                        {[tour.bedrooms ? formatBedrooms(tour.bedrooms) : null, tour.callerName]
                          .filter(Boolean)
                          .join(" • ") || tour.propertyName}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground-subtle" />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="My Tasks" href="/tasks" linkLabel="View all" />
            {tasks && myTasks.length === 0 ? (
              <EmptyState>Nothing on your list. Enjoy it.</EmptyState>
            ) : (
              <div className="flex flex-col">
                {myTasks.map((task, index) => {
                  const priority = PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.medium;
                  return (
                    <div
                      key={task._id}
                      className={`flex items-start justify-between gap-3 py-3 ${
                        index > 0 ? "border-t border-slate-100" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <button
                          type="button"
                          onClick={() => void toggleTask({ taskId: task._id })}
                          aria-label={`Mark "${task.title}" as done`}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-input transition-colors hover:border-primary"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium leading-4 text-foreground">
                            {task.title}
                          </div>
                          {task.dueDate ? (
                            <div className="mt-1 text-[11px] text-muted-foreground-subtle">
                              {relativeDay(task.dueDate)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${priority.className}`}
                      >
                        {priority.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl border border-border/90 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
    >
      {children}
    </motion.section>
  );
}

function CardHeader({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <Link
        href={href}
        className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        {linkLabel}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{children}</p>;
}

function StatCard({
  icon: Icon,
  label,
  value,
  changePct,
}: {
  icon: typeof UsersRound;
  label: string;
  value?: number;
  changePct: number | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl border border-border/90 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="mt-4 text-3xl font-bold tracking-tight text-foreground">
        {value === undefined ? <span className="text-muted-foreground-subtle">—</span> : value}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {changePct === null ? (
          <span className="text-muted-foreground-subtle">No change to compare yet</span>
        ) : (
          <>
            <span
              className={`flex items-center gap-0.5 font-semibold ${
                changePct >= 0 ? "text-success" : "text-red-500"
              }`}
            >
              <ArrowUpRight className={`h-3 w-3 ${changePct >= 0 ? "" : "rotate-90"}`} />
              {changePct >= 0 ? "+" : ""}
              {changePct}%
            </span>
            <span className="text-muted-foreground-subtle">vs last week</span>
          </>
        )}
      </div>
    </motion.div>
  );
}
