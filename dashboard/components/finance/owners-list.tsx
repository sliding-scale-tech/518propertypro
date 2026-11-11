"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Card, DataTable, PageHeader, Pill, Toggle, type Column } from "@/components/ui";
import { DefaultFeeButton, useDefaultFeeLine } from "./default-fee-dialog";
import { FinanceNav } from "./finance-nav";
import { LinkBtn, Spinner } from "./form-bits";
import { NeedsOwnerCard } from "./needs-owner";

type OwnerRow = FunctionReturnType<typeof api.owners.list>[number];

/** "adam@example.com" -> "a***@example.com" (the list never shows full addresses, spec 6.5). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** `/owner-statements/owners`: the rental owners (spec 6.5). */
export function OwnersList() {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const owners = useQuery(api.owners.list, { includeInactive: showInactive });
  const feeLine = useDefaultFeeLine();

  const columns: Column<OwnerRow>[] = [
    {
      key: "name",
      header: "Legal name",
      render: (o) => (
        <span className="font-medium">
          {o.legalName}
          {!o.active ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(inactive)</span> : null}
        </span>
      ),
    },
    { key: "contact", header: "Contact", render: (o) => o.contactName || <span className="text-faint">Not set</span> },
    {
      key: "emails",
      header: "Emails",
      render: (o) =>
        o.emails.length === 0 ? (
          <span className="text-faint">None</span>
        ) : (
          <span className="text-muted-foreground">{o.emails.map(maskEmail).join(", ")}</span>
        ),
    },
    {
      key: "fee",
      header: "Fee %",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      // The range of the owner's property fees (each property: its own fee, else the default).
      render: (o) => o.feeRange ?? <span className="text-faint">No properties</span>,
    },
    { key: "props", header: "Properties", align: "right", className: "tabular-nums", render: (o) => o.propertyCount },
    {
      key: "problems",
      header: "Problems",
      render: (o) =>
        o.problems.length === 0 && o.coOwnedPropertyNames.length === 0 ? (
          <span className="text-faint">None</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {o.problems.map((p) => (
              <Pill key={p} tone="bad">
                {p}
              </Pill>
            ))}
            {o.coOwnedPropertyNames.length > 0 ? (
              <Pill tone="warn" title={o.coOwnedPropertyNames.join(", ")}>
                {o.coOwnedPropertyNames.length} co-owned
              </Pill>
            ) : null}
          </div>
        ),
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Owners"
        subtitle={`Rental owners, their owner draw payee and linked properties.${feeLine ? ` ${feeLine}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <DefaultFeeButton />
            <LinkBtn href="/owner-statements/owners/new" primary className="!rounded-xl !px-3.5 !py-2 !text-[13.5px]">
              <UserPlus aria-hidden className="h-4 w-4" /> Add owner
            </LinkBtn>
          </div>
        }
      />
      <FinanceNav active="owners" />
      <NeedsOwnerCard />
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <Toggle checked={showInactive} label="Show inactive owners" onChange={setShowInactive} />
          <span className="text-[13px]">Show inactive owners</span>
        </div>
        {owners === undefined ? (
          <Spinner label="Loading owners…" />
        ) : (
          <DataTable
            caption="Owners"
            columns={columns}
            rows={owners}
            rowKey={(o) => o._id}
            onRowClick={(o) => router.push(`/owner-statements/owners/${o._id}`)}
            empty="No owners yet. Add one with “Add owner”, or import the owner list."
          />
        )}
      </Card>
    </div>
  );
}
