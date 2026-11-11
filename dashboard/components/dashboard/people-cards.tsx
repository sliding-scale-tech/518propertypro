"use client";

import { HardHat, Shield } from "lucide-react";
import Link from "next/link";
import { Avatar, Card, CardHead, ListRow, Pill } from "@/components/ui";

type Am = { userId: string; name: string; units: number; toursThisWeek: number; toReview: number };
type Tech = { userId: string; name: string; skill: string | null; assigned: number; toSignOff: number };

export function AssetManagersCard({ rows }: { rows: Am[] | undefined }) {
  return (
    <Card>
      <CardHead
        title="Asset managers"
        icon={<Shield />}
        right={
          <Link href="/asset-managers" className="font-medium text-primary hover:underline">
            Manage →
          </Link>
        }
      />
      {rows && rows.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-muted-foreground">
          No asset managers yet.{" "}
          <Link href="/team" className="text-primary hover:underline">
            Add one in Team
          </Link>
          .
        </p>
      ) : (
        <div>
          {(rows ?? []).map((am, i) => (
            <Link key={am.userId} href={`/work-orders?lane=review&am=${encodeURIComponent(am.userId)}`} className="block">
              <ListRow
                first={i === 0}
                icon={<Avatar name={am.name} tone="acc" />}
                title={am.name}
                sub={`${am.units} units · ${am.toursThisWeek} tours this week`}
                right={<Pill tone={am.toReview > 0 ? "acc" : "neutral"}>{am.toReview} to review</Pill>}
              />
            </Link>
          ))}
          {!rows ? <div className="h-4 w-full animate-pulse rounded bg-muted" /> : null}
        </div>
      )}
    </Card>
  );
}

export function TechniciansCard({ rows }: { rows: Tech[] | undefined }) {
  return (
    <Card>
      <CardHead
        title="Technicians"
        icon={<HardHat />}
        right={
          <Link href="/technicians" className="font-medium text-primary hover:underline">
            Manage →
          </Link>
        }
      />
      {rows && rows.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-muted-foreground">No technicians on the team yet.</p>
      ) : (
        <div>
          {(rows ?? []).map((t, i) => (
            <ListRow
              key={t.userId}
              first={i === 0}
              icon={<Avatar name={t.name} tone="ok" />}
              title={t.name}
              sub={t.skill ?? "Technician"}
              right={
                <>
                  <Pill tone={t.assigned > 0 ? "warn" : "neutral"}>{t.assigned} assigned</Pill>
                  {t.toSignOff > 0 ? <Pill tone="ok">{t.toSignOff} to sign off</Pill> : null}
                </>
              }
            />
          ))}
          {!rows ? <div className="h-4 w-full animate-pulse rounded bg-muted" /> : null}
        </div>
      )}
    </Card>
  );
}
