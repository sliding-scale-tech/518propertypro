"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  Bell,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Home,
  MoreHorizontal,
  PenSquare,
  PhoneCall,
  Route,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { mrNumber } from "@/components/maintenance/shared";
import { Card, FlowStrip, IconTile, ListRow, Pill, SevChip, cx } from "@/components/ui";
import type { Tone } from "@/components/ui";
import { AdminLeadsCard } from "@/components/dashboard/lead-cards";
import { FollowUpCard } from "@/components/dashboard/follow-up-card";
import { LeasesCard } from "@/components/dashboard/leases-card";
import { AssetManagersCard, TechniciansCard } from "@/components/dashboard/people-cards";
import { browserTimeZone, greetingIn, longDateIn, shortDateIn } from "@/components/dashboard/format";

type LeadStatus = "tour_booked" | "escalated" | "disqualified" | "qualified" | "contacted" | "new";

const LEAD_TONE: Record<LeadStatus, Tone> = {
  tour_booked: "acc",
  new: "ok",
  contacted: "vio",
  qualified: "warn",
  escalated: "bad",
  disqualified: "neutral",
};

const WO_TONE: Record<string, Tone> = {
  "Asset Manager Review": "neutral",
  "Admin Review": "vio",
  Escalated: "warn",
  "Work in Progress": "acc",
  "Completed (Needs Sign Off)": "ok",
  Closed: "neutral",
  "Rejected as Out of Scope": "bad",
};

const ATTENTION_ROUTE = {
  pat: "/work-orders?lane=pat",
  signoff: "/work-orders?lane=signoff",
  exception: "/maintenance/exceptions",
} as const;

const ATTENTION_LABEL = {
  pat: "Waiting on you to create",
  signoff: "Completed, needs sign-off",
  exception: "Needs routing",
} as const;

const linkCls = "text-[13px] font-medium text-primary hover:underline";

function CardTitle({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
      <Link href={href} className={linkCls}>
        {linkLabel}
      </Link>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="py-6 text-center text-[12.5px] text-muted-foreground">{children}</p>
);

const Skeleton = () => <div className="h-4 w-full animate-pulse rounded bg-muted" />;

const TH = "px-1 py-2 text-left text-[12px] font-medium text-muted-foreground";
const TD = "border-t border-border px-1 py-3.5 align-middle";

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <div className="mt-1 text-[12px]">
      <span className={cx("font-medium", up ? "text-success-ink" : "text-danger-ink")}>
        {up ? "↑ +" : "↓ "}
        {pct}%
      </span>{" "}
      <span className="text-muted-foreground">vs last week</span>
    </div>
  );
}

function KpiCard({ icon, label, value, children }: { icon: ReactNode; label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-[20px] border border-border bg-card px-5 py-5">
      <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
        <IconTile tone="acc">{icon}</IconTile>
        {label}
      </div>
      <div className="mt-4 text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums">{value}</div>
      {children}
    </div>
  );
}

function RowMore({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className="inline-flex rounded-md p-1 text-faint hover:bg-muted hover:text-foreground">
      <MoreHorizontal className="h-4 w-4" aria-hidden />
    </Link>
  );
}

/** The admin's dashboard. Scope and permissions are enforced by dashboard.overview. */
export function AdminDashboard() {
  const { user } = useUser();
  const router = useRouter();
  const data = useQuery(api.dashboard.overview, { fallbackTimeZone: browserTimeZone() });
  // Rendered behind RequireView (client-only, after access loads), so reading the clock here is safe.
  const [now] = useState<Date>(() => new Date());

  const timeZone = data?.timeZone ?? browserTimeZone();
  const firstName = user?.firstName?.trim() || user?.fullName?.split(" ")[0] || "there";
  const dash = data?.adminDash ?? null;
  const p = data?.pipeline;

  const woHref = (kind: "work_order" | "request", id: string) => `/work-orders?open=${kind}:${encodeURIComponent(id)}`;

  const tiles = dash
    ? [
        { label: "Work Orders", value: dash.propertiesSnapshot.workOrders, href: "/work-orders", icon: <Home /> },
        { label: "Total Units", value: dash.propertiesSnapshot.totalUnits, href: "/properties", icon: <Building2 /> },
        { label: "Asset Managers", value: dash.propertiesSnapshot.assetManagers, href: "/asset-managers", icon: <Users /> },
        { label: "Active Technicians", value: dash.propertiesSnapshot.activeTechnicians, href: "/technicians", icon: <PenSquare /> },
      ].filter((t) => t.value !== null)
    : [];

  const exceptionCount = data ? data.attention.filter((a) => a.reason === "exception").length : 0;

  return (
    <div className="space-y-8 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[240px]">
          <h1 className="text-balance text-[28px] font-bold leading-[1.2] tracking-[-0.02em]">
            {greetingIn(now, timeZone)}, {firstName} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Here’s what’s happening with your properties today.</p>
        </div>
        <div className="pt-2 text-[14px] font-semibold">{longDateIn(now, timeZone)}</div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard icon={<PhoneCall />} label="Calls Handled" value={dash?.kpis.callsHandled.value ?? "—"}>
              {dash ? <Delta pct={dash.kpis.callsHandled.deltaPct} /> : null}
            </KpiCard>
            <KpiCard icon={<CalendarCheck />} label="Tours Booked" value={dash?.kpis.toursBooked.value ?? "—"}>
              {dash ? <Delta pct={dash.kpis.toursBooked.deltaPct} /> : null}
            </KpiCard>
            <KpiCard icon={<Wrench />} label="Active Work Orders" value={dash?.kpis.activeWorkOrders.value ?? "—"}>
              {dash ? (
                <div className="mt-1 text-[12px] font-medium text-danger-ink">
                  {dash.kpis.activeWorkOrders.highPriority} high priority
                </div>
              ) : null}
            </KpiCard>
          </div>

          <Card>
            <CardTitle title="Recent Leads" href="/leads" linkLabel="View all →" />
            {dash && dash.recentLeads.length === 0 ? (
              <Empty>No leads yet. They’ll show up here as Sarah takes calls.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {["Name", "Property", "Source", "Status", "Date"].map((h) => (
                        <th key={h} scope="col" className={TH}>
                          {h}
                        </th>
                      ))}
                      <th scope="col" className="w-8">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dash?.recentLeads ?? []).map((l) => (
                      <tr key={l.id} onClick={() => router.push("/leads")} className="cursor-pointer hover:bg-muted/60">
                        <td className={cx(TD, "font-medium")}>
                          <Link href="/leads" onClick={(e) => e.stopPropagation()}>
                            {l.name}
                          </Link>
                        </td>
                        <td className={TD}>{l.property}</td>
                        <td className={TD}>{l.sourceLabel}</td>
                        <td className={TD}>
                          <Pill tone={LEAD_TONE[l.status as LeadStatus] ?? "ok"}>{l.statusLabel}</Pill>
                        </td>
                        <td className={cx(TD, "text-muted-foreground")}>{l.dateLabel}</td>
                        <td className={TD} onClick={(e) => e.stopPropagation()}>
                          <RowMore href="/leads" label={`Open leads for ${l.name}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!dash ? <Skeleton /> : null}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle title="Open Work Orders" href="/work-orders" linkLabel="Maintenance Inbox →" />
            {dash && dash.openWorkOrders.length === 0 ? (
              <Empty>No open work orders.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {["#", "Unit", "Property", "Issue", "Assigned To", "Status", "Due"].map((h) => (
                        <th key={h} scope="col" className={TH}>
                          {h}
                        </th>
                      ))}
                      <th scope="col" className="w-8">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dash?.openWorkOrders ?? []).map((w) => {
                      const href = woHref(w.kind, w.id);
                      return (
                        <tr key={`${w.kind}-${w.id}`} onClick={() => router.push(href)} className="cursor-pointer hover:bg-muted/60">
                          <td className={cx(TD, "whitespace-nowrap text-muted-foreground")}>
                            <Link href={href} onClick={(e) => e.stopPropagation()} className="hover:text-primary">
                              {w.number}
                            </Link>
                          </td>
                          <td className={TD}>{w.unit ?? "—"}</td>
                          <td className={TD}>{w.property ?? "—"}</td>
                          <td className={cx(TD, "max-w-[180px] truncate")}>{w.issue}</td>
                          <td className={TD}>{w.assignedToName ?? "—"}</td>
                          <td className={TD}>
                            <Pill tone={WO_TONE[w.statusLabel] ?? "neutral"}>{w.statusLabel}</Pill>
                          </td>
                          <td className={cx(TD, "whitespace-nowrap")}>{w.dueDate ? shortDateIn(w.dueDate, timeZone) : "—"}</td>
                          <td className={TD} onClick={(e) => e.stopPropagation()}>
                            <RowMore href={href} label={`Open ${w.number}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!dash ? <Skeleton /> : null}
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardTitle title="Today’s Schedule" href="/calendar" linkLabel="View Calendar →" />
            {dash && dash.todaySchedule.length === 0 ? (
              <Empty>Nothing scheduled today.</Empty>
            ) : (
              <div>
                {(dash?.todaySchedule ?? []).map((s, i) => (
                  <Link
                    key={`${s.kind}-${s.id}`}
                    href={s.kind === "tour" ? "/calendar" : woHref("work_order", s.id)}
                    className={cx("group flex items-center gap-3 py-3", i > 0 && "border-t border-border")}
                  >
                    <span className="w-[62px] shrink-0 text-[12px] text-muted-foreground">{s.time}</span>
                    <span aria-hidden className={cx("h-1.5 w-1.5 shrink-0 rounded-full", s.kind === "tour" ? "bg-primary" : "bg-success")} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold group-hover:text-primary">{s.title}</span>
                      {s.sub ? <span className="block text-[12px] text-muted-foreground">{s.sub}</span> : null}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                  </Link>
                ))}
                {!dash ? <Skeleton /> : null}
              </div>
            )}
          </Card>

          {tiles.length > 0 ? (
            <Card>
              <h2 className="mb-3 text-[16px] font-semibold tracking-[-0.01em]">Properties Snapshot</h2>
              <div className="grid grid-cols-2 gap-3">
                {tiles.map((t) => (
                  <Link
                    key={t.label}
                    href={t.href}
                    className="flex items-center gap-2.5 rounded-[14px] border border-border p-3 transition-colors hover:border-accent-line hover:bg-accent/40"
                  >
                    <IconTile tone="acc">{t.icon}</IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[18px] font-bold leading-tight tabular-nums">{t.value}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">{t.label}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="needs-attention" className="space-y-5">
        <h2 id="needs-attention" className="text-[16px] font-semibold tracking-[-0.01em]">
          Needs attention
        </h2>

        <AdminLeadsCard />

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <div className="mb-3.5 flex items-center gap-2.5">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
                <Bell /> Needs your attention
              </h3>
              {exceptionCount > 0 ? (
                <Link href="/maintenance/exceptions" className="ml-auto">
                  <Pill tone="bad" dot>
                    {exceptionCount} need routing
                  </Pill>
                </Link>
              ) : null}
            </div>
            {data && data.attention.length === 0 ? (
              <Empty>Nothing is waiting on you.</Empty>
            ) : (
              <div>
                {(data?.attention ?? []).map((a, i) => (
                  <Link key={`${a.kind}-${a.id}`} href={ATTENTION_ROUTE[a.reason]} className="block">
                    <ListRow
                      first={i === 0}
                      icon={
                        <IconTile tone={a.reason === "signoff" ? "ok" : a.reason === "exception" ? "bad" : "vio"}>
                          {a.reason === "signoff" ? <CheckCircle2 /> : <Wrench />}
                        </IconTile>
                      }
                      title={a.title}
                      sub={`${a.kind === "work_order" ? `WO-${a.number}` : mrNumber(a.number)} · ${[a.propertyName, a.unitNumber].filter(Boolean).join(" ")} · ${ATTENTION_LABEL[a.reason]}`}
                      right={
                        <>
                          <SevChip level={a.severity} score={a.severityScore ?? undefined} />
                          <ArrowRight className="h-4 w-4 text-faint" aria-hidden />
                        </>
                      }
                    />
                  </Link>
                ))}
                {!data ? <Skeleton /> : null}
              </div>
            )}
          </Card>
          <FollowUpCard />
        </div>

        <LeasesCard />

        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
              <Route /> Maintenance pipeline
            </h3>
            <Link href="/work-orders" className={linkCls}>
              Open board →
            </Link>
          </div>
          <FlowStrip
            steps={[
              { value: p?.review ?? "—", label: "Captured by Sarah, with asset managers" },
              { value: p?.pat ?? "—", label: "Waiting on you to create" },
              { value: p?.tech ?? "—", label: "With technicians" },
              { value: p?.signoff ?? "—", label: "Completed, needs sign-off" },
              { value: p?.closedThisMonth ?? "—", label: "Closed this month" },
            ]}
          />
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <AssetManagersCard rows={data?.assetManagers} />
          <TechniciansCard rows={data?.technicians} />
        </div>
      </section>
    </div>
  );
}
