"use client";

import { Receipt, Wallet } from "lucide-react";
import { RequireView } from "@/components/require-view";

const CARDS = [
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
      <div className="space-y-6 pb-10">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Finance</h1>
          <p className="mt-1 text-xs text-muted-foreground">Money tools for your properties.</p>
        </header>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {CARDS.map(({ icon: Icon, title, body }) => (
            <section key={title} className="rounded-2xl border border-border/90 bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  Coming soon
                </span>
              </div>
              <h2 className="mt-4 text-sm font-semibold text-foreground">{title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{body}</p>
            </section>
          ))}
        </div>
      </div>
    </RequireView>
  );
}
