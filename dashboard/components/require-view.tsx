"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { AppView } from "@/convex/authz";
import type { AppRole } from "@/convex/roleSet";

type Access = { view: AppView; roles?: AppRole[] } | null | undefined;

/**
 * Every role the signed-in person holds (B31 multi-role). Falls back to the single default view
 * for a server that predates `roles`. Empty for no role.
 */
export function rolesOfAccess(access: Access): AppRole[] {
  if (!access) return [];
  if (access.roles) return access.roles;
  return access.view === "none" ? [] : [access.view];
}

/** The signed-in person's roles: undefined while loading, null with no team. */
export function useMyRoles(): AppRole[] | null | undefined {
  const access = useQuery(api.team.myAccess);
  if (access === undefined) return undefined;
  if (access === null) return null;
  return rolesOfAccess(access);
}

/** True if the person holds at least one of `views` (pages are open to the union of roles). */
export function holdsAnyOf(roles: ReadonlyArray<AppRole>, views: ReadonlyArray<AppView>): boolean {
  return views.some((v) => v !== "none" && roles.includes(v));
}

/**
 * Sends someone who holds none of the roles in `views` back to /home, which routes them to their
 * own. A multi-role person passes when ANY role they hold is listed.
 *
 * UX only: the server re-checks the role on every query and mutation, so a person who gets
 * past this (or sees a flash of the page) still cannot read or change anything.
 */
export function RequireView({ views, children }: { views: AppView[]; children: ReactNode }) {
  const router = useRouter();
  const access = useQuery(api.team.myAccess);
  // null = signed in with no team; TeamGate owns that screen, so nothing to guard here.
  const allowed = access === null || (access !== undefined && holdsAnyOf(rolesOfAccess(access), views));

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
