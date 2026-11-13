"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Building2, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage, useToast } from "@/components/toast";
import { Modal } from "@/components/maintenance/shared";
import {
  Avatar,
  Btn,
  Card,
  CardHead,
  DataTable,
  Field,
  Grid2,
  IconTile,
  ListRow,
  Pagination,
  Pill,
  SearchBox,
  SevChip,
  Select,
  SortHeader,
  Toggle,
  ariaSortOf,
  paginate,
  toggleSort,
  type Column,
} from "@/components/ui";
import { browserTimeZone, formatTime } from "@/components/dashboard/format";
import { TEAM_LABELS, teamLabel, type Team } from "@/convex/rentPaymentsPolicy";
import { BulkChangeDialog } from "./bulk-change-dialog";
import {
  AM_FILTER_NONE,
  ASSIGNMENT_SORT_DEFAULT,
  assignmentsView,
  managerSummary,
  type AssignmentSortKey,
} from "./assignments-view";

const PAGE_SIZE = 25;
const TEAMS = Object.keys(TEAM_LABELS) as Team[];

type ApplyTo = "units_without_override" | "all";

type PropertyRow = {
  _id: Id<"properties">;
  name: string;
  address?: { formatted: string };
  category?: string;
  defaultAssetManagerUserId?: Id<"users">;
  ownerName?: string;
  unitCount: number;
  overrideCount: number;
};

export function PropertyAssignmentsTab() {
  const toast = useToast();
  const team = useQuery(api.team.overview);
  const dash = useQuery(api.dashboard.overview, { fallbackTimeZone: browserTimeZone() });
  const properties = useQuery(api.properties.list);
  const escalation = useQuery(api.sarahConfig.escalationSummary);
  const setTakingTours = useMutation(api.tours.setTakingTours);
  const setDefaultAm = useMutation(api.properties.setDefaultAssetManager);

  const [pending, setPending] = useState<{ property: PropertyRow; userId: Id<"users">; name: string } | null>(null);
  const [applyTo, setApplyTo] = useState<ApplyTo>("units_without_override");
  const [saving, setSaving] = useState(false);
  const [bulk, setBulk] = useState<{ propertyId: Id<"properties">; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [amFilter, setAmFilter] = useState("");
  const [sort, setSort] = useState(ASSIGNMENT_SORT_DEFAULT);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);

  const ams = (team?.members ?? []).filter((m) => m.jobRoles.includes("asset_manager"));
  const stats = new Map((dash?.assetManagers ?? []).map((a) => [String(a.userId), a]));
  const nameOf = new Map(ams.map((a) => [String(a.userId), a.name]));
  const rows: PropertyRow[] = (properties ?? []) as PropertyRow[];
  const upcoming = useQuery(api.tours.upcoming, { days: 7 });

  async function toggleTours(userId: Id<"users">, name: string, next: boolean) {
    try {
      await setTakingTours({ userId, takingTours: next });
      toast(next ? `Sarah will book tours for ${name}` : `Sarah stops booking tours for ${name}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function confirmAssign() {
    if (!pending) return;
    setSaving(true);
    try {
      const res = await setDefaultAm({ propertyId: pending.property._id, userId: pending.userId, applyTo });
      toast(`${pending.property.name} now routes to ${pending.name} (${res.changed} of ${res.total} units updated)`);
      setPending(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const visible = assignmentsView(rows, { q: search, team: teamFilter, am: amFilter, sort });
  const paged = paginate(visible, page, PAGE_SIZE);
  const filtered = Boolean(search.trim() || teamFilter || amFilter);
  const filteredAm = ams.find((a) => String(a.userId) === amFilter);

  const onSort = (key: AssignmentSortKey) => {
    setSort(toggleSort(sort, key));
    setPage(1);
  };
  const sortable = (key: AssignmentSortKey, label: string, align: "left" | "right" = "left") => ({
    header: <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} align={align} />,
    sort: ariaSortOf(sort, key),
  });
  const clearFilters = () => {
    setSearch("");
    setTeamFilter("");
    setAmFilter("");
    setPage(1);
  };
  function viewBuildings(userId: string) {
    setSearch("");
    setTeamFilter("");
    setAmFilter(amFilter === userId ? "" : userId);
    setPage(1);
    if (amFilter !== userId) tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const columns: Column<PropertyRow>[] = [
    {
      key: "name",
      ...sortable("name", "Building"),
      render: (p) => (
        <div className="min-w-0">
          <Link href={`/properties?property=${encodeURIComponent(p._id)}`} className="font-medium text-primary hover:underline">
            {p.name}
          </Link>
          {p.address?.formatted && p.address.formatted !== p.name ? (
            <div className="text-xs text-muted-foreground">{p.address.formatted}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "team",
      ...sortable("team", "Team"),
      render: (p) => (p.category ? <Pill>{teamLabel(p.category)}</Pill> : <span className="text-faint">No team</span>),
    },
    {
      key: "units",
      ...sortable("units", "Units", "right"),
      align: "right",
      className: "tabular-nums",
      render: (p) => p.unitCount,
    },
    {
      key: "am",
      header: "Default asset manager",
      render: (p) => {
        const name = p.defaultAssetManagerUserId ? nameOf.get(String(p.defaultAssetManagerUserId)) : undefined;
        return (
          <div>
            {name ? <span className="font-medium">{name}</span> : <span className="text-faint">Not set</span>}
            {p.overrideCount > 0 ? (
              <div>
                <Link href={`/properties?property=${encodeURIComponent(p._id)}`} className="text-xs text-muted-foreground hover:text-primary hover:underline">
                  {p.overrideCount} unit{p.overrideCount === 1 ? "" : "s"} assigned to someone else
                </Link>
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (p) => (
        <div className="flex items-center gap-2">
          <div className="w-[170px]">
            <Select
              aria-label={`Change default asset manager for ${p.name}`}
              value=""
              disabled={ams.length === 0}
              onChange={(e) => {
                const userId = e.target.value as Id<"users">;
                if (!userId) return;
                setApplyTo("units_without_override");
                setPending({ property: p, userId, name: nameOf.get(String(userId)) ?? "this person" });
              }}
            >
              <option value="">Change default…</option>
              {ams
                .filter((a) => a.userId !== p.defaultAssetManagerUserId)
                .map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </div>
          <Btn
            sm
            onClick={() => setBulk({ propertyId: p._id, name: p.name })}
            disabled={ams.length === 0 || p.unitCount === 0}
            title={p.unitCount === 0 ? "No units to move in this building" : undefined}
          >
            Change asset manager
          </Btn>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {team && ams.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No asset managers yet.{" "}
            <Link href="/team" className="font-medium text-primary hover:underline">
              Invite one from Team →
            </Link>
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3.5">
          {ams.map((am) => {
            const s = stats.get(String(am.userId));
            const sum = managerSummary(rows, String(am.userId));
            const first = am.name.split(" ")[0];
            const selected = amFilter === String(am.userId);
            const units = s?.units ?? am.unitsOwned;
            return (
              <Card key={am.userId} className={`flex flex-col gap-3 ${selected ? "!border-primary" : ""}`}>
                <div className="flex items-center gap-3">
                  <Avatar name={am.name} tone="acc" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{am.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {sum.teams.map((t) => (
                        <Pill key={t}>{teamLabel(t)}</Pill>
                      ))}
                      {sum.teams.length === 0 ? <span className="text-xs text-muted-foreground">No team yet</span> : null}
                    </div>
                  </div>
                </div>
                {sum.buildings === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No buildings yet</p>
                ) : (
                  <div className="text-[13px] text-muted-foreground">
                    <span className="font-semibold text-foreground tabular-nums">{sum.buildings}</span> building
                    {sum.buildings === 1 ? "" : "s"} ·{" "}
                    <span className="font-semibold text-foreground tabular-nums">{units}</span> unit{units === 1 ? "" : "s"}
                  </div>
                )}
                <div className="text-[13px] text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{s?.toReview ?? "—"}</span> to review ·{" "}
                  <span className="font-semibold text-foreground tabular-nums">{s?.toursThisWeek ?? "—"}</span> tours this week
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div className="flex items-center gap-2">
                    <Toggle
                      label={`Sarah books tours for ${am.name}`}
                      checked={am.takingTours}
                      onChange={(next) => void toggleTours(am.userId, am.name, next)}
                    />
                    <span className="text-xs text-muted-foreground">Sarah books tours for {first}</span>
                  </div>
                  <Btn
                    sm
                    onClick={() => viewBuildings(String(am.userId))}
                    disabled={sum.buildings === 0}
                    aria-pressed={selected}
                  >
                    {selected ? "Show all" : "View buildings"}
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div ref={tableRef} className="scroll-mt-4">
        <Card>
          <CardHead
            title="Property assignments"
            icon={<Building2 />}
            hint="Changing a default reroutes new requests right away. Open maintenance requests on the units that change move to the new asset manager (leads are not moved here; use Change asset manager on the property to move leads too). To give one unit a different asset manager, use Property."
          />
          <div className="mb-3">
            <SearchBox
              id="assignments-search"
              label="Search buildings"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              onClear={() => {
                setSearch("");
                setPage(1);
              }}
              placeholder="Search building or address"
            />
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Team" htmlFor="assignments-team">
              <Select
                id="assignments-team"
                value={teamFilter}
                onChange={(e) => {
                  setTeamFilter(e.target.value || "");
                  setPage(1);
                }}
              >
                <option value="">All teams</option>
                {TEAMS.map((t) => (
                  <option key={t} value={t}>
                    {TEAM_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Asset manager" htmlFor="assignments-am">
              <Select
                id="assignments-am"
                value={amFilter}
                onChange={(e) => {
                  setAmFilter(e.target.value || "");
                  setPage(1);
                }}
              >
                <option value="">All asset managers</option>
                {ams.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.name}
                  </option>
                ))}
                <option value={AM_FILTER_NONE}>Not set</option>
              </Select>
            </Field>
          </div>
          <DataTable
            caption="Property assignments"
            columns={columns}
            rows={paged.rows}
            rowKey={(p) => p._id}
            empty={
              !properties ? (
                "Loading…"
              ) : rows.length === 0 ? (
                "No properties yet."
              ) : (
                <span>
                  No buildings match{filteredAm ? ` ${filteredAm.name}` : " these filters"}.{" "}
                  {filtered ? (
                    <button type="button" onClick={clearFilters} className="font-medium text-primary hover:underline">
                      Clear filters
                    </button>
                  ) : null}
                </span>
              )
            }
          />
          <Pagination
            page={paged.page}
            pageSize={PAGE_SIZE}
            total={paged.total}
            onPage={setPage}
            label="Property assignments pages"
            noun={paged.total === 1 ? "building" : "buildings"}
          />
        </Card>
      </div>

      <Grid2>
        <Card>
          <CardHead
            title="Escalation rules"
            icon={<AlertTriangle />}
            hint="From Sarah’s severity levels and escalation contacts."
          />
          {escalation && !escalation.published ? (
            <p className="mb-3 rounded-xl border border-dashed border-border-strong px-3 py-2 text-xs text-muted-foreground">
              Draft — not live yet.
            </p>
          ) : null}
          {!escalation ? (
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
          ) : (
            <div>
              {escalation.levels.map((lvl, i) => (
                <div key={lvl.level} className={`flex gap-3 py-2.5 ${i > 0 ? "border-t border-border" : "pt-0"}`}>
                  <div className="pt-0.5">
                    <SevChip level={lvl.level} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold capitalize">{lvl.level}</div>
                    <div className="text-[12.5px] text-muted-foreground">
                      {lvl.definition}
                      {lvl.responseTarget ? ` · ${lvl.responseTarget}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {lvl.contacts.map((c) => (
                        <Pill key={c.userId}>{c.name}</Pill>
                      ))}
                      {lvl.externalContactCount > 0 ? (
                        <Pill>
                          {lvl.externalContactCount} external contact{lvl.externalContactCount === 1 ? "" : "s"}
                        </Pill>
                      ) : null}
                      {lvl.level === "emergency" ? (
                        escalation.callForward.enabled ? (
                          <Pill tone="acc">Call forward</Pill>
                        ) : (
                          <Pill tone="warn">Call forward · Pending approval</Pill>
                        )
                      ) : null}
                      {lvl.contacts.length === 0 && lvl.externalContactCount === 0 && lvl.level !== "emergency" ? (
                        <Pill>Asset manager review queue</Pill>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex gap-3 border-t border-border py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">Leasing sales lead</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    Property-management sales opportunities (owner prospects) go to the person set in Sarah config.
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Pill tone={escalation.ownerLeads.enabled ? "ok" : "neutral"}>
                      {escalation.ownerLeads.enabled ? "On" : "Off"}
                    </Pill>
                    {escalation.ownerLeads.recipients.map((r) => (
                      <Pill key={r.userId}>{r.name}</Pill>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="Upcoming tours" icon={<CalendarDays />} right="Booked by Sarah on asset-manager calendars" />
          {upcoming && upcoming.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-muted-foreground">No tours booked in the next 7 days.</p>
          ) : (
            <div>
              {(upcoming ?? []).map((t, i) => (
                <ListRow
                  key={t.id}
                  first={i === 0}
                  icon={
                    <IconTile tone="acc">
                      <MapPin />
                    </IconTile>
                  }
                  title={`Tour${t.callerName ? ` · ${t.callerName}` : ""}`}
                  sub={`${t.assignedName}${t.propertyName ? ` · ${t.propertyName}` : ""} · ${new Date(t.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: t.timeZone })} ${formatTime(t.start, t.timeZone)}`}
                />
              ))}
              {!upcoming ? <div className="h-4 w-full animate-pulse rounded bg-muted" /> : null}
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Next 7 days. See the{" "}
            <Link href="/calendar" className="text-primary hover:underline">
              calendar
            </Link>{" "}
            for the full week.
          </p>
        </Card>
      </Grid2>

      {bulk ? (
        <BulkChangeDialog
          scope={{ kind: "building", propertyId: bulk.propertyId, name: bulk.name }}
          managers={ams.map((a) => ({ userId: a.userId, name: a.name }))}
          onClose={() => setBulk(null)}
        />
      ) : null}

      {pending ? (
        <Modal title={`Route ${pending.property.name} to ${pending.name}?`} onClose={() => (saving ? undefined : setPending(null))}>
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Every unit has one asset manager. Choose which units this change applies to. Open maintenance requests on the
              units that change move to the new asset manager. Leads are not moved here.
            </p>
            <fieldset className="space-y-2">
              <legend className="sr-only">Apply to</legend>
              {(
                [
                  ["units_without_override", "Units without an override", `Keeps the ${pending.property.overrideCount} unit exception(s) as they are.`],
                  ["all", "All units", "Also replaces every per-unit override."],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 ${applyTo === value ? "border-primary bg-accent" : "border-border"}`}
                >
                  <input
                    type="radio"
                    name="applyTo"
                    value={value}
                    checked={applyTo === value}
                    onChange={() => setApplyTo(value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-[13.5px] font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setPending(null)} disabled={saving}>
                Cancel
              </Btn>
              <Btn variant="pri" onClick={() => void confirmAssign()} disabled={saving}>
                {saving ? "Saving…" : "Confirm"}
              </Btn>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
