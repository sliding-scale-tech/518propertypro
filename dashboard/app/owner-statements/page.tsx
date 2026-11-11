"use client";

import { Suspense } from "react";
import { FinanceGate } from "@/components/finance/finance-nav";
import { Spinner } from "@/components/finance/form-bits";
import { StatementsList } from "@/components/finance/statements-list";

export default function OwnerStatementsPage() {
  return (
    <FinanceGate>
      <Suspense fallback={<Spinner />}>
        <StatementsList />
      </Suspense>
    </FinanceGate>
  );
}
