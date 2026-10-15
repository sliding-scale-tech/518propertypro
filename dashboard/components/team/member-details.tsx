"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Moon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { AppRole } from "@/convex/jobRoles";
import { useToast } from "@/components/toast";

type Channel = "sms" | "email" | "push";

export const APP_ROLE_OPTIONS: ReadonlyArray<{ value: AppRole; label: string; badge: string }> = [
  { value: "admin", label: "Admin", badge: "bg-blue-50 text-blue-700" },
  { value: "asset_manager", label: "Asset manager", badge: "bg-violet-50 text-violet-700" },
  { value: "technician", label: "Technician", badge: "bg-amber-50 text-amber-700" },
];

/** The clean role badge; null (no role assigned yet) shows as a subtle warning. */
export function AppRoleBadge({ appRole }: { appRole: AppRole | null }) {
  const opt = APP_ROLE_OPTIONS.find((o) => o.value === appRole);
  if (!opt) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        No role yet
      </span>
    );
  }
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${opt.badge}`}>{opt.label}</span>;
}

const CHANNELS: ReadonlyArray<{ value: Channel; label: string }> = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "push", label: "Push" },
];

// Hint only: convex/team.ts assertE164 is the authority.
export const E164 = /^\+[1-9]\d{7,14}$/;

type Member = NonNullable<FunctionReturnType<typeof api.team.overview>>["members"][number];

const smallInput =
  "h-9 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-60";
const smallBtn =
  "h-9 shrink-0 rounded-lg border border-input px-3 text-xs font-medium hover:bg-accent disabled:opacity-40";

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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-input bg-card p-0.5">
      {APP_ROLE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`h-8 rounded-md px-3 text-xs font-medium disabled:opacity-60 ${
            value === opt.value ? "bg-primary text-primary-foreground" : "hover:bg-accent"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
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
  const [dateDraft, setDateDraft] = useState("");

  const canEditContact = isAdmin || member.isSelf;
  const phoneValue = phoneDraft ?? member.phone ?? "";
  const phoneBad = phoneValue.trim() !== "" && !E164.test(phoneValue.trim());
  // Captured at mount (lazy initializer) to keep render pure; good enough for a badge.
  const [now] = useState(() => Date.now());
  const outOfOffice = member.unavailableUntil !== null && member.unavailableUntil > now;
  const isAm = member.appRole === "asset_manager";

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full space-y-3 border-t border-border pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <AppRoleBadge appRole={member.appRole} />
        {outOfOffice ? (
          <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Moon className="h-3 w-3" />
            Out of office until {new Date(member.unavailableUntil!).toLocaleDateString()}
          </span>
        ) : null}
        {isAdmin && !editingRoles ? (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => {
              setRoleDraft(member.appRole);
              setEditingRoles(true);
            }}
          >
            Change role
          </button>
        ) : null}
        {isAm ? (
          <Link href="/units" className="text-xs text-muted-foreground hover:underline">
            Owns {member.unitsOwned} unit{member.unitsOwned === 1 ? "" : "s"}
          </Link>
        ) : null}
      </div>

      {isAdmin && editingRoles ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs font-medium text-muted-foreground">Role</span>
          <AppRoleSelect
            value={roleDraft}
            onChange={setRoleDraft}
            disabled={busy}
            label={`Role for ${member.name}`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || roleDraft === null || roleDraft === member.appRole}
              className={`${smallBtn} bg-primary text-primary-foreground hover:bg-primary/90`}
              onClick={() =>
                roleDraft !== null &&
                void run(
                  () => setAppRole({ userId: member.userId, appRole: roleDraft }),
                  "Role updated",
                ).then((ok) => ok && setEditingRoles(false))
              }
            >
              Save
            </button>
            <button type="button" disabled={busy} className={smallBtn} onClick={() => setEditingRoles(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Phone is null for viewers who may not see it; only render the field when they can edit
          it or there is a number to show. */}
      {canEditContact || member.phone ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs font-medium text-muted-foreground">Phone</span>
          {canEditContact ? (
            <>
              <input
                value={phoneValue}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder="+15185550123"
                inputMode="tel"
                aria-label={`Phone for ${member.name}`}
                aria-invalid={phoneBad}
                className={`${smallInput} w-48`}
              />
              <button
                type="button"
                disabled={busy || phoneBad || phoneDraft === null || phoneDraft.trim() === (member.phone ?? "")}
                className={smallBtn}
                onClick={() =>
                  void run(
                    () => setContact({ userId: member.userId, phone: phoneValue.trim() }),
                    phoneValue.trim() ? "Phone saved" : "Phone cleared",
                  ).then((ok) => ok && setPhoneDraft(null))
                }
              >
                Save
              </button>
              {phoneBad ? (
                <span className="text-xs text-amber-600">Use international format, like +15185550123.</span>
              ) : null}
            </>
          ) : (
            <span>{member.phone}</span>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="w-20 text-xs font-medium text-muted-foreground">Notify by</span>
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
          <span className="w-20 text-xs font-medium text-muted-foreground">Out of office</span>
          <input
            type="date"
            value={dateDraft}
            min={toDateInput(now + 24 * 60 * 60 * 1000)}
            onChange={(e) => setDateDraft(e.target.value)}
            aria-label={`Out of office until, ${member.name}`}
            className={smallInput}
          />
          <button
            type="button"
            disabled={busy || !dateDraft}
            className={smallBtn}
            onClick={() => {
              const until = endOfDay(dateDraft);
              if (until === null) return;
              void run(() => setUnavailable({ userId: member.userId, until }), "Out of office set").then(
                (ok) => ok && setDateDraft(""),
              );
            }}
          >
            Set
          </button>
          {member.unavailableUntil !== null ? (
            <button
              type="button"
              disabled={busy}
              className={smallBtn}
              onClick={() => void run(() => setUnavailable({ userId: member.userId }), "Back in office")}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
