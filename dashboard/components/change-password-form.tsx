"use client";

import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useQuery } from "convex/react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { completePasswordChange } from "@/app/change-password/actions";
import { AuthShell, authButtonClassName } from "@/components/auth-shell";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import {
  DEFAULT_MIN_PASSWORD_LENGTH,
  checkPasswordFields,
  mustChangePasswordFromMetadata,
  type PasswordErrors,
  type PasswordFields,
} from "@/lib/password-gate";

/**
 * "Set your new password" (forced password change on first login, convex/passwordGate.ts).
 *
 * 1. Checks the three fields here first, with a sentence under each bad one and a toast.
 * 2. Changes the password with Clerk (user.updatePassword, signing out other sessions).
 * 3. Asks the server (completePasswordChange) to confirm with Clerk and clear the flag. The browser
 *    never clears it itself.
 * 4. Waits for Convex to see the cleared flag (Clerk webhook), then opens the dashboard.
 */

const WAIT_FOR_CONVEX_MS = 20_000;
const RELOAD_AFTER_MS = 6_000;

type Stage = "form" | "finishing" | "stuck";

/** Clerk's own minimum for this instance when it is exposed, else Clerk's default. */
function useMinLength(): number {
  const clerk = useClerk();
  const env = (clerk as unknown as {
    __unstable__environment?: { userSettings?: { passwordSettings?: { min_length?: number } } };
  }).__unstable__environment;
  const n = env?.userSettings?.passwordSettings?.min_length;
  return typeof n === "number" && n > 0 ? n : DEFAULT_MIN_PASSWORD_LENGTH;
}

/** A Clerk error as the field it belongs to and the sentence to show. Never a raw stack or code. */
function clerkProblem(err: unknown): { field?: keyof PasswordFields; message: string } {
  if (!isClerkAPIResponseError(err)) {
    return { message: "We could not change your password. Check your connection and try again." };
  }
  const first = err.errors[0];
  const code = first?.code ?? "";
  const param = first?.meta?.paramName ?? "";
  if (code === "form_password_incorrect" || param === "current_password") {
    return { field: "currentPassword", message: "That temporary password is not right. Enter the one you signed in with." };
  }
  if (code === "form_password_pwned") {
    return { field: "newPassword", message: "That password has appeared in a data breach. Choose a different one." };
  }
  if (/reverification|session_reverification/.test(code)) {
    return { message: "For your security, sign out, sign in again with your temporary password, and set your new password straight away." };
  }
  if (code.startsWith("form_password") || param === "new_password" || param === "password") {
    return { field: "newPassword", message: first?.longMessage || first?.message || "Choose a stronger password." };
  }
  return { message: first?.longMessage || "We could not change your password. Try again." };
}

export function ChangePasswordForm() {
  const { isLoaded, user } = useUser();
  const { getToken, signOut } = useAuth();
  const gate = useQuery(api.users.passwordGate);
  const minLength = useMinLength();

  const [fields, setFields] = useState<PasswordFields>({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const waitStarted = useRef<number | null>(null);

  const clerkFlag = mustChangePasswordFromMetadata(user?.publicMetadata);
  const convexFlag = gate?.mustChangePassword === true;

  // Done everywhere: open the app. A full load, so every token (Clerk session, Convex) is fresh.
  useEffect(() => {
    if (!isLoaded || gate === undefined) return;
    if (!clerkFlag && gate !== null && !convexFlag) window.location.assign("/home");
  }, [isLoaded, gate, clerkFlag, convexFlag]);

  // Clerk is cleared but Convex has not heard yet (webhook in flight): wait, then offer a retry.
  useEffect(() => {
    if (!isLoaded || clerkFlag || !convexFlag) return;
    if (waitStarted.current === null) waitStarted.current = Date.now();
    const left = WAIT_FOR_CONVEX_MS - (Date.now() - waitStarted.current);
    const timer = setTimeout(() => setStage("stuck"), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [isLoaded, clerkFlag, convexFlag]);

  const set = (key: keyof PasswordFields) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  /** Server confirms with Clerk and clears the flag; then fresh tokens so the gate sees it. */
  const finish = async (): Promise<boolean> => {
    const result = await completePasswordChange();
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    await user?.reload();
    await getToken({ skipCache: true }).catch(() => null);
    await getToken({ template: "convex", skipCache: true }).catch(() => null);
    waitStarted.current = Date.now();
    setStage("finishing");
    // If Convex has not seen it within a few seconds (its token is cached for up to a minute), a full
    // load fetches fresh tokens. The redirect effect above usually fires first.
    setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    return true;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || busy) return;
    const found = checkPasswordFields(fields, minLength);
    setErrors(found);
    const firstProblem = Object.values(found).find(Boolean);
    if (firstProblem) {
      toast.error(firstProblem);
      return;
    }
    setBusy(true);
    try {
      await user.updatePassword({
        currentPassword: fields.currentPassword,
        newPassword: fields.newPassword,
        signOutOfOtherSessions: true,
      });
    } catch (err) {
      const problem = clerkProblem(err);
      if (problem.field) setErrors({ [problem.field]: problem.message });
      toast.error(problem.message);
      setBusy(false);
      return;
    }
    // The password is changed from here on; clear the fields so nothing lingers in memory or the DOM.
    setFields({ currentPassword: "", newPassword: "", confirmPassword: "" });
    const ok = await finish();
    if (!ok) setStage("stuck");
    setBusy(false);
  };

  const retry = async () => {
    setBusy(true);
    try {
      await finish();
    } finally {
      setBusy(false);
    }
  };

  if (!isLoaded || gate === undefined || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!clerkFlag && (stage !== "form" || convexFlag)) {
    return (
      <AuthShell
        title={stage === "stuck" ? "Almost there" : "Finishing up"}
        subtitle={
          stage === "stuck"
            ? "Your new password is saved, but your account has not finished updating. Select Try again; if it keeps happening, tell your administrator."
            : "Your new password is saved. Opening your dashboard..."
        }
      >
        {stage === "stuck" ? (
          <button type="button" onClick={() => void retry()} disabled={busy} className={authButtonClassName}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Try again
          </button>
        ) : (
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </AuthShell>
    );
  }

  if (!clerkFlag && !convexFlag) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AuthShell
      title="Set your new password"
      subtitle="You signed in with a temporary password. Choose your own to continue."
      footer={
        <button type="button" onClick={() => void signOut({ redirectUrl: "/sign-in" })} className="underline underline-offset-4 hover:text-foreground">
          Sign out
        </button>
      }
    >
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <Field
          id="currentPassword"
          label="Temporary password"
          autoComplete="current-password"
          value={fields.currentPassword}
          onChange={set("currentPassword")}
          error={errors.currentPassword}
        />
        <Field
          id="newPassword"
          label="New password"
          autoComplete="new-password"
          value={fields.newPassword}
          onChange={set("newPassword")}
          error={errors.newPassword}
          hint={`At least ${minLength} characters, different from your temporary password.`}
        />
        <Field
          id="confirmPassword"
          label="Confirm new password"
          autoComplete="new-password"
          value={fields.confirmPassword}
          onChange={set("confirmPassword")}
          error={errors.confirmPassword}
        />
        <button type="submit" disabled={busy} className={authButtonClassName}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save password
        </button>
      </form>
    </AuthShell>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={`w-full rounded-lg border bg-background px-3 py-2.5 pr-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 ${
            error ? "border-red-500" : "border-input"
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
