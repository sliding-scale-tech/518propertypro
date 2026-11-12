"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PAYMENTS_PATH } from "@/convex/rentPaymentsPolicy";

/**
 * Old link: the Payments page moved from /owner-statements/payments to /payments (Finance →
 * Payments). The filters in the query string (?month=&team=&owner=&property=&status=&q=&page=) are
 * kept. The target is finance-only (FinanceGate) and re-checked on the server.
 */
export default function OldPaymentsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`${PAYMENTS_PATH}${window.location.search}${window.location.hash}`);
  }, [router]);

  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <Loader2 aria-hidden className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
