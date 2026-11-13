"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Building2, CalendarDays, ClipboardList, Eye, MapPin, Siren, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { mrNumber, timeAgo } from "@/components/maintenance/shared";
import {
  Card,
  CardHead,
  DataTable,
  Grid2,
  IconTile,
  Kpi,
  KpiRow,
  ListRow,
  PageHeader,
  Pill,
  SevChip,
} from "@/components/ui";
import { AmLeadCards } from "@/components/dashboard/lead-cards";
import { LeasesCard } from "@/components/dashboard/leases-card";
import { browserTimeZone, relativeDay } from "@/components/dashboard/format";

function hourWord(at: Date) {
  const h = at.getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function formatStart(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(at);
}

const Empty = ({ children }: { children: string }) => (
  <p className="py-4 text-center text-[12.5px] text-muted-foreground">{children}</p>
);

const Skeleton = () => <div className="h-4 w-full animate-pulse rounded bg-muted" />;

const where = (property: string | null | undefined, unit: string | null | undefined) =>
  [property, unit].filter(Boolean).join(" ");

/** The asset manager's own dashboard. Scope and permissions are enforced by dashboard.amOverview. */
export function AmDashboard() {
  const { user } = useUser();
  const data = useQuery(api.dashboard.amOverview, { fallbackTimeZone: browserTimeZone() });

  const firstName = data?.firstName || user?.firstName?.trim() || "there";

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        eyebrow="Asset manager dashboard"
        title={`Good ${hourWord(new Date())}, ${firstName}`}
        subtitle={
          data
            ? `You're the asset manager for ${data.unitCount} unit${data.unitCount === 1 ? "" : "s"} across ${joinAnd(data.propertyNames)}.`
            : undefined
        }
      />

      <KpiRow>
        <Kpi
          label="Waiting on your review"
          icon={<ClipboardList />}
          value={data?.kpis.toReview ?? "—"}
          sub={
            data
              ? data.kpis.oldestReviewCreatedAt != null
                ? `Oldest: ${timeAgo(data.kpis.oldestReviewCreatedAt)}`
                : "All caught up"
              : undefined
          }
          subTone={data && data.kpis.toReview > 0 ? "down" : "muted"}
        />
        <Kpi
          label="Escalations this week"
          icon={<Siren />}
          value={data?.kpis.escalationsThisWeek ?? "—"}
          sub="Sarah alerts you on urgent calls"
        />
        <Kpi
          label="Work orders in progress"
          icon={<Wrench />}
          value={data?.kpis.inProgress ?? "—"}
          sub="With Pat or a technician"
        />
        <Kpi
          label="Tours this week"
          icon={<CalendarDays />}
          value={data?.kpis.toursThisWeek ?? "—"}
          sub="Booked by Sarah on your calendar"
        />
      </KpiRow>

      <AmLeadCards />

      <Grid2>
        <Card>
          <CardHead
            title="Your review queue"
            icon={<ClipboardList />}
            right={
              <Link href="/work-orders?lane=review" className="font-medium text-primary hover:underline">
                Open board →
              </Link>
            }
            hint="Approve real repairs, ask for photos when it's unclear, or reject."
          />
          {data && data.reviewQueue.length === 0 ? (
            <Empty>Nothing to review.</Empty>
          ) : (
            <div>
              {(data?.reviewQueue ?? []).slice(0, 6).map((r, i) => (
                <Link key={r.id} href={`/work-orders?open=request:${r.id}`} className="block">
                  <ListRow
                    first={i === 0}
                    icon={
                      <IconTile tone="vio">
                        <Wrench />
                      </IconTile>
                    }
                    title={r.title}
                    sub={`${mrNumber(r.number)} · ${where(r.propertyName, r.unitNumber)} · ${r.status.replace(/_/g, " ")}`}
                    right={<SevChip level={r.severity} score={r.severityScore ?? undefined} />}
                  />
                </Link>
              ))}
              {!data ? <Skeleton /> : null}
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            title="Your tours"
            icon={<MapPin />}
            right={
              <Link href="/calendar" className="font-medium text-primary hover:underline">
                Calendar →
              </Link>
            }
          />
          {data && data.tours.length === 0 ? (
            <Empty>No tours booked.</Empty>
          ) : (
            <div>
              {(data?.tours ?? []).map((t, i) => (
                <ListRow
                  key={t.id}
                  first={i === 0}
                  icon={
                    <IconTile tone="acc">
                      <MapPin />
                    </IconTile>
                  }
                  title={`Tour · ${t.callerName}`}
                  sub={`${t.propertyName} · ${formatStart(t.start, t.timeZone)}`}
                />
              ))}
              {!data ? <Skeleton /> : null}
            </div>
          )}
        </Card>
      </Grid2>

      <Grid2>
        <Card>
          <CardHead title="Escalations" icon={<Siren />} />
          {data && data.escalations.length === 0 ? (
            <Empty>No escalations this week.</Empty>
          ) : (
            <div>
              {(data?.escalations ?? []).map((e, i) => (
                <Link key={e.id} href={`/work-orders?open=request:${e.id}`} className="block">
                  <ListRow
                    first={i === 0}
                    title={e.title}
                    sub={`${e.where} · ${relativeDay(e.createdAt)}${e.outcome ? ` · ${e.outcome}` : ""}`}
                    right={<SevChip level={e.severity} score={e.severityScore ?? undefined} />}
                  />
                </Link>
              ))}
              {!data ? <Skeleton /> : null}
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="Your units in progress" icon={<Wrench />} />
          {data && data.inProgress.length === 0 ? (
            <Empty>Nothing in progress.</Empty>
          ) : (
            <div>
              {(data?.inProgress ?? []).map((w, i) => (
                <Link key={`${w.kind}-${w.id}`} href={`/work-orders?open=${w.kind}:${w.id}`} className="block">
                  <ListRow
                    first={i === 0}
                    title={w.title}
                    sub={`${where(w.propertyName, w.unitNumber)}${w.techName ? ` · ${w.techName}` : ""}`}
                    right={
                      <>
                        {w.covering ? (
                          <Pill tone="neutral">
                            <Eye className="h-3 w-3" />
                            Covering
                          </Pill>
                        ) : null}
                        <Pill tone="acc">{w.stageLabel}</Pill>
                      </>
                    }
                  />
                </Link>
              ))}
              {!data ? <Skeleton /> : null}
            </div>
          )}
        </Card>
      </Grid2>

      <LeasesCard />

      <Card>
        <CardHead title="Your properties" icon={<Building2 />} />
        <DataTable
          caption="Your properties"
          rows={data?.properties ?? []}
          rowKey={(p) => p.propertyId}
          empty={data ? "No properties yet." : "Loading…"}
          columns={[
            {
              key: "property",
              header: "Property",
              render: (p) => (
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.address}</div>
                </div>
              ),
            },
            { key: "units", header: "Your units", render: (p) => `${p.yourUnits} of ${p.totalUnits}` },
            { key: "open", header: "Open requests", render: (p) => p.openRequests },
            {
              key: "link",
              header: "",
              align: "right",
              render: (p) => (
                <Link href={`/properties?property=${p.propertyId}`} className="font-medium text-primary hover:underline">
                  Units →
                </Link>
              ),
            },
          ]}
        />
      </Card>

      {data && data.covering.length > 0 ? (
        <Card>
          <CardHead title="Covering for teammates" icon={<Users />} hint="Read only while they're out." />
          <div>
            {data.covering.map((c, i) => (
              <ListRow
                key={c.forName}
                first={i === 0}
                title={c.forName}
                sub={`${c.units} unit${c.units === 1 ? "" : "s"} · ${c.openRequests} open`}
              />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
