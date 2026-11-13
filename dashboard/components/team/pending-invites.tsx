"use client";

import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown, Mail, RefreshCw, X } from "lucide-react";
import { useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, useToast } from "@/components/toast";
import { inviteTypeLabel } from "@/components/team/invite-panel";
import { Btn, Card, cx } from "@/components/ui";

type Invitation = NonNullable<FunctionReturnType<typeof api.team.overview>>["invitations"][number];

/**
 * Compact, collapsed-by-default "Pending invites (n)" strip at the top of Members (admins only;
 * the overview query only returns invitations to admins). Hidden when there are none.
 */
export function PendingInvites({ invitations }: { invitations: Invitation[] }) {
  const revokeInvite = useMutation(api.team.revokeInvite);
  const resendInvite = useAction(api.team.invite);
  const toast = useToast();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (invitations.length === 0) return null;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
    } catch (err) {
      toast(errorMessage(err, "That didn't work."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="!px-0 !py-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-[20px] px-[22px] py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning-ink">
          <Mail className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold">
          Pending invites <span className="text-muted-foreground">({invitations.length})</span>
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">Invited, not joined yet</span>
        <ChevronDown className={cx("ml-auto h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <ul id={panelId} className="space-y-2 border-t border-border px-[22px] py-3.5">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {invitation.fullName ? `${invitation.fullName} · ` : ""}
                  {invitation.email}
                </p>
                <p className="text-xs text-muted-foreground">
                  {inviteTypeLabel(invitation)} · invited {new Date(invitation.createdAt).toLocaleDateString()} · expires{" "}
                  {new Date(invitation.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <Btn
                sm
                aria-label={`Resend invite to ${invitation.email}`}
                disabled={busy || invitation.appRoles.length === 0}
                onClick={() =>
                  void run(
                    () =>
                      resendInvite({
                        email: invitation.email,
                        appRoles: invitation.appRoles,
                        phone: invitation.phone ?? undefined,
                        fullName: invitation.fullName ?? undefined,
                      }),
                    `Invite re-sent to ${invitation.email}`,
                  )
                }
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Resend
              </Btn>
              <Btn
                sm
                aria-label={`Revoke invite for ${invitation.email}`}
                onClick={() => void run(() => revokeInvite({ inviteId: invitation.id }), "Invite revoked")}
                disabled={busy}
              >
                <X className="h-3.5 w-3.5" />
                Revoke
              </Btn>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
