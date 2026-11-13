"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatWhen } from "@/components/maintenance/shared";
import { Btn } from "@/components/ui";
import { errorMessage, useToast } from "@/components/ui/toast";

/**
 * The status line after a Sarah save (B43): the team's last push to the voice service, live.
 * "Saved. Updating Sarah…" → "Saved. Sarah updated", or "Saved, but Sarah couldn't be updated yet.
 * Retrying" with a Retry button. The text comes from convex/sarahPushLib.ts pushView.
 */
export function SarahPushStatus({ className = "" }: { className?: string }) {
  const s = useQuery(api.sarahPush.status);
  const retry = useMutation(api.sarahPush.retry);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!s || s.state === "none") return null;

  const onRetry = async () => {
    setBusy(true);
    try {
      await retry({});
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const bad = s.state === "retrying" || s.state === "failed";
  const icon =
    s.state === "updating" ? (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
    ) : bad ? (
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning-ink" aria-hidden />
    ) : (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success-ink" aria-hidden />
    );
  return (
    <span role="status" aria-live="polite" className={`inline-flex flex-wrap items-center gap-2 text-sm ${bad ? "text-warning-ink" : "text-muted-foreground"} ${className}`}>
      {icon}
      <span>
        {s.text}
        {s.state === "ok" && s.at ? <span className="text-muted-foreground"> · {formatWhen(s.at)}</span> : null}
      </span>
      {s.canRetry ? (
        <Btn sm onClick={() => void onRetry()} disabled={busy}>
          {busy ? "Retrying…" : "Retry"}
        </Btn>
      ) : null}
    </span>
  );
}
