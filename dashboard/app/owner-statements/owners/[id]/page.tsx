"use client";

import { useParams } from "next/navigation";
import { FinanceGate } from "@/components/finance/finance-nav";
import { OwnerEdit } from "@/components/finance/owner-edit";

/** `/owner-statements/owners/new` creates an owner; any other id edits that owner. */
export default function OwnerEditPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FinanceGate>
      <OwnerEdit key={id} ownerId={id === "new" ? null : id} />
    </FinanceGate>
  );
}
