"use client";

import { AlertOctagon, AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, cx } from "@/components/ui";
import { revealSection, warningTarget, type WarningLinkInput } from "./warning-links";

type Warning = WarningLinkInput;

/**
 * Draft warnings (spec 6.3 item 1): blocking items in red under "Fix before finalizing", info items
 * in amber under "Check". A warning with a place to fix it gets a link there (warning-links.ts):
 * the owner page section, the work order, or the Payments page (rent not marked received).
 */
export function WarningsCard({ blocking, info, ownerId }: { blocking: Warning[]; info: Warning[]; ownerId: string }) {
  if (blocking.length === 0 && info.length === 0) return null;
  return (
    <Card className="flex flex-col gap-4">
      {blocking.length > 0 ? (
        <Group
          tone="bad"
          title="Fix before finalizing"
          icon={<AlertOctagon aria-hidden className="h-4 w-4" />}
          items={blocking}
          ownerId={ownerId}
        />
      ) : null}
      {info.length > 0 ? (
        <Group tone="warn" title="Check" icon={<AlertTriangle aria-hidden className="h-4 w-4" />} items={info} ownerId={ownerId} />
      ) : null}
    </Card>
  );
}

function Group({
  tone,
  title,
  icon,
  items,
  ownerId,
}: {
  tone: "bad" | "warn";
  title: string;
  icon: ReactNode;
  items: Warning[];
  ownerId: string;
}) {
  return (
    <div
      className={cx(
        "rounded-2xl border px-4 py-3",
        tone === "bad" ? "border-danger-ink/30 bg-danger-soft" : "border-warning-ink/30 bg-warning-soft",
      )}
    >
      <h3
        className={cx(
          "mb-2 flex items-center gap-2 text-[13.5px] font-semibold",
          tone === "bad" ? "text-danger-ink" : "text-warning-ink",
        )}
      >
        {icon}
        {title}
        <span className="font-normal">({items.length})</span>
      </h3>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-foreground">
        {items.map((w, i) => (
          <li key={`${w.code}-${i}`}>
            {w.message} <FixLink warning={w} ownerId={ownerId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const FIX_LINK =
  "ml-1 inline-flex items-center rounded-[10px] border border-border bg-card px-2 py-[2px] text-[12px] font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function FixLink({ warning, ownerId }: { warning: Warning; ownerId: string }) {
  const target = warningTarget(warning, ownerId);
  if (target === null) return null;
  if (target.kind === "scroll") {
    return (
      <button type="button" className={FIX_LINK} onClick={() => revealSection(target.anchor)}>
        {target.label}
      </button>
    );
  }
  return (
    <Link href={target.href} className={FIX_LINK}>
      {target.label}
    </Link>
  );
}
