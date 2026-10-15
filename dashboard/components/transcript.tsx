"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type TranscriptLine = { _id: string; role: string; text: string };

/** Chat-bubble rendering shared by the Leads, Resident calls and Maintenance pages. */
export function Transcript({
  lines,
  emptyText = "No transcript recorded for this call.",
}: {
  lines?: TranscriptLine[];
  emptyText?: string;
}) {
  if (!lines?.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="space-y-3">
      {lines.map((line) => (
        <div key={line._id} className={line.role === "user" ? "text-right" : "text-left"}>
          <span
            className={`inline-block max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
              line.role === "user"
                ? "bg-secondary text-secondary-foreground"
                : "bg-accent text-accent-foreground"
            }`}
          >
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Fetches and renders the transcript for one conversation. */
export function ConversationTranscript({
  conversationId,
  emptyText,
}: {
  conversationId: Id<"conversations">;
  emptyText?: string;
}) {
  const lines = useQuery(api.conversations.transcript, { conversationId });
  if (lines === undefined) return <p className="text-sm text-muted-foreground">Loading transcript…</p>;
  return <Transcript lines={lines} emptyText={emptyText} />;
}
