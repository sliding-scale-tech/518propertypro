"use client";

import { Suspense } from "react";
import { FinanceGate } from "@/components/finance/finance-nav";
import { Spinner } from "@/components/finance/form-bits";
import { OwnersList } from "@/components/finance/owners-list";

export default function OwnersPage() {
  return (
    <FinanceGate>
      {/* The list keeps its page in the URL (useSearchParams). */}
      <Suspense fallback={<Spinner />}>
        <OwnersList />
      </Suspense>
    </FinanceGate>
  );
}
