"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { nextQuery } from "./tenant-list-params";

/**
 * Filters and sort of a Tenants list kept in the URL. `set` changes keys and goes back to page 1.
 * The page needs a <Suspense> boundary (useSearchParams).
 */
export function useTenantUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return {
    params,
    set: (updates: Record<string, string | null>) => {
      const qs = nextQuery(params.toString(), updates);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
  };
}

/**
 * Keeps showing the last loaded result while a changed query loads (no blank table between
 * pages). `stale` is true while the shown result is the previous one.
 */
export function useKept<T>(value: T | undefined): { value: T | undefined; stale: boolean } {
  const [kept, setKept] = useState<T | undefined>(value);
  if (value !== undefined && value !== kept) setKept(value);
  return { value: value ?? kept, stale: value === undefined && kept !== undefined };
}
