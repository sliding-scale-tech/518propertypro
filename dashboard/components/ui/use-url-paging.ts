"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { DEFAULT_PAGE_SIZE, readPage, readPageSize } from "./pagination-model";

/**
 * Page and page size kept in the URL (`?page=` / `?size=`, or `?{prefix}page=` / `?{prefix}size=`
 * when one page has two paged lists), for the shared <Pagination>. Page 1 and the default size
 * are left out of the URL. The page using it needs a <Suspense> boundary (useSearchParams).
 */
export function useUrlPaging(prefix = "") {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pageKey = `${prefix}page`;
  const sizeKey = `${prefix}size`;
  const page = readPage(params.get(pageKey));
  const pageSize = readPageSize(params.get(sizeKey));

  const set = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  return {
    page,
    pageSize,
    setPage: (p: number) => set({ [pageKey]: p > 1 ? String(p) : "" }),
    /** A new page size starts again at page 1. */
    setPageSize: (n: number) => set({ [sizeKey]: n === DEFAULT_PAGE_SIZE ? "" : String(n), [pageKey]: "" }),
    /** Back to page 1 (call when a filter changes). */
    resetPage: () => set({ [pageKey]: "" }),
  };
}
