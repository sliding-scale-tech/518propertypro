"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useToast } from "@/components/toast";
import { Btn, Listbox, Pill, cx } from "@/components/ui";
import { serverError } from "@/lib/form-errors";

/**
 * Team → Lead routing → Tour staff (B40; moved from Settings in B41): who gives tours for each property team's buildings. Once a caller has
 * chosen a building, Sarah offers times only from that team's list; nobody bookable there means she
 * takes the caller's preferred time instead. No saved list = the team's asset managers (the default).
 * The server (convex/tourStaff.ts) is the authority; this validates first so the message is specific.
 */

type Data = NonNullable<FunctionReturnType<typeof api.tourStaff.listForSettings>>;
type Team = Data["teams"][number];
type Person = Team["people"][number];

export function TourStaffSection() {
  const data = useQuery(api.tourStaff.listForSettings);
  if (data === undefined) return <p className="text-sm text-muted-foreground">Loading tour staff…</p>;
  if (data === null) return null; // not an admin: show nothing
  return (
    <div className="space-y-3">
      {data.teams.map((team) => (
        <TeamCard key={team.category} team={team} members={data.members} />
      ))}
    </div>
  );
}

const CALENDAR: Record<Person["calendar"], { label: string; tone: "ok" | "warn" | "bad" }> = {
  connected: { label: "Calendar connected", tone: "ok" },
  needs_reconnect: { label: "Calendar needs reconnecting", tone: "warn" },
  not_connected: { label: "No calendar", tone: "bad" },
};

function TeamCard({ team, members }: { team: Team; members: Data["members"] }) {
  const toast = useToast();
  const addPerson = useMutation(api.tourStaff.addPerson);
  const removePerson = useMutation(api.tourStaff.removePerson);
  const resetToDefault = useMutation(api.tourStaff.resetToDefault);
  const [choice, setChoice] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onList = new Set<string>(team.people.map((p) => p.userId));
  const options = members
    .filter((m) => !onList.has(m.userId))
    .map((m) => ({ value: m.userId, label: m.name, sublabel: m.email ?? undefined }));
  const selectId = `tour-staff-add-${team.category}`;
  const errorId = `${selectId}-error`;

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast(done);
      return true;
    } catch (err) {
      const { message, field } = serverError(err);
      if (field === "person") setFieldError(message);
      toast(message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    // null, "" and an id no longer offered all mean nothing usable was chosen.
    const picked = choice && options.some((o) => o.value === choice) ? choice : null;
    if (!picked) {
      const message = `Choose a person to add to the ${team.label} tour list.`;
      setFieldError(message);
      toast(message, "error");
      return;
    }
    const name = options.find((o) => o.value === picked)?.label ?? "That person";
    const ok = await run(
      () => addPerson({ category: team.category, userId: picked }),
      `${name} added to the ${team.label} tour list`,
    );
    if (ok) {
      setChoice(null);
      setFieldError(null);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">{team.label}</h3>
          <span className="text-xs text-muted-foreground">
            {team.buildings} {team.buildings === 1 ? "building" : "buildings"}
          </span>
          {team.isDefault ? (
            <Pill tone="acc" title="No list saved: the asset managers of this team's units">
              Default: the team&apos;s asset managers
            </Pill>
          ) : (
            <Pill tone="neutral">Custom list</Pill>
          )}
        </div>
        {!team.isDefault ? (
          <Btn
            sm
            disabled={busy}
            onClick={() => void run(() => resetToDefault({ category: team.category }), `${team.label} is back to the default list`)}
          >
            Reset to default
          </Btn>
        ) : null}
      </div>

      {team.warning ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {team.warning}
        </p>
      ) : null}

      {team.people.length > 0 ? (
        <ul className="mt-3 divide-y divide-border">
          {team.people.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{p.name}</div>
                {p.email ? <div className="truncate text-xs text-muted-foreground">{p.email}</div> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={CALENDAR[p.calendar].tone} dot>
                  {CALENDAR[p.calendar].label}
                </Pill>
                {!p.takingTours ? <Pill tone="warn">Not taking tours</Pill> : null}
                {p.outOfOffice ? <Pill tone="warn">Out of office</Pill> : null}
                <Btn
                  sm
                  variant="dng"
                  disabled={busy}
                  aria-label={`Remove ${p.name} from the ${team.label} tour list`}
                  onClick={() =>
                    void run(
                      () => removePerson({ category: team.category, userId: p.userId }),
                      `${p.name} removed from the ${team.label} tour list`,
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        noValidate
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void add();
        }}
      >
        <div className="flex-1">
          <label htmlFor={selectId} className="sr-only">
            Add a person to the {team.label} tour list
          </label>
          <Listbox
            id={selectId}
            value={choice ?? ""}
            options={options}
            placeholder={options.length ? "Choose a person" : "Everyone is already on this list"}
            disabled={busy || options.length === 0}
            onValueChange={(v) => {
              setChoice(v || null);
              if (fieldError) setFieldError(null);
            }}
            aria-invalid={!!fieldError}
            aria-describedby={fieldError ? errorId : undefined}
            className={cx(fieldError && "!border-danger-ink")}
          />
          {fieldError ? (
            <p id={errorId} role="alert" className="mt-1 text-xs text-danger-ink">
              {fieldError}
            </p>
          ) : null}
        </div>
        <Btn type="submit" variant="pri" disabled={busy || options.length === 0}>
          Add person
        </Btn>
      </form>
    </div>
  );
}
