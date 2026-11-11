"use client";

import { FinanceGate } from "@/components/finance/finance-nav";
import { LedgerView } from "@/components/finance/ledger-view";

export default function OwnerLedgerPage() {
  return (
    <FinanceGate>
      <LedgerView />
    </FinanceGate>
  );
}
