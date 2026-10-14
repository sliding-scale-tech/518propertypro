"use client";

import { useAuth } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";

/**
 * Where an invitation email lands.
 *
 * The token in the URL is the whole secret — only its SHA-256 is stored — so this page's job
 * is to get the person signed in and then hand that token to the server exactly once.
 *
 * Signed out, it sends them through this app's own sign-in/sign-up forms rather than a
 * Clerk-hosted one, keeping the token in the return URL so it survives the round trip.
 */
export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<Frame title="Team invitation">Loading…</Frame>}>
      <AcceptInvite />
    </Suspense>
  );
}

function AcceptInvite() {
  const params = useSearchParams();
  const token = params.get("token");
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const peekInvite = useAction(api.team.peekInvite);
  const acceptInvite = useAction(api.team.acceptInvite);

  const [summary, setSummary] = useState<{ orgName: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "joining" | "done">("checking");

  const check = useCallback(async () => {
    if (!token) {
      setError("This link is missing its invitation token.");
      setState("ready");
      return;
    }
    try {
      const found = await peekInvite({ token });
      if (!found) setError("That invitation link is no longer valid. Ask for a new one.");
      else setSummary({ orgName: found.orgName, email: found.email });
    } catch {
      setError("Could not check that invitation.");
    } finally {
      setState("ready");
    }
  }, [token, peekInvite]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void check();
  }, [check]);

  // Signed in with a live invite: redeem it straight away. There is nothing to confirm — they
  // clicked the link in their own email, which is the confirmation.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !token || !summary || state !== "ready") return;
    setState("joining");
    void (async () => {
      try {
        await acceptInvite({ token });
        setState("done");
        router.replace("/call");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not accept that invitation.");
        setState("ready");
      }
    })();
  }, [isLoaded, isSignedIn, token, summary, state, acceptInvite, router]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isLoaded || state === "checking") {
    return <Frame title="Team invitation">Checking your invitation…</Frame>;
  }

  if (error) {
    return (
      <Frame title="Team invitation">
        {error}
        <p className="mt-4">
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Go to sign in
          </Link>
        </p>
      </Frame>
    );
  }

  if (state === "joining" || state === "done") {
    return (
      <Frame title={`Joining ${summary?.orgName ?? "the team"}`}>
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          One moment…
        </span>
      </Frame>
    );
  }

  // Signed out. Carry the token through sign-in/sign-up so this page can finish the job after.
  const returnTo = encodeURIComponent(`/accept-invite?token=${token ?? ""}`);
  return (
    <Frame title={`Join ${summary?.orgName ?? "the team"}`}>
      You have been invited as <strong>{summary?.email}</strong>. Sign in with that address to
      accept — or create an account if you do not have one yet.
      <span className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link
          href={`/sign-in?redirect_url=${returnTo}`}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Sign in
        </Link>
        <Link
          href={`/sign-up?redirect_url=${returnTo}`}
          className="rounded-lg border border-input bg-card px-5 py-2.5 text-sm font-medium hover:bg-accent"
        >
          Create an account
        </Link>
      </span>
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="mt-2 text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
