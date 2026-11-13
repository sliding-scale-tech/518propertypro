"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Moon } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AppRole } from "@/convex/jobRoles";
import { checkRoles } from "@/convex/roleSet";
import { errorMessage, useToast } from "@/components/toast";
import { Btn, DatePicker, Field, Input, Pill, Select, cx, type Tone } from "@/components/ui";

type Channel = "sms" | "email" | "push";

export const APP_ROLE_OPTIONS: ReadonlyArray<{ value: AppRole; label: string; tone: Tone; blurb: string }> = [
  { value: "admin", label: "Admin", tone: "warn", blurb: "Full access. Pat and Alex." },
  { value: "asset_manager", label: "Asset manager", tone: "acc", blurb: "Reviews requests for their units" },
  { value: "technician", label: "Technician", tone: "ok", blurb: "Works assigned jobs on their phone" },
  { value: "accountant", label: "Accountant", tone: "vio", blurb: "Owner statements and finished work orders" },
];

/** Role pill: Admin = warn, Asset manager = acc, Technician = ok, Accountant = vio; null (no role yet) shows as a warning. */
export function AppRoleBadge({ appRole }: { appRole: AppRole | null }) {
  const opt = APP_ROLE_OPTIONS.find((o) => o.value === appRole);
  if (!opt) {
    return (
      <Pill tone="warn">
        <AlertTriangle className="h-3 w-3" />
        No role yet
      </Pill>
    );
  }
  return <Pill tone={opt.tone}>{opt.label}</Pill>;
}

/** One pill per role held (B31 multi-role); "No role yet" when there are none. */
export function AppRolesBadges({ appRoles }: { appRoles: ReadonlyArray<AppRole> }) {
  if (appRoles.length === 0) return <AppRoleBadge appRole={null} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {APP_ROLE_OPTIONS.filter((o) => appRoles.includes(o.value)).map((o) => (
        <Pill key={o.value} tone={o.tone}>
          {o.label}
        </Pill>
      ))}
    </span>
  );
}

/** "Asset manager, Accountant": the labels of every role held, in role order. */
export function appRolesLabel(appRoles: ReadonlyArray<AppRole>): string {
  const labels = APP_ROLE_OPTIONS.filter((o) => appRoles.includes(o.value)).map((o) => o.label);
  return labels.length > 0 ? labels.join(", ") : "No role yet";
}

/**
 * Role picker (B31): checkbox chips, Admin OR any mix of Asset manager / Technician / Accountant.
 * Admin is exclusive, which checkRoles enforces on save (the same rule and wording as the server);
 * `error` marks the group red with the message under it.
 */
export function RoleChips({
  value,
  onChange,
  disabled,
  label,
  error,
}: {
  value: ReadonlyArray<AppRole>;
  onChange: (next: AppRole[]) => void;
  disabled?: boolean;
  label: string;
  error?: string | null;
}) {
  const errorId = useId();
  const toggle = (role: AppRole) => {
    const next = value.includes(role) ? value.filter((r) => r !== role) : [...value, role];
    onChange(APP_ROLE_OPTIONS.map((o) => o.value).filter((r) => next.includes(r)));
  };
  return (
    <div className="flex flex-col gap-1">
      <div
        role="group"
        aria-label={label}
        aria-describedby={error ? errorId : undefined}
        className={cx(
          "flex flex-wrap gap-2 rounded-xl border p-1.5",
          error ? "border-danger-ink" : "border-transparent",
        )}
      >
        {APP_ROLE_OPTIONS.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled}
              title={o.blurb}
              onClick={() => toggle(o.value)}
              className={cx(
                "rounded-full border px-3 py-1 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {on ? "✓ " : ""}
              {o.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The role-selection rules, client side (same as the server's parseAppRoles). null = valid. */
export function roleSelectionError(roles: ReadonlyArray<AppRole>): string | null {
  const checked = checkRoles([...roles]);
  return checked.ok ? null : checked.error;
}

const CHANNELS: ReadonlyArray<{ value: Channel; label: string }> = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "push", label: "Push" },
];

// Hint only: convex/team.ts assertE164 is the authority.
export const E164 = /^\+[1-9]\d{7,14}$/;

type Member = NonNullable<FunctionReturnType<typeof api.team.overview>>["members"][number];


/** Day picker value (yyyy-mm-dd, local) <-> end of that local day. */
function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function endOfDay(value: string): number | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59).getTime();
}

/** One titled block of the member panel, separated from the one above by a hairline. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h4 className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

/**
 * One person's editable details, in sections with one Save each: Roles (admins), Contact (phone and
 * skill), Notifications, Out of office. Every action is still enforced on the server. `showSummary`
 * draws the role pills row (the Team drawer draws its own header, the profile page uses this one).
 */
export function MemberDetails({
  member,
  isAdmin,
  canSetUnavailable,
  showSummary = true,
}: {
  member: Member;
  isAdmin: boolean;
  canSetUnavailable: boolean;
  showSummary?: boolean;
}) {
  const setRoles = useMutation(api.team.setRoles);
  const setContact = useMutation(api.team.setContact);
  const setUnavailable = useMutation(api.team.setUnavailable);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Drafts are null until edited, so a live update never overwrites what someone is typing.
  const [roleDraft, setRoleDraft] = useState<AppRole[] | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [notifyDraft, setNotifyDraft] = useState<Channel[] | null>(null);
  const [dateDraft, setDateDraft] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [coverDraft, setCoverDraft] = useState<string | null>(null);

  const canEditContact = isAdmin || member.isSelf;
  const phoneValue = phoneDraft ?? member.phone ?? "";
  const skillValue = skillDraft ?? member.skill ?? "";
  const phoneChanged = phoneDraft !== null && phoneDraft.trim() !== (member.phone ?? "");
  const skillChanged = skillDraft !== null && skillDraft.trim() !== (member.skill ?? "");
  // Captured at mount (lazy initializer) to keep render pure; good enough for a badge.
  const [now] = useState(() => Date.now());
  const outOfOffice = member.unavailableUntil !== null && member.unavailableUntil > now;
  const isAm = member.appRoles.includes("asset_manager");
  // Other asset managers who could cover. Only fetched for an AM member.
  const team = useQuery(api.team.overview, isAm && canSetUnavailable ? {} : "skip");
  const coverOptions = (team?.members ?? []).filter(
    (m) => m.appRoles.includes("asset_manager") && m.userId !== member.userId,
  );
  const sameSet = <T,>(a: ReadonlyArray<T>, b: ReadonlyArray<T>) =>
    a.length === b.length && a.every((r) => b.includes(r));
  const coverValue = coverDraft ?? member.coveringUserId ?? "";
  const currentCover = coverOptions.find((m) => m.userId === member.coveringUserId);

  const roles = roleDraft ?? [...member.appRoles];
  const notify = notifyDraft ?? member.notifyBy;

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      return true;
    } catch (err) {
      toast(errorMessage(err, "That didn't work."), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveRoles = async () => {
    // Client check first (same rules and wording as team.setRoles), then the server re-checks.
    const problem = roleSelectionError(roles);
    if (problem) {
      setRoleError(problem);
      toast(problem, "error");
      return;
    }
    setRoleError(null);
    const ok = await run(() => setRoles({ membershipId: member.membershipId, roles }), "Roles updated");
    if (ok) setRoleDraft(null);
  };

  const saveContact = async () => {
    if (phoneChanged && phoneValue.trim() !== "" && !E164.test(phoneValue.trim())) {
      const problem = "Use international format, like +15185550123.";
      setPhoneError(problem);
      toast(problem, "error");
      return;
    }
    setPhoneError(null);
    const ok = await run(
      () =>
        setContact({
          userId: member.userId,
          ...(phoneChanged ? { phone: phoneValue.trim() } : {}),
          ...(skillChanged ? { skill: skillValue.trim() } : {}),
        }),
      phoneChanged && !skillChanged && phoneValue.trim() === "" ? "Phone cleared" : "Contact saved",
    );
    if (ok) {
      setPhoneDraft(null);
      setSkillDraft(null);
    }
  };

  const saveNotifications = async () => {
    const ok = await run(() => setContact({ userId: member.userId, notifyBy: notify }), "Notifications updated");
    if (ok) setNotifyDraft(null);
  };

  const setOutOfOffice = async () => {
    const until = dateDraft ? endOfDay(dateDraft) : null;
    if (until === null) {
      const problem = "Pick the last day they are out of office.";
      setDateError(problem);
      toast(problem, "error");
      return;
    }
    setDateError(null);
    const ok = await run(
      () =>
        setUnavailable({
          userId: member.userId,
          until,
          coveringUserId: isAm && coverValue ? (coverValue as Id<"users">) : undefined,
        }),
      "Out of office set",
    );
    if (ok) {
      setDateDraft("");
      setCoverDraft(null);
    }
  };

  return (
    <div className="w-full space-y-5 text-sm">
      {showSummary ? (
        <div className="flex flex-wrap items-center gap-2">
          <AppRolesBadges appRoles={member.appRoles} />
          {outOfOffice ? (
            <Pill>
              <Moon className="h-3 w-3" />
              Out of office until {new Date(member.unavailableUntil!).toLocaleDateString()}
            </Pill>
          ) : null}
          {isAm && (isAdmin || member.isSelf) ? (
            <Link href="/properties" className="text-xs text-muted-foreground hover:underline">
              Owns {member.unitsOwned} unit{member.unitsOwned === 1 ? "" : "s"}
            </Link>
          ) : null}
        </div>
      ) : null}

      {isAdmin ? (
        <Section title="Roles">
          <RoleChips
            value={roles}
            onChange={(next) => {
              setRoleDraft(next);
              if (roleError) setRoleError(roleSelectionError(next));
            }}
            disabled={busy}
            label={`Roles for ${member.name}`}
            error={roleError}
          />
          <p className="text-xs text-muted-foreground">
            Admin on its own, or any mix of Asset manager, Technician and Accountant.
          </p>
          <Btn
            sm
            variant="pri"
            disabled={busy || roleDraft === null || sameSet(roles, member.appRoles)}
            onClick={() => void saveRoles()}
          >
            Save roles
          </Btn>
        </Section>
      ) : null}

      {/* Phone is null for viewers who may not see it; only render the section when they can edit
          it or there is something to show. */}
      {canEditContact || member.phone ? (
        <Section title="Contact">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone">
              {canEditContact ? (
                <>
                  <Input
                    value={phoneValue}
                    onChange={(e) => {
                      setPhoneDraft(e.target.value);
                      if (phoneError) setPhoneError(null);
                    }}
                    placeholder="+15185550123"
                    inputMode="tel"
                    aria-label={`Phone for ${member.name}`}
                    aria-invalid={!!phoneError}
                    className={cx(phoneError && "!border-danger-ink")}
                  />
                  {phoneError ? <p className="text-xs text-danger-ink">{phoneError}</p> : null}
                </>
              ) : (
                <span className="py-2">{member.phone}</span>
              )}
            </Field>
            {canEditContact ? (
              <Field label="Skill">
                <Input
                  value={skillValue}
                  maxLength={80}
                  onChange={(e) => setSkillDraft(e.target.value)}
                  placeholder="e.g. Plumbing, Appliances"
                  aria-label={`Skill for ${member.name}`}
                />
              </Field>
            ) : null}
          </div>
          {canEditContact && member.appRoles.includes("technician") && !member.phone ? (
            <p className="flex items-center gap-1.5 text-xs text-warning-ink">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Add a phone number so they can get job texts later.
            </p>
          ) : null}
          {canEditContact ? (
            <Btn sm variant="pri" disabled={busy || (!phoneChanged && !skillChanged)} onClick={() => void saveContact()}>
              Save contact
            </Btn>
          ) : null}
        </Section>
      ) : null}

      <Section title="Notifications">
        <div role="group" aria-label={`Notify ${member.name} by`} className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {CHANNELS.map((c) => (
            <label
              key={c.value}
              className={`flex items-center gap-1.5 text-sm ${canEditContact ? "cursor-pointer" : "cursor-not-allowed"}`}
            >
              <input
                type="checkbox"
                disabled={busy || !canEditContact}
                checked={notify.includes(c.value)}
                onChange={(e) =>
                  setNotifyDraft(e.target.checked ? [...notify, c.value] : notify.filter((x) => x !== c.value))
                }
              />
              {c.label}
            </label>
          ))}
        </div>
        {canEditContact ? (
          <Btn
            sm
            variant="pri"
            disabled={busy || notifyDraft === null || sameSet(notify, member.notifyBy)}
            onClick={() => void saveNotifications()}
          >
            Save notifications
          </Btn>
        ) : (
          <p className="text-xs text-muted-foreground">Only an Admin or this person can change these.</p>
        )}
      </Section>

      {canSetUnavailable ? (
        <Section title="Out of office">
          {outOfOffice ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Moon className="h-3.5 w-3.5" />
              Out until {new Date(member.unavailableUntil!).toLocaleDateString()}
              {currentCover ? `, covered by ${currentCover.name}` : ""}.
            </p>
          ) : null}
          <div className={cx("grid gap-3", isAm && "sm:grid-cols-2")}>
            <Field label="Out until">
              <DatePicker
                value={dateDraft}
                min={toDateInput(now + 24 * 60 * 60 * 1000)}
                onChange={(next) => {
                  setDateDraft(next);
                  if (dateError) setDateError(null);
                }}
                aria-label={`Out of office until, ${member.name}`}
                className={cx(dateError && "!border-danger-ink")}
              />
              {dateError ? <p className="text-xs text-danger-ink">{dateError}</p> : null}
            </Field>
            {isAm ? (
              <Field label="Covered by" hint="Gets read-only cover while they are out.">
                <Select
                  value={coverValue}
                  onChange={(e) => setCoverDraft(e.target.value)}
                  aria-label={`Who covers while ${member.name} is out`}
                  disabled={busy}
                >
                  <option value="">No one</option>
                  {coverOptions.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn sm variant="pri" disabled={busy} onClick={() => void setOutOfOffice()}>
              Set out of office
            </Btn>
            {member.unavailableUntil !== null ? (
              <Btn sm disabled={busy} onClick={() => void run(() => setUnavailable({ userId: member.userId }), "Back in office")}>
                Clear
              </Btn>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
