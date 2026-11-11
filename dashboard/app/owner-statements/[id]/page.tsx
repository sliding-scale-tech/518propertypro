"use client";

import { useParams } from "next/navigation";
import { FinanceGate } from "@/components/finance/finance-nav";
import { StatementPage } from "@/components/finance/statement-page";

export default function OwnerStatementPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FinanceGate>
      <StatementPage key={id} statementId={id} />
    </FinanceGate>
  );
}
