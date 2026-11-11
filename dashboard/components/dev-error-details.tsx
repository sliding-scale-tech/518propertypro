"use client";

import { toast } from "@/components/ui/toast";

/**
 * Development only: the raw error behind an error boundary (message, digest, stack) with a
 * "Copy error" button. Renders nothing in production, so no message or stack ever reaches users there.
 */
export function DevErrorDetails({ error }: { error: Error & { digest?: string } }) {
  if (process.env.NODE_ENV === "production") return null;

  const text = [
    `${error.name || "Error"}: ${error.message || "(no message)"}`,
    error.digest ? `Digest: ${error.digest}` : null,
    error.stack ? `\n${error.stack}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Error copied.");
    } catch {
      toast.error("Couldn't copy the error. Select the text and copy it instead.");
    }
  }

  return (
    <div className="mt-6 w-full rounded-2xl border border-danger-ink/30 bg-danger-soft px-4 py-3 text-left text-[12.5px] text-danger-ink">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold">Development details</span>
        <button type="button" onClick={() => void copy()} className="ml-auto font-medium text-primary hover:underline">
          Copy error
        </button>
      </div>
      <p className="break-words font-mono">
        {error.name || "Error"}: {error.message || "(no message)"}
      </p>
      {error.digest ? <p className="mt-1 font-mono">Digest: {error.digest}</p> : null}
      {error.stack ? (
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">Stack trace</summary>
          <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px]">{error.stack}</pre>
        </details>
      ) : null}
    </div>
  );
}
