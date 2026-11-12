"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { RequireView } from "@/components/require-view";
import { Seg } from "@/components/ui";

/**
 * Owner-statement (finance) section chrome: the admin/accountant gate and the Seg sub-nav
 * (Statements · Payments · Ledger · Owners · Accounts), spec 6.1. The gate only hides the pages; every
 * finance query and mutation re-checks access on the server (requireFinance).
 */

export type FinanceSection = "statements" | "payments" | "ledger" | "owners" | "accounts";

const HREF: Record<FinanceSection, string> = {
  statements: "/owner-statements",
  payments: "/owner-statements/payments",
  ledger: "/owner-statements/ledger",
  owners: "/owner-statements/owners",
  accounts: "/owner-statements/accounts",
};

export function FinanceNav({ active }: { active: FinanceSection }) {
  const router = useRouter();
  return (
    <div className="mb-5">
      <Seg<FinanceSection>
        label="Owner statements sections"
        value={active}
        onChange={(v) => {
          if (v !== active) router.push(HREF[v]);
        }}
        options={[
          { value: "statements", label: "Statements" },
          { value: "payments", label: "Payments" },
          { value: "ledger", label: "Ledger" },
          { value: "owners", label: "Owners" },
          { value: "accounts", label: "Accounts" },
        ]}
      />
    </div>
  );
}

/** Admin view + accountant only; everyone else is sent home by RequireView. */
export function FinanceGate({ children }: { children: ReactNode }) {
  return <RequireView views={["admin", "accountant"]}>{children}</RequireView>;
}

/** The time the page was opened, for business-date defaults (kept stable across renders). */
export function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}
