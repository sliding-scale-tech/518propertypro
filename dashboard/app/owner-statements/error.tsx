"use client";

import Link from "next/link";
import { DevErrorDetails } from "@/components/dev-error-details";
import { errorMessage } from "@/components/ui/toast";

/**
 * Error boundary for every owner-statement page. A ConvexError from a finance query (for example
 * "Statement not found." or "You don't have access to owner statements.") is shown as is; anything
 * else gets the generic line (never a raw error message). In development only, the raw message,
 * digest and stack are shown under it (DevErrorDetails renders nothing in production).
 */
export default function OwnerStatementsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Couldn&apos;t open this page</h1>
      <p className="mt-2 text-[13.5px] text-muted-foreground">{errorMessage(error)}</p>
      <div className="mt-4 flex justify-center gap-4 text-[13.5px] font-medium">
        <button type="button" onClick={reset} className="text-primary hover:underline">
          Try again
        </button>
        <Link href="/owner-statements" className="text-primary hover:underline">
          Back to Owner statements
        </Link>
      </div>
      <DevErrorDetails error={error} />
    </div>
  );
}
