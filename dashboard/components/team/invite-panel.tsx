"use client";

import { useAction, useQuery } from "convex/react";
import { Mail, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/toast";
import { APP_ROLE_OPTIONS, E164 } from "@/components/team/member-details";
import type { AppRole } from "@/convex/jobRoles";

const inputClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20";

// Simple on purpose: the server is the authority, this only catches typos before a round trip.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FLOWS: ReadonlyArray<{ flow: AppRole; button: string; title: string; help: string }> = [
  {
    flow: "admin",
    button: "Add admin",
    title: "Invite an admin",
    help: "Admins manage the team and see everything.",
  },
  {
    flow: "asset_manager",
    button: "Add asset manager",
    title: "Invite an asset manager",
    help: "They'll only see maintenance for units assigned to them.",
  },
  {
    flow: "technician",
    button: "Add technician",
    title: "Invite a technician",
    help: "They'll only see jobs assigned to them, on their phone.",
  },
];

export function InvitePanel() {
  const access = useQuery(api.team.myAccess);
  const invite = useAction(api.team.invite);
  const toast = useToast();

  const [flow, setFlow] = useState<AppRole | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  // Non-admins get no invite UI at all.
  if (!access?.isAdmin) return null;

  const trimmedEmail = email.trim();
  const trimmedPhone = phone.trim();
  const emailBad = trimmedEmail !== "" && !EMAIL.test(trimmedEmail);
  const phoneBad = trimmedPhone !== "" && !E164.test(trimmedPhone);
  const active = FLOWS.find((f) => f.flow === flow) ?? null;
  const canSend = !busy && EMAIL.test(trimmedEmail) && !phoneBad;

  const close = () => {
    setFlow(null);
    setEmail("");
    setPhone("");
  };

  const open = (next: AppRole) => {
    if (next === flow) return close();
    setFlow(next);
    setEmail("");
    setPhone("");
  };

  const send = async () => {
    if (!flow || !canSend) return;
    setBusy(true);
    try {
      await invite({
        email: trimmedEmail,
        appRole: flow,
        phone: trimmedPhone || undefined,
      });
      toast(`Invite sent to ${trimmedEmail}`);
      close();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
      <div className="mb-5 flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">Invite someone</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        {FLOWS.map((f) => (
          <button
            key={f.flow}
            type="button"
            onClick={() => open(f.flow)}
            aria-pressed={flow === f.flow}
            className={`h-11 rounded-lg border px-5 text-sm font-semibold ${
              flow === f.flow
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input hover:bg-accent"
            }`}
          >
            {f.button}
          </button>
        ))}
      </div>

      {active ? (
        <div className="mt-5 space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{active.title}</h3>
            <button
              type="button"
              onClick={close}
              aria-label="Close invite form"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{active.help}</p>

          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@company.com"
            type="email"
            aria-label="Email"
            aria-invalid={emailBad}
            className={inputClass}
          />
          {emailBad ? <p className="text-xs text-amber-600">That doesn&apos;t look like an email address.</p> : null}

          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={
              flow === "admin"
                ? "Phone (optional), like +15185550123"
                : "Phone (recommended), like +15185550123"
            }
            inputMode="tel"
            aria-label="Phone"
            aria-invalid={phoneBad}
            className={`${inputClass} sm:w-80`}
          />
          {phoneBad ? (
            <p className="text-xs text-amber-600">Use international format, like +15185550123.</p>
          ) : null}
          {flow === "technician" && trimmedPhone === "" ? (
            <p className="text-xs text-amber-600">
              Without a phone number this technician won&apos;t get job alerts by SMS. You can still send the invite.
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <Mail className="h-4 w-4" />
            Send invite
          </button>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        They get an email with a link that expires in 7 days and works once. Only admins can open
        this page.
      </p>
    </section>
  );
}

export type RoleFilter = "all" | "admins" | "asset_managers" | "technicians" | "none";

export const ROLE_FILTERS: ReadonlyArray<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "admins", label: "Admins" },
  { value: "asset_managers", label: "Asset managers" },
  { value: "technicians", label: "Technicians" },
  { value: "none", label: "No role" },
];

export function matchesRoleFilter(filter: RoleFilter, m: { appRole: AppRole | null }): boolean {
  switch (filter) {
    case "all":
      return true;
    case "admins":
      return m.appRole === "admin";
    case "asset_managers":
      return m.appRole === "asset_manager";
    case "technicians":
      return m.appRole === "technician";
    case "none":
      return m.appRole === null;
  }
}

/** Pending-invite label: Admin / Asset manager / Technician, from the invite's app role. */
export function inviteTypeLabel(inv: { appRole: AppRole | null }): string {
  return APP_ROLE_OPTIONS.find((o) => o.value === inv.appRole)?.label ?? "No role yet";
}
