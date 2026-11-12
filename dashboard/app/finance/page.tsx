"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Old Finance links: `/finance` (the "Payment" placeholder) now lives at the Payments page
 * `/owner-statements/payments`, and `/finance?view=statements` ("Owner Reports") at
 * `/owner-statements`. Both targets are finance-only (FinanceGate) and re-checked on the server.
 */
export default function FinancePage() {
  const router = useRouter();
  useEffect(() => {
    const statements = new URLSearchParams(window.location.search).get("view") === "statements";
    router.replace(statements ? "/owner-statements" : "/owner-statements/payments");
  }, [router]);

  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <Loader2 aria-hidden className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
