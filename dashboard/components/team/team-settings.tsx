"use client";

import { useMutation, useQuery } from "convex/react";
import { Globe, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, useToast } from "@/components/toast";
import { Btn, Card, Field, Input, Select, cx } from "@/components/ui";

/**
 * The Settings tab: team name and team time zone in one card, each with its own Save.
 * Non-admins see both read-only. The server (team.rename, tours.setTimeZone) is the authority.
 */
export function TeamSettings({ orgName, isAdmin }: { orgName: string; isAdmin: boolean }) {
  // Same underlying query the Calendar page uses for tour settings; timeZone is the one field needed.
  const availability = useQuery(api.tours.availabilitySettings);
  return (
    <Card className="divide-y divide-border !p-0">
      <div className="px-[22px] py-5">
        <TeamNameSection orgName={orgName} isAdmin={isAdmin} />
      </div>
      <div className="px-[22px] py-5">
        <TimeZoneSection isAdmin={isAdmin} timeZone={availability?.timeZone ?? null} loading={availability === undefined} />
      </div>
    </Card>
  );
}

function SectionHead({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="mb-3">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
      </h3>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function TeamNameSection({ orgName, isAdmin }: { orgName: string; isAdmin: boolean }) {
  const rename = useMutation(api.team.rename);
  const toast = useToast();
  // Starts null and only takes the stored value until the admin edits it, so a live update from
  // someone else cannot yank the text out from under them mid-type.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? orgName;

  const save = async () => {
    const name = value.trim();
    const problem = name === "" ? "Give the team a name." : name.length > 60 ? "Team name is too long (max 60 characters)." : null;
    setError(problem);
    if (problem) {
      toast(problem, "error");
      return;
    }
    setBusy(true);
    try {
      await rename({ name });
      setDraft(null);
      toast("Team renamed");
    } catch (err) {
      toast(errorMessage(err, "Could not rename the team."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (isAdmin && !busy) void save();
      }}
    >
      <SectionHead icon={<Users />} title="Team name" hint="Shown across the dashboard." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field label="Team name" className="flex-1">
          <Input
            value={value}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            disabled={!isAdmin}
            aria-label="Team name"
            aria-invalid={!!error}
            className={cx(error && "!border-danger-ink")}
          />
          {error ? <p className="text-xs text-danger-ink">{error}</p> : null}
        </Field>
        {isAdmin ? (
          <div className="flex flex-col gap-[5px]">
            <span aria-hidden className="hidden text-[12.5px] sm:block">&nbsp;</span>
            <Btn type="submit" variant="pri" disabled={busy || draft === null || draft.trim() === orgName}>
              Save name
            </Btn>
          </div>
        ) : null}
      </div>
      {!isAdmin ? <p className="mt-2 text-xs text-muted-foreground">Only an Admin can rename the team.</p> : null}
    </form>
  );
}

/**
 * Where the property is. Every member's tour hours, every day off, and every booked tour are
 * interpreted in this one zone. Sarah refuses to book anything at all until it is set (see
 * convex/tours.ts's loadContext), so setting it is the first real step in turning tour booking on.
 */
function TimeZoneSection({
  isAdmin,
  timeZone,
  loading,
}: {
  isAdmin: boolean;
  timeZone: string | null;
  loading: boolean;
}) {
  const setTimeZone = useMutation(api.tours.setTimeZone);
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  // Suggest the admin's own zone the first time, but never save it without them pressing Save.
  const value = draft ?? timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const save = async () => {
    setBusy(true);
    try {
      await setTimeZone({ timeZone: value });
      setDraft(null);
      toast("Team time zone saved");
    } catch (err) {
      toast(errorMessage(err, "Could not save the time zone."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHead
        icon={<Globe />}
        title="Team time zone"
        hint={`Where the property is. Everyone's tour hours and every booked tour use this zone.${
          isAdmin ? "" : " Only an Admin can change it."
        }`}
      />

      {!loading && !timeZone ? (
        <p className="mb-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          Not set yet, so Sarah cannot book tours. She takes down a preferred time for the team to confirm instead.
          {isAdmin ? "" : " Ask an Admin to set it."}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isAdmin ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Select value={value} onChange={(e) => setDraft(e.target.value)} aria-label="Team time zone" className="flex-1">
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <Btn variant="pri" onClick={() => void save()} disabled={busy || value === timeZone}>
            Save time zone
          </Btn>
        </div>
      ) : timeZone ? (
        <p className="text-sm">{timeZone.replace(/_/g, " ")}</p>
      ) : null}
    </div>
  );
}
