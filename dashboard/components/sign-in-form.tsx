"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthDivider,
  AuthShell,
  GoogleAuthButton,
  PasswordField,
  authButtonClassName,
  authFieldClassName,
} from "@/components/auth-shell";
import { afterAuthDestination, goAfterAuth } from "@/lib/auth-navigate";

export function SignInForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (isSignedIn) router.replace(afterAuthDestination());
  }, [isSignedIn, router]);

  const busy = fetchStatus === "fetching";

  /**
   * Sends whichever code the pending second factor actually needs.
   *
   * `needs_client_trust` reports no supported factors at all — it is Clerk asking us to verify
   * an unfamiliar device, not a second factor the user has enrolled — so an empty list means
   * email, not "nothing to send". Authenticator apps and backup codes are the one case with
   * nothing to send: the code already exists on the user's device.
   */
  const prepareSecondFactor = useCallback(async () => {
    if (!signIn) return;
    const factors = signIn.supportedSecondFactors ?? [];
    if (factors.length === 0 || factors.some((factor) => factor.strategy === "email_code")) {
      await signIn.mfa.sendEmailCode();
      return;
    }
    if (factors.some((factor) => factor.strategy === "phone_code")) {
      await signIn.mfa.sendPhoneCode();
    }
  }, [signIn]);

  /**
   * Google sign-in from a new device arrives here already in `needs_client_trust`, with nothing
   * having sent the code — clerk-js has no branch for this status in its OAuth callback, so it
   * routes the user to `signInUrl` and leaves the verification to us. Without this the screen
   * below asked for a code that was never going to arrive.
   */
  const codeRequested = useRef(false);
  useEffect(() => {
    if (signIn?.status !== "needs_client_trust" || codeRequested.current) return;
    codeRequested.current = true;
    void prepareSecondFactor();
  }, [signIn?.status, prepareSecondFactor]);

  const handlePassword = async (formData: FormData) => {
    const emailAddress = String(formData.get("email") ?? email);
    const password = String(formData.get("password") ?? "");
    setEmail(emailAddress);

    await signIn.password({ emailAddress, password });

    if (signIn.status === "needs_second_factor") {
      codeRequested.current = true;
      await prepareSecondFactor();
    }

    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: (args) => goAfterAuth(router, args),
      });
    }
  };

  const handleSecondFactor = async (formData: FormData) => {
    const code = String(formData.get("code") ?? "");
    const useBackupCode = formData.get("useBackupCode") === "on";
    const factors = signIn.supportedSecondFactors ?? [];

    if (useBackupCode) {
      await signIn.mfa.verifyBackupCode({ code });
    } else if (factors.some((factor) => factor.strategy === "totp")) {
      await signIn.mfa.verifyTOTP({ code });
    } else if (factors.some((factor) => factor.strategy === "phone_code")) {
      await signIn.mfa.verifyPhoneCode({ code });
    } else {
      await signIn.mfa.verifyEmailCode({ code });
    }

    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: (args) => goAfterAuth(router, args),
      });
    }
  };

  const handleGoogle = async () => {
    await signIn.sso({
      strategy: "oauth_google",
      redirectUrl: afterAuthDestination(),
      redirectCallbackUrl: "/sso-callback",
    });
  };

  const handleForgotPassword = async () => {
    if (!email) return;
    await signIn.create({ identifier: email });
    await signIn.resetPasswordEmailCode.sendCode();
    setResetSent(true);
  };

  const handleReset = async (formData: FormData) => {
    if (signIn.status !== "needs_new_password") {
      const code = String(formData.get("code") ?? "");
      await signIn.resetPasswordEmailCode.verifyCode({ code });
      return;
    }

    const password = String(formData.get("password") ?? "");
    await signIn.resetPasswordEmailCode.submitPassword({ password });
    await signIn.finalize({
      navigate: (args) => goAfterAuth(router, args),
    });
  };

  if (!signIn || isSignedIn) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
    return (
      <AuthShell
        title="Verify it’s you"
        subtitle={
          signIn.status === "needs_client_trust"
            ? "You are signing in from a new device. Enter the code we emailed you to continue."
            : "Enter the verification code to finish signing in."
        }
      >
        <form action={handleSecondFactor} className="space-y-4">
          <GlobalErrors messages={errors?.global?.map((error) => error.message)} />
          <label className="block text-sm font-medium">
            Code
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className={authFieldClassName}
            />
            <FieldError message={errors?.fields?.code?.message} />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="useBackupCode" className="rounded border-input" />
            Use a backup code
          </label>
          <button type="submit" disabled={busy} className={authButtonClassName}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Verify
          </button>
        </form>
        <button
          type="button"
          onClick={() => void prepareSecondFactor()}
          className="mt-4 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          I need a new code
        </button>
      </AuthShell>
    );
  }

  if (signIn.status === "needs_new_password") {
    return (
      <AuthShell title="Choose a new password" subtitle="Enter a new password to finish resetting your account.">
        <form action={handleReset} className="space-y-4">
          <GlobalErrors messages={errors?.global?.map((error) => error.message)} />
          <input type="hidden" name="code" value="" />
          <div>
            <PasswordField name="password" autoComplete="new-password" required label="New password" />
            <FieldError message={errors?.fields?.password?.message} />
          </div>
          <button type="submit" disabled={busy} className={authButtonClassName}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Update password
          </button>
        </form>
      </AuthShell>
    );
  }

  if (resetSent) {
    return (
      <AuthShell title="Check your email" subtitle="Enter the reset code we sent you.">
        <form action={handleReset} className="space-y-4">
          <GlobalErrors messages={errors?.global?.map((error) => error.message)} />
          <label className="block text-sm font-medium">
            Code
            <input name="code" inputMode="numeric" required className={authFieldClassName} />
            <FieldError message={errors?.fields?.code?.message} />
          </label>
          <button type="submit" disabled={busy} className={authButtonClassName}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back — continue to the leasing dashboard."
      footer={
        <>
          New here?{" "}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <GoogleAuthButton label="Continue with Google" disabled={busy} onClick={() => void handleGoogle()} />
      <AuthDivider />
      <form action={handlePassword} className="space-y-4">
        <GlobalErrors messages={errors?.global?.map((error) => error.message)} />
        <label className="block text-sm font-medium">
          Email
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={authFieldClassName}
          />
          <FieldError message={errors?.fields?.identifier?.message} />
        </label>
        <div>
          <PasswordField
            id="password"
            name="password"
            autoComplete="current-password"
            required
          />
          <FieldError message={errors?.fields?.password?.message} />
        </div>
        <button type="submit" disabled={busy} className={authButtonClassName}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue
        </button>
      </form>
      <button
        type="button"
        onClick={() => void handleForgotPassword()}
        className="mt-4 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        Forgot password?
      </button>
    </AuthShell>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

function GlobalErrors({ messages }: { messages?: Array<string | undefined> }) {
  const visible = messages?.filter(Boolean) ?? [];
  if (visible.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {visible.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
