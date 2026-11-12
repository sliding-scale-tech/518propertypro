"use client";

import { Suspense } from "react";
import { FinanceGate } from "@/components/finance/finance-nav";
import { Spinner } from "@/components/finance/form-bits";
import { PaymentsView } from "@/components/finance/payments-view";

/** Finance → Payments: rent payments (admin view + accountant only; every query and mutation re-checks on the server). */
export default function RentPaymentsPage() {
  return (
    <FinanceGate>
      <Suspense fallback={<Spinner />}>
        <PaymentsView />
      </Suspense>
    </FinanceGate>
  );
}
