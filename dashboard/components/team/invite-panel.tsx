"use client";

import { useAction, useQuery } from "convex/react";
import { Mail, UserPlus } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/toast";
import { APP_ROLE_OPTIONS, E164 } from "@/components/team/member-details";
import type { AppRole } from "@/convex/jobRoles";
import { Btn, Card, CardHead, Field, Input, Select } from "@/components/ui";

// Simple on purpose: the server is the authority, this only catches typos before a round trip.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitePanel() {
  const access = useQuery(api.team.myAccess);
  const invite = useAction(api.team.invite);
  const toast = useToast();

  const [role, setRole] = useState<AppRole>("technician");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  // Non-admins get no invite UI at all.
  if (!access?.isAdmin) return null;

  const trimmedEmail = email.trim();
  const trimmedPhone = phone.trim();
  const emailBad = trimmedEmail !== "" && !EMAIL.test(trimmedEmail);
  const phoneBad = trimmedPhone !== "" && !E164.test(trimmedPhone);
  const canSend = !busy && EMAIL.test(trimmedEmail) && !phoneBad;

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await invite({
        email: trimmedEmail,
        appRole: role,
        phone: trimmedPhone || undefined,
      });
      toast(`Invite sent to ${trimmedEmail}`);
      setEmail("");
      setPhone("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead title="Invite someone" icon={<UserPlus />} />
      <form
        className="grid items-end gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Field label="Email">
          <Input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@company.com"
            type="email"
            aria-label="Email"
            aria-invalid={emailBad}
          />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)} aria-label="Role">
            {APP_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={role === "admin" ? "Phone (optional)" : "Phone (recommended)"}>
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+15185550123"
            inputMode="tel"
            aria-label="Phone"
            aria-invalid={phoneBad}
          />
        </Field>
        <Btn type="submit" variant="pri" disabled={!canSend}>
          <Mail className="h-4 w-4" />
          Send invite
        </Btn>
      </form>
      {emailBad ? <p className="mt-2 text-xs text-warning-ink">That doesn&apos;t look like an email address.</p> : null}
      {phoneBad ? (
        <p className="mt-2 text-xs text-warning-ink">Use international format, like +15185550123.</p>
      ) : null}
      {role === "technician" && trimmedPhone === "" ? (
        <p className="mt-2 text-xs text-warning-ink">
          Without a phone number this technician won&apos;t get job alerts by SMS. You can still send the invite.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        {APP_ROLE_OPTIONS.find((o) => o.value === role)?.blurb}. They get an email with a link that expires in 7
        days and works once.
      </p>
    </Card>
  );
}

export type RoleFilter = "all" | AppRole | "none";

// URL values (?role=admin|asset_manager|technician). Old plural links still land on the right chip.
export const ROLE_FILTERS: ReadonlyArray<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admins" },
  { value: "asset_manager", label: "Asset managers" },
  { value: "technician", label: "Technicians" },
  { value: "none", label: "No role" },
];

const ROLE_ALIASES: Record<string, RoleFilter> = {
  admins: "admin",
  asset_managers: "asset_manager",
  technicians: "technician",
};

export function parseRoleFilter(raw: string | null): RoleFilter {
  if (!raw) return "all";
  const value = ROLE_ALIASES[raw] ?? raw;
  return ROLE_FILTERS.some((f) => f.value === value) ? (value as RoleFilter) : "all";
}

export function matchesRoleFilter(filter: RoleFilter, m: { appRole: AppRole | null }): boolean {
  if (filter === "all") return true;
  if (filter === "none") return m.appRole === null;
  return m.appRole === filter;
}

/** Pending-invite label: Admin / Asset manager / Technician, from the invite's app role. */
export function inviteTypeLabel(inv: { appRole: AppRole | null }): string {
  return APP_ROLE_OPTIONS.find((o) => o.value === inv.appRole)?.label ?? "No role yet";
}
