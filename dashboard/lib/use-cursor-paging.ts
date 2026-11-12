"use client";

import { useState } from "react";
import { DEFAULT_PAGE_SIZE } from "@/components/ui";
import { FIRST_PAGE, cursorOf, goToPage, pageOf, rowsBeforeOf, type CursorState, type PageInfo } from "./cursor-paging";

/**
 * State for a cursor-paged list with the shared <Pagination> (cursor mode): the cursor to query
 * with, the page number, the rows on earlier pages and the page size. `reset` goes back to page 1
 * (call it when a filter or search changes); a new page size starts again at page 1.
 */
export function useCursorPaging(initialSize: number = DEFAULT_PAGE_SIZE) {
  const [state, setState] = useState<CursorState>(FIRST_PAGE);
  const [pageSize, setPageSizeState] = useState(initialSize);
  return {
    cursor: cursorOf(state),
    page: pageOf(state),
    rowsBefore: rowsBeforeOf(state),
    pageSize,
    reset: () => setState(FIRST_PAGE),
    setPageSize: (n: number) => {
      setPageSizeState(n);
      setState(FIRST_PAGE);
    },
    /** For <Pagination onPage>: `info` describes the page currently shown. */
    goTo: (target: number, info: PageInfo) => setState((s) => goToPage(s, target, info)),
  };
}
