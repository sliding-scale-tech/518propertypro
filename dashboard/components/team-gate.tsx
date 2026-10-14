"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/toast";

/**
 * Explains a team-less dashboard instead of quietly rendering an empty one.
 *
 * Every org-scoped query degrades to nothing when the signed-in account has no team, which
 * looks identical to a brand-new install — that is exactly how an invitee who signed up but
 * never redeemed their invite reads the screen. If an invitation is waiting for their address,
 * this offers it directly, so the join no longer depends on them finding the original email.
 */
export function TeamGate({ children }: { children: ReactNode }) {
  const overview = useQuery(api.team.overview);
  const pending = useQuery(api.team.myPendingInvite);
  const accept = useMutation(api.team.acceptPendingInvite);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // undefined = still loading. null = signed in with no team.
  if (overview === undefined || pending === undefined) return <>{children}</>;
  if (overview !== null) return <>{children}</>;

  const join = async () => {
    setBusy(true);
    try {
      const result = await accept({});
      toast(`You have joined ${result.orgName}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not join that team.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Users className="h-5 w-5" />
        </span>

        {pending ? (
          <>
            <h1 className="mt-4 text-lg font-semibold">You have been invited to {pending.orgName}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Join to share the same assistant, property, knowledge base and leads.
            </p>
            <button
              onClick={() => void join()}
              disabled={busy}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Join {pending.orgName}
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold">Setting up your access</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your account is being added to the team. This usually takes a few seconds — refresh
              the page if it doesn&apos;t update.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
