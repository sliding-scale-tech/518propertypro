"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { AppView } from "@/convex/authz";

/**
 * Sends someone whose view isn't in `views` back to /home, which routes them to their own.
 *
 * UX only: the server re-checks the role on every query and mutation, so a person who gets
 * past this (or sees a flash of the page) still cannot read or change anything.
 */
export function RequireView({ views, children }: { views: AppView[]; children: ReactNode }) {
  const router = useRouter();
  const access = useQuery(api.team.myAccess);
  // null = signed in with no team; TeamGate owns that screen, so nothing to guard here.
  const allowed = access === null || (access !== undefined && views.includes(access.view));

  useEffect(() => {
    if (access !== undefined && !allowed) router.replace("/home");
  }, [access, allowed, router]);

  if (access === undefined || !allowed) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
