"use client";

import { useQuery } from "convex/react";
import { Building2, CalendarDays, Camera, Users } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { BulkTeam } from "@/convex/bulkReassignLib";
import { Avatar, Btn, Card, Pill } from "@/components/ui";
import { BulkChangeDialog, type BulkScope } from "./bulk-change-dialog";

const BUILDINGS_SHOWN = 6;

/**
 * Teams view: one card each for Gold, Silver and Make Up with its buildings and units, who manages
 * them now (with each person's photo email) and the team's tour staff, all read-only here, plus
 * "Change asset manager" for the whole team. Photo emails are edited on each manager's profile,
 * tour staff on Team > Lead routing.
 */
export function TeamsTab() {
  const data = useQuery(api.bulkReassign.teamsOverview);
  const tourStaff = useQuery(api.tourStaff.listForSettings);
  const [open, setOpen] = useState<BulkScope | null>(null);

  if (data === undefined) {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3.5">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <div className="h-24 animate-pulse rounded bg-muted" />
          </Card>
        ))}
      </div>
    );
  }
  if (data === null) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3.5">
        {data.teams.map((t) => {
          const staff = tourStaff?.teams.find((s) => s.category === t.team);
          return (
            <TeamCard
              key={t.team}
              team={t}
              staff={staff ? { names: staff.people.map((p) => p.name), isDefault: staff.isDefault, warning: staff.warning } : undefined}
              canChange={data.assetManagers.length > 0 && t.unitCount > 0}
              onChange={() =>
                setOpen({
                  kind: "team",
                  team: t.team,
                  label: t.label,
                  holders: t.managers.map((m) => ({ userId: m.userId, name: m.name, units: m.units })),
                })
              }
            />
          );
        })}
      </div>
      {data.noTeamBuildings > 0 ? (
        <p className="text-xs text-muted-foreground">
          {data.noTeamBuildings} building{data.noTeamBuildings === 1 ? " is" : "s are"} not on a team. Change those from the
          property page.
        </p>
      ) : null}
      {open ? <BulkChangeDialog scope={open} managers={data.assetManagers} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

type TeamRow = {
  team: BulkTeam;
  label: string;
  buildingCount: number;
  unitCount: number;
  buildings: Array<{ propertyId: string; name: string; unitCount: number }>;
  managers: Array<{ userId: string; name: string; units: number; photoEmail: string | null }>;
};

function TeamCard({
  team,
  staff,
  canChange,
  onChange,
}: {
  team: TeamRow;
  staff?: { names: string[]; isDefault: boolean; warning: string | null };
  canChange: boolean;
  onChange: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? team.buildings : team.buildings.slice(0, BUILDINGS_SHOWN);

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold">{team.label}</div>
          <div className="text-xs text-muted-foreground">
            {team.buildingCount} building{team.buildingCount === 1 ? "" : "s"} · {team.unitCount} unit{team.unitCount === 1 ? "" : "s"}
          </div>
        </div>
        <Btn sm onClick={onChange} disabled={!canChange} title={canChange ? undefined : "No units to move on this team"}>
          Change asset manager
        </Btn>
      </div>

      <Section icon={<Users />} title="Asset managers">
        {team.managers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No units yet.</p>
        ) : (
          <ul className="space-y-2">
            {team.managers.map((m) => (
              <li key={m.userId} className="flex items-center gap-2.5">
                <Avatar name={m.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/asset-managers/${m.userId}`} className="truncate text-[13.5px] font-medium hover:underline">
                      {m.name}
                    </Link>
                    <Pill>
                      {m.units} unit{m.units === 1 ? "" : "s"}
                    </Pill>
                  </div>
                  <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Camera aria-hidden className="h-3 w-3 shrink-0" />
                    {m.photoEmail ?? <span className="text-faint">No photo email</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {team.managers.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Photo emails are edited on each manager&apos;s profile.</p>
        ) : null}
      </Section>

      <Section
        icon={<CalendarDays />}
        title="Tour staff"
        right={
          <Link href="/team?tab=routing" className="text-xs font-medium text-primary hover:underline">
            Edit →
          </Link>
        }
      >
        {!staff ? (
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        ) : staff.names.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No one on the tour list.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {staff.names.map((n) => (
              <Pill key={n}>{n}</Pill>
            ))}
            {staff.isDefault ? <span className="text-xs text-muted-foreground">(default: the team&apos;s asset managers)</span> : null}
          </div>
        )}
        {staff?.warning ? <p className="mt-1.5 text-xs text-warning-ink">{staff.warning}</p> : null}
      </Section>

      <Section icon={<Building2 />} title="Buildings">
        {team.buildings.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No buildings on this team.</p>
        ) : (
          <ul className="space-y-1">
            {shown.map((b) => (
              <li key={b.propertyId} className="flex items-center justify-between gap-2 text-[13px]">
                <Link href={`/properties?property=${encodeURIComponent(b.propertyId)}`} className="truncate text-primary hover:underline">
                  {b.name}
                </Link>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {b.unitCount} unit{b.unitCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {team.buildings.length > BUILDINGS_SHOWN ? (
          <button type="button" onClick={() => setAll((v) => !v)} className="mt-1.5 text-xs font-medium text-primary hover:underline">
            {all ? "Show fewer" : `Show all ${team.buildings.length}`}
          </button>
        ) : null}
      </Section>
    </Card>
  );
}

function Section({ icon, title, right, children }: { icon: ReactNode; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
          {icon}
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}
