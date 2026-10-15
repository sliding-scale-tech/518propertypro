"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import type { Manager } from "./types";

/** Team members holding the asset-manager job role. `undefined` while loading. */
export function useManagers(): Manager[] | undefined {
  const team = useQuery(api.team.overview);
  return useMemo(
    () =>
      team
        ? team.members
            .filter((m) => m.jobRoles.includes("asset_manager"))
            .map((m) => ({ userId: m.userId, name: m.name }))
        : undefined,
    [team],
  );
}
