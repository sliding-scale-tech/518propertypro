"use client";

import { Receipt, Wallet } from "lucide-react";
import { RequireView } from "@/components/require-view";
import { Card, CardHead, IconTile, ListRow, PageHeader, Pill } from "@/components/ui";

const ITEMS = [
  {
    icon: Wallet,
    title: "Payments",
    body: "Track rent and payments received against each unit, and see what is outstanding at a glance.",
  },
  {
    icon: Receipt,
    title: "Owner statements (ROS)",
    body: "Monthly owner statements assembled from closed work orders, reviewed by the accountant and finalized for delivery.",
  },
];

export default function FinancePage() {
  return (
    <RequireView views={["admin"]}>
      <div className="pb-10">
        <PageHeader title="Finance" subtitle="Money tools for your properties." />
        <Card>
          <CardHead title="Coming soon" badge={<Pill tone="acc">Coming soon</Pill>} />
          {ITEMS.map(({ icon: Icon, title, body }, i) => (
            <ListRow
              key={title}
              first={i === 0}
              icon={
                <IconTile tone="acc">
                  <Icon />
                </IconTile>
              }
              title={title}
              sub={<span className="block whitespace-normal">{body}</span>}
            />
          ))}
        </Card>
      </div>
    </RequireView>
  );
}
