"use client";

import { Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { RequireView } from "@/components/require-view";
import { Card, CardHead, IconTile, ListRow, PageHeader, Pill } from "@/components/ui";

const ITEMS = [
  {
    icon: Wallet,
    title: "Payments",
    body: "Track rent and payments received against each unit, and see what is outstanding at a glance.",
  },
];

export default function FinancePage() {
  const router = useRouter();
  const statements = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("view") === "statements",
    () => false,
  );
  // Old "Owner Reports" links (/finance?view=statements) now live at /owner-statements.
  useEffect(() => {
    if (statements) router.replace("/owner-statements");
  }, [statements, router]);

  return (
    <RequireView views={["admin"]}>
      <div className="pb-10">
        <PageHeader title="Payment" subtitle="Money tools for your properties." />
        <Card>
          <CardHead title="Coming soon" badge={<Pill tone="acc">Coming soon</Pill>} />
          {ITEMS.map(({ icon: Icon, title, body }, i) => (
            <div key={title} id="payments">
              <ListRow
                first={i === 0}
                icon={
                  <IconTile tone="acc">
                    <Icon />
                  </IconTile>
                }
                title={title}
                sub={<span className="block whitespace-normal">{body}</span>}
              />
            </div>
          ))}
        </Card>
      </div>
    </RequireView>
  );
}
