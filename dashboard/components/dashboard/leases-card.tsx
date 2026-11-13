"use client";

import { useQuery } from "convex/react";
import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Card, CardHead, ListRow, IconTile, Pill } from "@/components/ui";
import { LeaseFollowUpActions, LeaseTagPill } from "@/components/residents/lease-dialogs";

const RESIDENTS = "/tenants?tab=residents";

/**
 * "Leases ending soon" (B44): active residents whose lease has ended or ends within 60 days, on
 * the viewer's units (an asset manager: the units they manage; an admin: every unit). Scope is
 * enforced by leases.attention. An open lease follow-up shows its one-click answers here.
 */
export function LeasesCard() {
  const data = useQuery(api.leases.attention);
  if (data === null) return null;

  return (
    <Card>
      <CardHead
        title="Leases ending soon"
        icon={<CalendarClock />}
        hint="Ended, or ending in the next 60 days."
        right={
          <Link href={`${RESIDENTS}&lease=ending_60&sort=lease`} className="font-medium text-primary hover:underline">
            View residents →
          </Link>
        }
      />
      {data === undefined ? (
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      ) : data.total === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-muted-foreground">No leases ended or ending in the next 60 days.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            {data.ended > 0 ? (
              <Link href={`${RESIDENTS}&lease=ended&sort=lease`}>
                <Pill tone="bad" dot>
                  {data.ended} ended
                </Pill>
              </Link>
            ) : null}
            {data.endingSoon > 0 ? (
              <Link href={`${RESIDENTS}&lease=ending_60&sort=lease`}>
                <Pill tone="warn" dot>
                  {data.endingSoon} ending in 60 days
                </Pill>
              </Link>
            ) : null}
          </div>
          <div>
            {data.rows.map((r, i) => (
              <ListRow
                key={r._id}
                first={i === 0}
                icon={
                  <IconTile tone={r.tag === "ended" ? "bad" : "warn"}>
                    <CalendarClock />
                  </IconTile>
                }
                title={
                  <Link href={`/residents/${r._id}`} className="hover:text-primary hover:underline">
                    {r.fullName}
                  </Link>
                }
                sub={`${r.unitLabel} · ${r.tag === "ended" ? "ended" : "ends"} ${r.leaseEndLabel}`}
                right={
                  r.openFollowUpTaskId && r.canResolveLease ? (
                    <LeaseFollowUpActions target={r} canMoveOut={r.canMoveOut} />
                  ) : (
                    <LeaseTagPill tag={r.tag} />
                  )
                }
              />
            ))}
          </div>
          {data.total > data.rows.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing {data.rows.length} of {data.total}.{" "}
              <Link href={`${RESIDENTS}&lease=ended&sort=lease`} className="font-medium text-primary hover:underline">
                See ended
              </Link>{" "}
              ·{" "}
              <Link href={`${RESIDENTS}&lease=ending_60&sort=lease`} className="font-medium text-primary hover:underline">
                See ending soon
              </Link>
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
