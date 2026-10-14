"use client";

import { AuthenticateWithRedirectCallback, useSignIn, useSignUp } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Where Clerk lands a Google sign-in it could not finish by itself.
 *
 * Nobody arrives here on the happy path: `signIn.sso()` sends a completed sign-in straight to
 * its `redirectUrl`. This page only sees the cases where no session was created — a new device
 * Clerk wants verified, a sign-up still missing something, a bot check that decided to
 * challenge — and each of those has to be routed somewhere to continue.
 *
 * Every URL below is pinned to this app on purpose. clerk-js falls back to the instance's
 * `displayConfig` for any route it is not given, and on this instance that resolves to the
 * hosted Account Portal at accounts.simplr.pro, which still carries an unrelated project's
 * branding. Passing only the two fallback redirect URLs left every non-complete status
 * bouncing users off the product and onto that portal.
 *
 * `#clerk-captcha` matters for the same reason it does on the sign-up form: bot protection is
 * enabled on the instance, and `signUp.create({ transfer: true })` runs inside
 * `handleRedirectCallback` — here, not there. Without a mount point clerk-js falls back to an
 * invisible widget, which passes quietly on a familiar device and hangs on an unfamiliar one,
 * because an escalated challenge has nowhere to render.
 *
 * The watchdog is the backstop for all of it. @clerk/react calls `handleRedirectCallback()` once
 * and discards anything it throws (`callback()?.catch(() => {})`), so a failure here used to be
 * indistinguishable from work still in progress: the spinner was the only thing this page could
 * ever render. Now a stall becomes a visible way out.
 */
const WATCHDOG_MS = 15_000;

export default function SSOCallbackPage() {
  const [stalled, setStalled] = useState(false);
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-4">
      {stalled ? (
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">We could not finish signing you in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Google sent you back, but the sign-in did not complete. This usually clears up on a
            second attempt.
          </p>
          <Link
            href="/sign-in"
            className="mt-5 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Back to sign in
          </Link>
          {/* Named so a stuck user can read them back to us; Clerk surfaces nothing itself. */}
          <p className="mt-4 text-xs text-muted-foreground">
            Reference: sign-in {signIn?.status ?? "unknown"}, sign-up {signUp?.status ?? "unknown"}
          </p>
        </div>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Finishing Google sign-in…</p>
        </>
      )}

      {/* Bot protection renders into this; it must exist before handleRedirectCallback runs. */}
      <div id="clerk-captcha" />

      {/* Left mounted even once stalled, so a late completion still navigates. */}
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        firstFactorUrl="/sign-in"
        secondFactorUrl="/sign-in"
        resetPasswordUrl="/sign-in"
        continueSignUpUrl="/sign-up"
        verifyEmailAddressUrl="/sign-up"
        verifyPhoneNumberUrl="/sign-up"
        signInFallbackRedirectUrl="/call"
        signUpFallbackRedirectUrl="/call"
      />
    </div>
  );
}
