"use client";

import { useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Card, Timeline, cx } from "@/components/ui";
import { Spinner } from "./form-bits";
import { formatStamp } from "./months";

const ACTION_LABEL: Record<string, string> = {
  draft_created: "Draft created",
  line_excluded: "Line left off this statement",
  line_included: "Line put back on this statement",
  adjustments_changed: "Adjustments changed",
  generated_changed: "Management fee or owner draw changed",
  finalized: "Finalized",
  discarded: "Draft discarded",
  pdf_downloaded: "PDF downloaded",
  rent_checked: "Confirmed the rent lines",
  rent_unchecked: "Unticked the rent confirmation",
  rent_check_cleared: "Rent confirmation cleared by a change",
  rent_line_changed: "Edited a rent line",
  rent_line_reset: "Reset a rent line to the roster",
};

function describe(r: { action: string; note: string | null }): string {
  const label = ACTION_LABEL[r.action] ?? r.action.replace(/_/g, " ");
  if (r.action === "generated_changed") {
    if (r.note === "fee") return "Management fee changed";
    if (r.note === "draw") return "Owner draw changed";
  }
  return r.note ? `${label}: ${r.note}` : label;
}

/** Collapsed History card (spec 6.3 item 5): ownerStatements.history, loaded when opened. */
export function HistoryCard({ statementId }: { statementId: string }) {
  const [open, setOpen] = useState(false);
  const rows = useQuery(api.ownerStatements.history, open ? { statementId } : "skip");
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left text-[15px] font-semibold"
      >
        History
        <ChevronDown aria-hidden className={cx("ml-auto h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-4">
          {rows === undefined ? (
            <Spinner label="Loading history…" className="py-4" />
          ) : rows.length === 0 ? (
            <p className="text-[12.5px] text-faint">No history yet.</p>
          ) : (
            <Timeline
              entries={[...rows].reverse().map((r) => ({
                id: r._id,
                text: describe(r),
                time: `${r.actorLabel ?? "System"} · ${formatStamp(r.at)}`,
              }))}
            />
          )}
        </div>
      ) : null}
    </Card>
  );
}
