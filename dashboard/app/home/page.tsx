"use client";

import { useClerk } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Loader2, LogOut, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";

const DESTINATION = {
  admin: "/dashboard",
  asset_manager: "/maintenance",
  technician: "/tech",
  accountant: "/dashboard",
} as const;

/** Where everyone lands after sign-in: routes each person to the view their role gives them. */
export default function HomePage() {
  const router = useRouter();
  const { signOut } = useClerk();
  const access = useQuery(api.team.myAccess);
  const view = access?.view;

  useEffect(() => {
    if (view && view !== "none") router.replace(DESTINATION[view]);
  }, [view, router]);

  // undefined = loading. null = no team, which TeamGate explains before this ever renders.
  if (access && access.view === "none") {
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
