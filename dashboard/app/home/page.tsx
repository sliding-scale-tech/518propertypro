"use client";

import { useClerk } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Loader2, LogOut, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import type { AppRole } from "@/convex/roleSet";
import { rolesOfAccess } from "@/components/require-view";

/**
 * Where a person lands: the dashboard for anyone holding Admin, Asset manager or Accountant (a
 * multi-role person sees a section per role there); the technician app only for someone whose
 * ONLY role is Technician. null = no role yet.
 */
function destinationFor(roles: ReadonlyArray<AppRole>): string | null {
  if (roles.length === 0) return null;
  return roles.every((r) => r === "technician") ? "/tech" : "/dashboard";
}

/** Where everyone lands after sign-in: routes each person to the view their roles give them. */
export default function HomePage() {
  const router = useRouter();
  const { signOut } = useClerk();
  const access = useQuery(api.team.myAccess);
  const destination = access ? destinationFor(rolesOfAccess(access)) : null;

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  // undefined = loading. null = no team, which TeamGate explains before this ever renders.
  if (access && destination === null) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Lock className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">Waiting for access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            An admin needs to give you a role before you can use Simplr.
          </p>
          <button
            onClick={() => void signOut({ redirectUrl: "/" })}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
