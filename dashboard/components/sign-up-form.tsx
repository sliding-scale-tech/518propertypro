"use client";

import { useAuth, useSignUp } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  AuthDivider,
  AuthShell,
  GoogleAuthButton,
  PasswordField,
  authButtonClassName,
  authFieldClassName,
} from "@/components/auth-shell";
import { afterAuthDestination, goAfterAuth } from "@/lib/auth-navigate";

export function SignUpForm() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isSignedIn) router.replace(afterAuthDestination());
  }, [isSignedIn, router]);

  const busy = fetchStatus === "fetching";

  const handleGoogle = async () => {
    await signUp.sso({
      strategy: "oauth_google",
      redirectUrl: afterAuthDestination(),
      redirectCallbackUrl: "/sso-callback",
    });
  };

  const handleSubmit = async (formData: FormData) => {
    const emailAddress = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const firstName = String(formData.get("firstName") ?? "");
    const lastName = String(formData.get("lastName") ?? "");

    await signUp.password({
      emailAddress,
      password,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
    });

    if (signUp.isTransferable) {
      router.push("/sign-in");
      return;
    }

    if (signUp.unverifiedFields?.includes("email_address")) {
      await signUp.verifications.sendEmailCode();
    }

    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: (args) => goAfterAuth(router, args),
      });
    }
  };

  const handleVerify = async (formData: FormData) => {
    const code = String(formData.get("code") ?? "");
    await signUp.verifications.verifyEmailCode({ code });

    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: (args) => goAfterAuth(router, args),
      });
    }
  };

  if (!signUp || isSignedIn) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const needsEmailCode =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;

  if (needsEmailCode) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="We sent a verification code to finish creating your account."
      >
        <form action={handleVerify} className="space-y-4">
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
          <button type="submit" disabled={busy} className={authButtonClassName}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Verify email
          </button>
        </form>
        <button
          type="button"
          onClick={() => void signUp.verifications.sendEmailCode()}
          className="mt-4 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          I need a new code
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create an account"
      subtitle="Set up access to your Simplr leasing dashboard."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
          <p className="mt-3 text-xs">
            By creating an account, you agree to our{" "}
            <Link href="/terms" className="underline hover:text-foreground">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </>
      }
    >
      <GoogleAuthButton label="Continue with Google" disabled={busy} onClick={() => void handleGoogle()} />
      <AuthDivider />
      <form action={handleSubmit} className="space-y-4">
        <GlobalErrors messages={errors?.global?.map((error) => error.message)} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            First name
            <input name="firstName" autoComplete="given-name" className={authFieldClassName} />
            <FieldError message={errors?.fields?.firstName?.message} />
          </label>
          <label className="block text-sm font-medium">
            Last name
            <input name="lastName" autoComplete="family-name" className={authFieldClassName} />
            <FieldError message={errors?.fields?.lastName?.message} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Email
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={authFieldClassName}
          />
          <FieldError message={errors?.fields?.emailAddress?.message} />
        </label>
        <div>
          <PasswordField
            id="password"
            name="password"
            autoComplete="new-password"
            required
          />
          <FieldError message={errors?.fields?.password?.message} />
        </div>
        <button type="submit" disabled={busy} className={authButtonClassName}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create account
        </button>
        <div id="clerk-captcha" />
      </form>
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
