"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { MissingItem, PilotCard } from "@/convex/sarahConfigLib";
import { Btn, Card, Pill } from "@/components/ui";

/**
 * The "To finish" panel: only data that is truly missing (today: the gas utility phone number,
 * which is optional but recommended). Everything else is approved by the admin or decided with a
 * safe default, which sits in a short collapsed list. The server computes the progress.
 */

type Progress = { cards: PilotCard[]; done: number; total: number };

export function PilotPanel({
  items,
  progress,
  onOpen,
}: {
  items: MissingItem[];
  progress: Progress;
  onOpen: (id: string) => void;
}) {
  const [showDecided, setShowDecided] = useState(false);
  const gasDone = progress.cards.find((c) => c.id === "gas")?.done ?? false;
  const remaining = gasDone ? 0 : 1;
  const decided = items.filter((i) => i.decidedNote);

  return (
    <Card className="space-y-2">
      <div className="text-sm font-semibold">{remaining === 0 ? "To finish (0)" : `To finish (${remaining})`}</div>
      {remaining === 0 ? (
        <Pill tone="ok">
          <CheckCircle2 className="h-3.5 w-3.5" /> All set
        </Pill>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-48 flex-1 text-sm">Gas utility phone number (optional but recommended)</span>
          <Btn sm variant="pri" onClick={() => onOpen("utility-number")}>
            Add numbers
          </Btn>
        </div>
      )}

      {decided.length > 0 ? (
        <div className="border-t border-border pt-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            aria-expanded={showDecided}
            onClick={() => setShowDecided(!showDecided)}
          >
            {showDecided ? "Hide" : "Show"} Decided for you ({decided.length})
          </button>
          {showDecided ? (
            <ul className="divide-y divide-border">
              {decided.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-48 flex-1">{m.decidedNote}</span>
                  <button type="button" className="text-xs font-medium underline" onClick={() => onOpen(m.id)}>
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
