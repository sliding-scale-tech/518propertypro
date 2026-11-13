"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { FinanceGate } from "@/components/finance/finance-nav";
import { Spinner } from "@/components/finance/form-bits";
import { StatementPage } from "@/components/finance/statement-page";

export default function OwnerStatementPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FinanceGate>
      {/* The statement keeps its step in the URL (useSearchParams). */}
      <Suspense fallback={<Spinner label="Building the statement…" />}>
        <StatementPage key={id} statementId={id} />
      </Suspense>
    </FinanceGate>
  );
}
