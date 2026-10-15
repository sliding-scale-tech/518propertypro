"use client";

import { useMutation, useQuery } from "convex/react";
import { PhoneMissed } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Btn, Card, CardHead, ListRow, IconTile } from "@/components/ui";
import { useToast } from "@/components/toast";
import { cleanError, timeAgo } from "@/components/maintenance/shared";

/** Failed / unclear calls that still need a human callback (admin dashboard). */
export function FollowUpCard() {
  const calls = useQuery(api.conversations.needsFollowUp);
  const markFollowedUp = useMutation(api.conversations.markFollowedUp);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function mark(id: Id<"conversations">) {
    setBusy(id);
    try {
      await markFollowedUp({ conversationId: id });
      toast("Marked as followed up.");
    } catch (e) {
      toast(cleanError(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHead
        title="Failed / unclear calls"
        icon={<PhoneMissed />}
        right={
          <Link href="/leads" className="font-medium text-primary hover:underline">
            View leads →
          </Link>
        }
      />
      {calls && calls.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-muted-foreground">No calls need a follow-up.</p>
      ) : (
        <div>
          {(calls ?? []).map((c, i) => (
            <ListRow
              key={c._id}
              first={i === 0}
              icon={
                <IconTile tone="warn">
                  <PhoneMissed />
                </IconTile>
              }
              title={c.callerNumber ?? "Unknown caller"}
              sub={`${c.status === "failed" ? "Failed" : "Unclear"} · ${timeAgo(c.startedAt)} ago${c.summary ? ` · ${c.summary}` : ""}`}
              right={
                <Btn sm disabled={busy === c._id} onClick={() => void mark(c._id)}>
                  Mark followed up
                </Btn>
              }
            />
          ))}
          {!calls ? <div className="h-4 w-full animate-pulse rounded bg-muted" /> : null}
        </div>
      )}
    </Card>
  );
}
