"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  MapPin,
  PhoneCall,
  Route,
  Siren,
  User,
  Wallet,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { RequireView } from "@/components/require-view";
import { mrNumber, timeAgo } from "@/components/maintenance/shared";
import {
  Card,
  CardHead,
  FlowStrip,
  Grid2,
  IconTile,
  Kpi,
  KpiRow,
  ListRow,
  PageHeader,
  Pill,
  SevChip,
} from "@/components/ui";
import type { Tone } from "@/components/ui";
import { AmDashboard } from "@/components/dashboard/am-dashboard";
import { FollowUpCard } from "@/components/dashboard/follow-up-card";
import { AssetManagersCard, TechniciansCard } from "@/components/dashboard/people-cards";
import { browserTimeZone, formatTime, greeting, relativeDay } from "@/components/dashboard/format";

type LeadStatus = "tour_booked" | "escalated" | "disqualified" | "qualified" | "contacted" | "new";

// Capture only (PRD §17): "Matches criteria" / "Review needed", never an auto-verdict.
const LEAD_PILL: Record<LeadStatus, { label: string; tone: Tone }> = {
  tour_booked: { label: "Tour booked", tone: "acc" },
  qualified: { label: "Matches criteria", tone: "warn" },
  contacted: { label: "Contacted", tone: "vio" },
  new: { label: "New", tone: "ok" },
  disqualified: { label: "Review needed", tone: "neutral" },
  escalated: { label: "Escalated", tone: "bad" },
};

const PRIORITY_TONE: Record<string, { label: string; tone: Tone }> = {
  high: { label: "High", tone: "bad" },
  medium: { label: "Medium", tone: "warn" },
  low: { label: "Low", tone: "acc" },
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

function DashboardPageInner() {
  const { user } = useUser();
  const data = useQuery(api.dashboard.overview, { fallbackTimeZone: browserTimeZone() });
  const tasks = useQuery(api.tasks.list, { mine: true });
  const toggleTask = useMutation(api.tasks.toggleComplete);
  const access = useQuery(api.team.myAccess);
  const view = access?.view;
  const isAdmin = view === "admin";
  const isAccountant = view === "accountant";
  const showMaintenance = isAdmin || view === "asset_manager";
  const m = data?.maintenance;
  const p = data?.pipeline;

  const firstName = user?.firstName?.trim() || user?.fullName?.split(" ")[0] || "there";
  const myTasks = (tasks ?? [])
    .filter((t) => t.status !== "completed")
    .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
    .slice(0, 4);

  const openWos = p ? p.review + p.pat + p.tech + p.signoff : undefined;
  const calls = data?.callsThisWeek;
  const timeZone = data?.timeZone ?? browserTimeZone();

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title={`${greeting(new Date())}, ${firstName}`}
        subtitle="Here’s what’s happening with your properties today."
      />

      {isAccountant ? (
        <KpiRow>
          <Kpi label="Work orders completed this week" icon={<CheckCircle2 />} value={m?.completedThisWeek ?? "—"} />
          <Card className="flex items-center gap-3 !rounded-[18px] !px-4 !py-3.5">
            <IconTile tone="acc">
              <Wallet />
            </IconTile>
            <div>
              <h2 className="text-sm font-semibold">Finance</h2>
              <p className="text-xs text-muted-foreground">Payments and owner statements are coming soon.</p>
            </div>
          </Card>
        </KpiRow>
      ) : (
        <KpiRow>
          <Kpi
            label="Open work orders"
            icon={<ClipboardList />}
            value={openWos ?? "—"}
            sub={p ? `${p.pat + p.signoff} need your sign-off` : undefined}
            subTone={p && p.pat + p.signoff > 0 ? "down" : "muted"}
          />
          <Kpi
            label="Emergencies (24h)"
            icon={<Siren />}
            value={m?.emergencies24h ?? "—"}
            sub="Reported in the last day"
            subTone={m && m.emergencies24h > 0 ? "down" : "muted"}
          />
          <Kpi
            label="Calls handled"
            icon={<PhoneCall />}
            value={calls?.value ?? "—"}
            sub={
              calls?.changePct == null
                ? "Leads and tenants this week"
                : `${calls.changePct >= 0 ? "+" : ""}${calls.changePct}% vs last week`
            }
            subTone={calls?.changePct == null ? "muted" : calls.changePct >= 0 ? "up" : "down"}
          />
          <Kpi label="Completed this week" icon={<CheckCircle2 />} value={m?.completedThisWeek ?? "—"} sub="Signed-off work orders" />
        </KpiRow>
      )}

      {showMaintenance ? (
        <Card>
          <CardHead
            title="Maintenance pipeline"
            icon={<Route />}
            right={
              <Link href="/work-orders" className="font-medium text-primary hover:underline">
                Open board →
              </Link>
            }
            hint="Tenant call → asset manager → Pat → technician → sign-off"
          />
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
      ) : null}

      {isAdmin ? (
        <Grid2>
          <AssetManagersCard rows={data?.assetManagers} />
          <TechniciansCard rows={data?.technicians} />
        </Grid2>
      ) : null}

      <Grid2>
        <div className="space-y-5">
          {showMaintenance ? (
            <Card>
              <CardHead title="Needs your attention" icon={<Bell />} />
              {data && data.attention.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted-foreground">Nothing is waiting on you.</p>
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
                            <ChevronRight className="h-4 w-4 text-faint" aria-hidden />
                          </>
                        }
                      />
                    </Link>
                  ))}
                  {!data ? <div className="h-4 w-full animate-pulse rounded bg-muted" /> : null}
                </div>
              )}
            </Card>
          ) : null}
          {isAdmin ? <FollowUpCard /> : null}
        </div>

        {!isAccountant ? (
          <div className="space-y-5">
            <Card>
              <CardHead
                title="Today’s schedule"
                icon={<CalendarDays />}
                right={
                  <Link href="/calendar" className="font-medium text-primary hover:underline">
                    View calendar →
                  </Link>
                }
              />
              {data && data.todaySchedule.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted-foreground">Nothing scheduled today.</p>
              ) : (
                <div>
                  {(data?.todaySchedule ?? []).map((s, i) => (
                    <Link key={`${s.kind}-${s.id}`} href={s.kind === "tour" ? "/calendar" : "/work-orders?lane=tech"} className="block">
                      <ListRow
                        first={i === 0}
                        icon={
                          <IconTile tone={s.kind === "tour" ? "acc" : "ok"}>
                            {s.kind === "tour" ? <MapPin /> : <Wrench />}
                          </IconTile>
                        }
                        title={s.kind === "tour" ? `Tour · ${s.label}` : s.label}
                        sub={`${s.sub} · ${s.start != null ? formatTime(s.start, timeZone) : (s.window ?? "Today")}`}
                      />
                    </Link>
                  ))}
                  {!data ? <div className="h-4 w-full animate-pulse rounded bg-muted" /> : null}
                </div>
              )}

              <div className="mt-4 border-t border-border pt-4">
                <CardHead
                  title="Recent leads"
                  icon={<User />}
                  right={
                    <Link href="/leads" className="font-medium text-primary hover:underline">
                      View all →
                    </Link>
                  }
                />
                {data && data.recentLeads.length === 0 ? (
                  <p className="py-2 text-center text-[12.5px] text-muted-foreground">
                    No leads yet. They’ll show up here as Sarah takes calls.
                  </p>
                ) : (
                  <div>
                    {(data?.recentLeads ?? []).map((lead, i) => {
                      const pill = LEAD_PILL[lead.status as LeadStatus] ?? LEAD_PILL.new;
                      return (
                        <ListRow
                          key={lead.id}
                          first={i === 0}
                          title={lead.name}
                          sub={`${lead.property} · ${lead.source === "call" ? "Call" : "Browser"} · ${relativeDay(lead.startedAt)}`}
                          right={<Pill tone={pill.tone}>{pill.label}</Pill>}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          </div>
        ) : null}
      </Grid2>

      {showMaintenance && m && m.recent.length > 0 ? (
        <Card>
          <CardHead
            title="Recent maintenance"
            icon={<Wrench />}
            right={
              <Link href="/work-orders" className="font-medium text-primary hover:underline">
                View all →
              </Link>
            }
          />
          <div>
            {m.recent.map((r, i) => (
              <Link key={r._id} href={`/maintenance/${r._id}`} className="block">
                <ListRow
                  first={i === 0}
                  title={`${r.propertyName ?? "Unknown property"}${r.unitNumber ? ` · ${r.unitNumber}` : ""} · ${r.description}`}
                  sub={`${mrNumber(r.number)} · ${timeAgo(r.createdAt)}`}
                  right={<SevChip level={r.severity} />}
                />
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHead
          title="My tasks"
          right={
            <Link href="/tasks" className="font-medium text-primary hover:underline">
              View all →
            </Link>
          }
        />
        {tasks && myTasks.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-muted-foreground">Nothing on your list. Enjoy it.</p>
        ) : (
          <div>
            {myTasks.map((task, i) => {
              const priority = PRIORITY_TONE[task.priority] ?? PRIORITY_TONE.medium;
              return (
                <ListRow
                  key={task._id}
                  first={i === 0}
                  icon={
                    <button
                      type="button"
                      onClick={() => void toggleTask({ taskId: task._id })}
                      aria-label={`Mark "${task.title}" as done`}
                      className="h-[18px] w-[18px] shrink-0 rounded-md border-[1.5px] border-border-strong transition-colors hover:border-primary"
                    />
                  }
                  title={task.title}
                  sub={task.dueDate ? relativeDay(task.dueDate) : undefined}
                  right={<Pill tone={priority.tone}>{priority.label}</Pill>}
                />
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function DashboardSwitch() {
  const access = useQuery(api.team.myAccess);
  return access?.view === "asset_manager" ? <AmDashboard /> : <DashboardPageInner />;
}

export default function DashboardPage() {
  return (
    <RequireView views={["admin", "accountant", "asset_manager"]}>
      <DashboardSwitch />
    </RequireView>
  );
}
