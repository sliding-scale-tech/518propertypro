"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Moon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AppRole } from "@/convex/jobRoles";
import { errorMessage, useToast } from "@/components/toast";
import { Btn, DatePicker, Input, Pill, Seg, Select, type Tone } from "@/components/ui";

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

const CHANNELS: ReadonlyArray<{ value: Channel; label: string }> = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "push", label: "Push" },
];

// Hint only: convex/team.ts assertE164 is the authority.
export const E164 = /^\+[1-9]\d{7,14}$/;

type Member = NonNullable<FunctionReturnType<typeof api.team.overview>>["members"][number];


/** Single-select segmented control: one role per person. */
function AppRoleSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: AppRole | null;
  onChange: (next: AppRole) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <fieldset disabled={disabled} className="border-0 p-0">
      <Seg
        label={label}
        value={(value ?? "") as AppRole}
        options={APP_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        onChange={onChange}
      />
    </fieldset>
  );
}

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

export function MemberDetails({
  member,
  isAdmin,
  canSetUnavailable,
}: {
  member: Member;
  isAdmin: boolean;
  canSetUnavailable: boolean;
}) {
  const setAppRole = useMutation(api.team.setAppRole);
  const setContact = useMutation(api.team.setContact);
  const setUnavailable = useMutation(api.team.setUnavailable);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [editingRoles, setEditingRoles] = useState(false);
  const [roleDraft, setRoleDraft] = useState<AppRole | null>(null);
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState("");
  const [coverDraft, setCoverDraft] = useState<string | null>(null);

  const canEditContact = isAdmin || member.isSelf;
  const phoneValue = phoneDraft ?? member.phone ?? "";
  const skillValue = skillDraft ?? member.skill ?? "";
  const phoneBad = phoneValue.trim() !== "" && !E164.test(phoneValue.trim());
  // Captured at mount (lazy initializer) to keep render pure; good enough for a badge.
  const [now] = useState(() => Date.now());
  const outOfOffice = member.unavailableUntil !== null && member.unavailableUntil > now;
  const isAm = member.appRole === "asset_manager";
  // Other asset managers who could cover. Only fetched for an AM member.
  const team = useQuery(api.team.overview, isAm && canSetUnavailable ? {} : "skip");
  const coverOptions = (team?.members ?? []).filter(
    (m) => m.appRole === "asset_manager" && m.userId !== member.userId,
  );
  const coverValue = coverDraft ?? member.coveringUserId ?? "";
  const currentCover = coverOptions.find((m) => m.userId === member.coveringUserId);

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

  return (
    <div className="w-full space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <AppRoleBadge appRole={member.appRole} />
        {outOfOffice ? (
          <Pill>
            <Moon className="h-3 w-3" />
            Out of office until {new Date(member.unavailableUntil!).toLocaleDateString()}
          </Pill>
        ) : null}
        {isAdmin && !editingRoles ? (
          <button
            type="button"
            className="text-[12.5px] font-medium text-primary hover:underline"
            onClick={() => {
              setRoleDraft(member.appRole);
              setEditingRoles(true);
            }}
          >
            Change role
          </button>
        ) : null}
        {isAm && (isAdmin || member.isSelf) ? (
          <Link href="/properties" className="text-xs text-muted-foreground hover:underline">
            Owns {member.unitsOwned} unit{member.unitsOwned === 1 ? "" : "s"}
          </Link>
        ) : null}
      </div>

      {isAdmin && editingRoles ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs font-medium text-muted-foreground">Role</span>
          <AppRoleSelect
            value={roleDraft}
            onChange={setRoleDraft}
            disabled={busy}
            label={`Role for ${member.name}`}
          />
          <div className="flex gap-2">
            <Btn
              sm
              variant="pri"
              disabled={busy || roleDraft === null || roleDraft === member.appRole}
              onClick={() =>
                roleDraft !== null &&
                void run(
                  () => setAppRole({ userId: member.userId, appRole: roleDraft }),
                  "Role updated",
                ).then((ok) => ok && setEditingRoles(false))
              }
            >
              Save
            </Btn>
            <Btn sm disabled={busy} onClick={() => setEditingRoles(false)}>
              Cancel
            </Btn>
          </div>
        </div>
      ) : null}

      {/* Phone is null for viewers who may not see it; only render the field when they can edit
          it or there is a number to show. */}
      {canEditContact || member.phone ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs font-medium text-muted-foreground">Phone</span>
          {canEditContact ? (
            <>
              <Input
                value={phoneValue}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder="+15185550123"
                inputMode="tel"
                aria-label={`Phone for ${member.name}`}
                aria-invalid={phoneBad}
                className="h-9 w-48 py-1"
              />
              <Btn
                sm
                disabled={busy || phoneBad || phoneDraft === null || phoneDraft.trim() === (member.phone ?? "")}
                onClick={() =>
                  void run(
                    () => setContact({ userId: member.userId, phone: phoneValue.trim() }),
                    phoneValue.trim() ? "Phone saved" : "Phone cleared",
                  ).then((ok) => ok && setPhoneDraft(null))
                }
              >
                Save
              </Btn>
              {phoneBad ? (
                <span className="text-xs text-warning-ink">Use international format, like +15185550123.</span>
              ) : null}
            </>
          ) : (
            <span>{member.phone}</span>
          )}
        </div>
      ) : null}

      {canEditContact ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs font-medium text-muted-foreground">Skill</span>
          <Input
            value={skillValue}
            maxLength={80}
            onChange={(e) => setSkillDraft(e.target.value)}
            placeholder="e.g. Plumbing, Appliances"
            aria-label={`Skill for ${member.name}`}
            className="h-9 w-48 py-1"
          />
          <Btn
            sm
            disabled={busy || skillDraft === null || skillDraft.trim() === (member.skill ?? "")}
            onClick={() =>
              void run(
                () => setContact({ userId: member.userId, skill: skillValue.trim() }),
                skillValue.trim() ? "Skill saved" : "Skill cleared",
              ).then((ok) => ok && setSkillDraft(null))
            }
          >
            Save
          </Btn>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-xs font-medium text-muted-foreground">Notify by</span>
        {CHANNELS.map((c) => (
          <label
            key={c.value}
            className={`flex items-center gap-1.5 text-sm ${canEditContact ? "cursor-pointer" : "cursor-not-allowed"}`}
          >
            <input
              type="checkbox"
              disabled={busy || !canEditContact}
              checked={member.notifyBy.includes(c.value)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...member.notifyBy, c.value]
                  : member.notifyBy.filter((x) => x !== c.value);
                void run(() => setContact({ userId: member.userId, notifyBy: next }), "Notifications updated");
              }}
            />
            {c.label}
          </label>
        ))}
      </div>

      {canSetUnavailable ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs font-medium text-muted-foreground">Out of office</span>
          <div className="w-44">
            <DatePicker
              value={dateDraft}
              min={toDateInput(now + 24 * 60 * 60 * 1000)}
              onChange={setDateDraft}
              aria-label={`Out of office until, ${member.name}`}
              className="h-9 py-1"
            />
          </div>
          <Btn
            sm
            disabled={busy || !dateDraft}
            onClick={() => {
              const until = endOfDay(dateDraft);
              if (until === null) return;
              void run(
                () =>
                  setUnavailable({
                    userId: member.userId,
                    until,
                    coveringUserId: isAm && coverValue ? (coverValue as Id<"users">) : undefined,
                  }),
                "Out of office set",
              ).then((ok) => {
                if (ok) {
                  setDateDraft("");
                  setCoverDraft(null);
                }
              });
            }}
          >
            Set
          </Btn>
          {member.unavailableUntil !== null ? (
            <Btn sm disabled={busy} onClick={() => void run(() => setUnavailable({ userId: member.userId }), "Back in office")}>
              Clear
            </Btn>
          ) : null}
        </div>
      ) : null}

      {canSetUnavailable && isAm ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs font-medium text-muted-foreground">Covered by</span>
          <Select
            value={coverValue}
            onChange={(e) => setCoverDraft(e.target.value)}
            aria-label={`Who covers while ${member.name} is out`}
            className="h-9 w-auto py-1"
            disabled={busy}
          >
            <option value="">Who covers while you&rsquo;re out</option>
            {coverOptions.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            {currentCover && outOfOffice
              ? `${currentCover.name} has read-only cover now.`
              : "Applied when you set an out-of-office date."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
