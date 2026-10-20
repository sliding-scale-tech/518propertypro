"use client";

import { useMutation, useQuery } from "convex/react";
import { Mail, Phone, PhoneIncoming } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "@/components/ui/toast";
import { Avatar, Card, CardHead, Chips, Pill, Select } from "@/components/ui";

type Status = "open" | "called_back" | "closed";
type Filter = "all" | Status;

const STATUS_LABEL: Record<Status, string> = { open: "Open", called_back: "Called back", closed: "Closed" };
const STATUS_TONE = { open: "warn", called_back: "ok", closed: "neutral" } as const;
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * Callbacks from callers Sarah couldn't match to a unit. leads.callbacks scopes server-side:
 * admins see all, asset managers only their own. Phone/email are rendered as links only after
 * being reduced to safe characters (no raw caller text goes into an href).
 */
export function CallbacksList() {
  const [filter, setFilter] = useState<Filter>("open");
  const rows = useQuery(api.leads.callbacks, filter === "all" ? {} : { status: filter });
  const setStatus = useMutation(api.leads.setCallbackStatus);
  const [busyId, setBusyId] = useState<string | null>(null);

  const change = async (id: Id<"callbackContacts">, status: Status) => {
    setBusyId(id);
    try {
      await setStatus({ id, status });
      toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHead
        title="Callbacks"
        icon={<PhoneIncoming />}
        hint="Callers Sarah could not match to a unit. Call them back, then update the status."
      />
      <div className="mb-4">
        <Chips<Filter>
          label="Filter by status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: "Open" },
            { value: "called_back", label: "Called back" },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {rows === undefined ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading callbacks…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {filter === "open" ? "No callbacks waiting. Nice." : "No callbacks match this filter."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const tel = r.callbackNumber?.replace(/[^\d+]/g, "") ?? "";
            const email = r.callerEmail && EMAIL.test(r.callerEmail) ? r.callerEmail : null;
            return (
              <li key={r.id} className="rounded-2xl border border-border px-4 py-3.5">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {r.callerName ?? "Unknown caller"}
                      <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                      {r.callbackNumber ? (
                        <a
                          href={tel ? `tel:${tel}` : undefined}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5" aria-hidden />
                          {r.callbackNumber}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No number given</span>
                      )}
                      {email ? (
                        <a
                          href={`mailto:${email}`}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <Mail className="h-3.5 w-3.5" aria-hidden />
                          {email}
                        </a>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm">{r.issueSummary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Why unmatched: {r.reason}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {r.assignedName ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar name={r.assignedName} size="sm" />
                          {r.assignedToMe ? "You" : r.assignedName.split(" ")[0]}
                        </span>
                      ) : (
                        <Pill>Unassigned</Pill>
                      )}
                      <time dateTime={new Date(r.createdAt).toISOString()}>
                        {new Date(r.createdAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                  </div>
                  <div className="w-full sm:w-[150px]">
                    <Select
                      value={r.status}
                      aria-label={`Status for ${r.callerName ?? "caller"}`}
                      disabled={busyId === r.id}
                      onChange={(e) => void change(r.id, e.target.value as Status)}
                    >
                      <option value="open">Open</option>
                      <option value="called_back">Called back</option>
                      <option value="closed">Closed</option>
                    </Select>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
