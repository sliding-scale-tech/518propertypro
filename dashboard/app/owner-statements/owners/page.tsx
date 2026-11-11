"use client";

import { FinanceGate } from "@/components/finance/finance-nav";
import { OwnersList } from "@/components/finance/owners-list";

export default function OwnersPage() {
  return (
    <FinanceGate>
      <OwnersList />
    </FinanceGate>
  );
}
