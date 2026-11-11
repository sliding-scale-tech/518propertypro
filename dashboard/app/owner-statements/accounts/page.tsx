"use client";

import { FinanceGate } from "@/components/finance/finance-nav";
import { AccountsView } from "@/components/finance/accounts-view";

export default function AccountsPage() {
  return (
    <FinanceGate>
      <AccountsView />
    </FinanceGate>
  );
}
