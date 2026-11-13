"use client";

import { useAction } from "convex/react";
import { Mail } from "lucide-react";
import { useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, useToast } from "@/components/toast";
import { APP_ROLE_OPTIONS, E164, RoleChips, appRolesLabel, roleSelectionError } from "@/components/team/member-details";
import type { AppRole } from "@/convex/jobRoles";
import { Btn, Field, Input, Modal, cx } from "@/components/ui";

// Simple on purpose: the server is the authority, this only catches typos before a round trip.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InviteErrors = { email?: string; phone?: string; roles?: string };

/**
 * "Invite member" dialog (admins only; the page only offers the button to them and team.invite
 * checks again on the server). The form lives inside, so it starts empty every time it opens.
 */
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <InviteForm onClose={onClose} />;
}

function InviteForm({ onClose }: { onClose: () => void }) {
  const invite = useAction(api.team.invite);
  const toast = useToast();
  const formId = useId();

  const [roles, setRoles] = useState<AppRole[]>(["technician"]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  // Field errors from the last Send attempt (cleared as the field is fixed).
  const [errors, setErrors] = useState<InviteErrors>({});

  const trimmedEmail = email.trim();
  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();
  const phoneBad = trimmedPhone !== "" && !E164.test(trimmedPhone);
  const isTechnician = roles.includes("technician");
  const adminOnly = roles.length === 1 && roles[0] === "admin";

  const validate = (): InviteErrors => {
    const next: InviteErrors = {};
    if (trimmedEmail === "") next.email = "Enter the email address to send the invite to.";
    else if (!EMAIL.test(trimmedEmail)) next.email = "That doesn't look like an email address.";
    if (phoneBad) next.phone = "Use international format, like +15185550123.";
    const roleProblem = roleSelectionError(roles);
    if (roleProblem) next.roles = roleProblem;
    return next;
  };

  const send = async () => {
    if (busy) return;
    const found = validate();
    setErrors(found);
    const first = found.email ?? found.roles ?? found.phone;
    if (first) {
      toast(first, "error");
      return;
    }
    setBusy(true);
    try {
      await invite({
        email: trimmedEmail,
        appRoles: roles,
        phone: trimmedPhone || undefined,
        fullName: trimmedName || undefined,
      });
      toast(`Invite sent to ${trimmedEmail}`);
      onClose();
    } catch (err) {
      toast(errorMessage(err, "That didn't work."), "error");
    } finally {
      setBusy(false);
    }
  };

  const blurbs = roles
    .map((r) => APP_ROLE_OPTIONS.find((o) => o.value === r)?.blurb)
    .filter(Boolean)
    .join(". ");

  return (
    <Modal
      title="Invite member"
      eyebrow="Team"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" form={formId} variant="pri" disabled={busy}>
            <Mail className="h-4 w-4" />
            {busy ? "Sending…" : "Send invite"}
          </Btn>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Field label="Email">
          <Input
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
            }}
            placeholder="teammate@company.com"
            type="email"
            autoFocus
            aria-label="Email"
            aria-invalid={!!errors.email}
            className={cx(errors.email && "!border-danger-ink")}
          />
          {errors.email ? <p className="text-xs text-danger-ink">{errors.email}</p> : null}
        </Field>

        <Field label="Name (optional)">
          <Input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jordan Smith"
            aria-label="Name"
          />
        </Field>

        <div className="flex flex-col gap-[5px]">
          <span className="text-[12.5px] font-medium text-muted-foreground">Roles</span>
          <RoleChips
            value={roles}
            onChange={(next) => {
              setRoles(next);
              if (errors.roles) setErrors((x) => ({ ...x, roles: roleSelectionError(next) ?? undefined }));
            }}
            disabled={busy}
            label="Roles"
            error={errors.roles}
          />
          <p className="text-xs text-muted-foreground">
            Admin on its own, or any mix of Asset manager, Technician and Accountant.
          </p>
        </div>

        <Field label={adminOnly ? "Phone (optional)" : "Phone (recommended)"}>
          <Input
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              if (errors.phone) setErrors((x) => ({ ...x, phone: undefined }));
            }}
            placeholder="+15185550123"
            inputMode="tel"
            aria-label="Phone"
            aria-invalid={phoneBad || !!errors.phone}
            className={cx((phoneBad || errors.phone) && "!border-danger-ink")}
          />
          {phoneBad ? <p className="text-xs text-danger-ink">Use international format, like +15185550123.</p> : null}
          {isTechnician && trimmedPhone === "" ? (
            <p className="text-xs text-warning-ink">
              Without a phone number this technician won&apos;t get job alerts by SMS. You can still send the invite.
            </p>
          ) : null}
        </Field>

        <p className="text-xs text-muted-foreground">
          {blurbs ? `${blurbs}. ` : ""}They get an email with a link that expires in 7 days and works once.
        </p>
      </form>
    </Modal>
  );
}

export type RoleFilter = "all" | AppRole | "none";

// URL values (?role=admin|asset_manager|technician|accountant). Old plural links still land on the right chip.
export const ROLE_FILTERS: ReadonlyArray<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admins" },
  { value: "asset_manager", label: "Asset managers" },
  { value: "technician", label: "Technicians" },
  { value: "accountant", label: "Accountants" },
  { value: "none", label: "No role" },
];

const ROLE_ALIASES: Record<string, RoleFilter> = {
  admins: "admin",
  asset_managers: "asset_manager",
  technicians: "technician",
  accountants: "accountant",
};

export function parseRoleFilter(raw: string | null): RoleFilter {
  if (!raw) return "all";
  const value = ROLE_ALIASES[raw] ?? raw;
  return ROLE_FILTERS.some((f) => f.value === value) ? (value as RoleFilter) : "all";
}

/** A member counts under EVERY role they hold (B31), so a multi-role person shows under each chip. */
export function matchesRoleFilter(filter: RoleFilter, m: { appRoles: ReadonlyArray<AppRole> }): boolean {
  if (filter === "all") return true;
  if (filter === "none") return m.appRoles.length === 0;
  return m.appRoles.includes(filter);
}

/** Pending-invite label: every role on the invite, e.g. "Asset manager, Accountant". */
export function inviteTypeLabel(inv: { appRoles: ReadonlyArray<AppRole> }): string {
  return appRolesLabel(inv.appRoles);
}
