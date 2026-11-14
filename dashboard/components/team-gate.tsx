"use client";

import { useClerk } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Lock, LogOut, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage, useToast } from "@/components/toast";

/**
 * Renders the app only for a team member. Dashboard access is invite-only (convex/inviteGate.ts):
 * an account with no membership sees a full-page message instead, with no sidebar and no data
 * query mounted. A courtesy layer only: every Convex data function refuses such an account on its
 * own (authz.ts, INVITE_REQUIRED).
 *
 * If an invitation is waiting for their address, this offers it directly, so the join does not
 * depend on them finding the original email. Sits inside PasswordGate, so a seeded person on a
 * temporary password meets the change-password page first.
 */
export function TeamGate({ children }: { children: ReactNode }) {
  const gate = useQuery(api.team.accessGate);
  const accept = useMutation(api.team.acceptPendingInvite);
  const { signOut } = useClerk();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (gate?.state === "member") return <>{children}</>;

  // undefined = still loading; null = the Convex session has not caught up with Clerk yet.
  if (gate === undefined || gate === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const join = async () => {
    setBusy(true);
    try {
      const result = await accept({});
      toast(`You have joined ${result.orgName}`);
    } catch (err) {
      toast(errorMessage(err, "Could not join that team."), "error");
    } finally {
      setBusy(false);
    }
  };

  const signOutButton = (
    <button
      onClick={() => void signOut({ redirectUrl: "/" })}
      className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted"
    >
      <LogOut className="h-4 w-4" />
      Sign out
    </button>
  );

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          {gate.state === "invite_required" ? <Lock className="h-5 w-5" /> : <Users className="h-5 w-5" />}
        </span>

        {gate.state === "invited" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold">You have been invited to {gate.orgName}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Join to share the same assistant, property, knowledge base and leads.
            </p>
            <button
              onClick={() => void join()}
              disabled={busy}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Join {gate.orgName}
            </button>
          </>
        ) : gate.state === "invite_required" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold">You need an invite</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You need an invite from 518 Property Pro to use this dashboard. If you were invited,
              open the link in your invite email, or ask your admin to send a new one.
            </p>
            {signOutButton}
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold">Setting up your account</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This usually takes a few seconds. Refresh the page if it doesn&apos;t update.
            </p>
            {signOutButton}
          </>
        )}
      </div>
    </div>
  );
}
