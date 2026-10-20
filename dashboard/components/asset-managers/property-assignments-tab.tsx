"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Building2, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";
import { Modal, cleanError } from "@/components/maintenance/shared";
import {
  Avatar,
  Btn,
  Card,
  CardHead,
  DataTable,
  FlowStrip,
  Grid2,
  IconTile,
  ListRow,
  Pill,
  SevChip,
  Select,
  Toggle,
  type Column,
} from "@/components/ui";
import { browserTimeZone, formatTime } from "@/components/dashboard/format";

type ApplyTo = "units_without_override" | "all";

type PropertyRow = {
  _id: Id<"properties">;
  name: string;
  address?: { formatted: string };
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
      toast(cleanError(e), "error");
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
      toast(cleanError(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<PropertyRow>[] = [
    {
      key: "property",
      header: "Property",
      render: (p) => (
        <div>
          <div className="font-medium">{p.name}</div>
          {p.address?.formatted ? <div className="text-xs text-muted-foreground">{p.address.formatted}</div> : null}
        </div>
      ),
    },
    { key: "units", header: "Units", align: "right", render: (p) => <span className="tabular-nums">{p.unitCount}</span> },
    { key: "owner", header: "Owner", render: (p) => p.ownerName ?? <span className="text-faint">—</span> },
    {
      key: "am",
      header: "Default asset manager",
      render: (p) => (
        <Select
          aria-label={`Default asset manager for ${p.name}`}
          value={p.defaultAssetManagerUserId ?? ""}
          disabled={ams.length === 0}
          onChange={(e) => {
            const userId = e.target.value as Id<"users">;
            if (!userId) return;
            setApplyTo("units_without_override");
            setPending({ property: p, userId, name: nameOf.get(String(userId)) ?? "this person" });
          }}
        >
          {!p.defaultAssetManagerUserId ? <option value="">Not set</option> : null}
          {ams.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: "exceptions",
      header: "Unit exceptions",
      render: (p) => (
        <Link href={`/properties/${p._id}`} className="text-[13px] font-medium text-primary hover:underline">
          {p.overrideCount > 0
            ? `${p.overrideCount} unit${p.overrideCount === 1 ? "" : "s"} assigned to someone else`
            : "Assign by unit"}
        </Link>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
          {ams.map((am) => {
            const s = stats.get(String(am.userId));
            const props = rows.filter((p) => p.defaultAssetManagerUserId === am.userId).map((p) => p.name);
            const first = am.name.split(" ")[0];
            return (
              <Card key={am.userId} className="flex flex-col gap-3.5">
                <div className="flex items-center gap-3">
                  <Avatar name={am.name} tone="acc" />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{am.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{am.phone ?? "No phone on file"}</div>
                  </div>
                </div>
                <div className="text-[13px] text-muted-foreground">
                  {props.length > 0 ? props.join(", ") : "No default properties"} · {s?.units ?? am.unitsOwned} units
                </div>
                <FlowStrip
                  steps={[
                    { value: s?.toReview ?? "—", label: "To review" },
                    { value: s?.toursThisWeek ?? "—", label: "Tours this week" },
                  ]}
                />
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
                  <span className="text-[13px]">Sarah books tours for {first}</span>
                  <Toggle
                    label={`Sarah books tours for ${am.name}`}
                    checked={am.takingTours}
                    onChange={(next) => void toggleTours(am.userId, am.name, next)}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHead
          title="Property assignments"
          icon={<Building2 />}
          hint="Changing a default reroutes new requests right away. Open requests stay with whoever has them. To give one unit a different asset manager, use Property."
        />
        <DataTable
          caption="Property assignments"
          columns={columns}
          rows={rows}
          rowKey={(p) => p._id}
          empty={properties ? "No properties yet." : "Loading…"}
        />
      </Card>

      <Grid2>
        <Card>
          <CardHead
            title="Escalation rules"
            icon={<AlertTriangle />}
            hint="From Sarah’s severity levels and escalation contacts."
            right={
              <Link href="/sarah" className="font-medium text-primary hover:underline">
                Edit in Sarah config →
              </Link>
            }
          />
          {escalation && !escalation.published ? (
            <p className="mb-3 rounded-xl border border-dashed border-border-strong px-3 py-2 text-xs text-muted-foreground">
              Draft — not published. These rules are not live until the Sarah config is published.
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

      {pending ? (
        <Modal title={`Route ${pending.property.name} to ${pending.name}?`} onClose={() => (saving ? undefined : setPending(null))}>
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Every unit has one asset manager. Choose which units this change applies to. Open requests stay with whoever
              has them.
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
