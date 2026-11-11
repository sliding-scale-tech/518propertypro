"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { errorMessage, useToast } from "@/components/toast";
import type { WoPriority } from "@/components/work-orders/shared";
import { TenantPreferredTime, WindowPicker, type WindowValue } from "@/components/work-orders/window-picker";
import { browserTimeZone } from "@/components/dashboard/format";
import { Btn, Card, CardHead, DatePicker, PageHeader, Select } from "@/components/ui";

const inputClass =
  "w-full rounded-xl border border-input bg-card px-[11px] py-2 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const areaClass = `${inputClass} leading-[1.45]`;

const ISSUE_TYPES = [
  "electrical",
  "water_leak",
  "broken_item",
  "gas",
  "fire",
  "flooding",
  "tenant_responsibility",
  "other",
];
const label = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

type Initial = {
  requestId?: Id<"maintenanceRequests">;
  unitId: string;
  issueType: string;
  title: string;
  scope: string;
  priority: WoPriority;
  accessNotes: string;
  /** The tenant's preferred times, shown beside the window picker. */
  preferredTimes?: string;
};

function NewWorkOrderInner() {
  const params = useSearchParams();
  const requestParam = params.get("request");
  const requestId = requestParam ? (requestParam as Id<"maintenanceRequests">) : undefined;

  const detail = useQuery(api.maintenance.get, requestId ? { requestId } : "skip");

  if (requestId) {
    if (detail === undefined) return <Spinner />;
    if (detail === null) {
      return (
        <div className="py-16 text-center text-sm text-muted-foreground">
          That request wasn&apos;t found.{" "}
          <Link href="/work-orders" className="text-primary hover:underline">
            Back to work orders
          </Link>
        </div>
      );
    }
    const r = detail.request;
    const sev = r.severity;
    const scopeLines = [r.description, ...r.answers.map((a) => `${a.question}: ${a.value}`)];
    const initial: Initial = {
      requestId: r._id,
      unitId: r.unitId ?? "",
      issueType: r.issueType,
      title: `${label(r.issueType)}: ${r.description.replace(/\s+/g, " ").slice(0, 80)}`,
      scope: scopeLines.join("\n"),
      priority: sev === "emergency" ? "emergency" : sev === "urgent" ? "urgent" : "routine",
      accessNotes: r.pets ? `Pets: ${r.pets}` : "",
      preferredTimes: r.preferredAccessTimes ?? undefined,
    };
    return <Form initial={initial} />;
  }

  return (
    <Form
      initial={{ unitId: "", issueType: "other", title: "", scope: "", priority: "routine", accessNotes: "" }}
    />
  );
}

function Spinner() {
  return (
    <div className="flex min-h-[40dvh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

function Form({ initial }: { initial: Initial }) {
  const router = useRouter();
  const toast = useToast();
  const create = useMutation(api.workOrders.create);

  const access = useQuery(api.team.myAccess);
  const team = useQuery(api.team.overview);
  const property = useQuery(api.properties.current);
  const units = useQuery(api.units.list, property ? { propertyId: property._id } : "skip");

  const [unitId, setUnitId] = useState(initial.unitId);
  const [issueType, setIssueType] = useState(initial.issueType);
  const [title, setTitle] = useState(initial.title);
  const [scope, setScope] = useState(initial.scope);
  const [priority, setPriority] = useState<WoPriority>(initial.priority);
  const [accessNotes, setAccessNotes] = useState(initial.accessNotes);
  const [technician, setTechnician] = useState("");
  const [req, setReq] = useState({ photos: true, hours: true, receipts: false, notes: false });
  const [due, setDue] = useState("");
  const [windowValue, setWindowValue] = useState<WindowValue | null>(null);
  const [techTouched, setTechTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pat gets a suggested technician (skill match, else least loaded); returns null for anyone else.
  const suggestion = useQuery(api.workOrders.suggestTechnician, { issueType });
  // Preselect the suggestion until Pat picks someone (or "Assign later") themselves.
  const technicianValue = techTouched ? technician : (suggestion?.userId ?? "");
  const technicians = (team?.members ?? []).filter((m) => m.appRole === "technician");
  // The server enforces ownership; this only keeps the picker honest for asset managers.
  const unitOptions = (units ?? []).filter((u) => access?.view === "admin" || u.isMine);
  const lockedUnit = !!initial.requestId && !!initial.unitId;

  const submit = async () => {
    setBusy(true);
    try {
      const id = await create({
        requestId: initial.requestId,
        unitId: unitId as Id<"units">,
        title,
        scope,
        priority,
        technicianUserId: technicianValue ? (technicianValue as Id<"users">) : undefined,
        accessNotes: accessNotes.trim() || undefined,
        requiredOnSubmit: req,
        dueDate: due ? new Date(`${due}T12:00:00`).getTime() : undefined,
        ...(windowValue ? { windowStart: windowValue.start, windowEnd: windowValue.end, fallbackTimeZone: browserTimeZone() } : {}),
      });
      toast("Work order created");
      router.push(`/work-orders/${id}`);
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(false);
    }
  };

  const field = "block space-y-1.5";
  const cap = "text-sm font-medium";

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10">
      <PageHeader
        title="New work order"
        subtitle={initial.requestId ? "Prefilled from the maintenance request. Review before creating." : undefined}
      />

      <Card className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>
            <span className={cap}>Unit</span>
            <Select value={unitId} disabled={lockedUnit} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Select a unit</option>
              {unitOptions.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.unitNumber}
                </option>
              ))}
            </Select>
          </label>
          <label className={field}>
            <span className={cap}>Priority</span>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as WoPriority)}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </Select>
          </label>
        </div>

        <label className={field}>
          <span className={cap}>Title</span>
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>

        <label className={field}>
          <span className={cap}>Scope of work</span>
          <textarea value={scope} maxLength={4000} rows={6} onChange={(e) => setScope(e.target.value)} className={areaClass} />
        </label>

        <label className={field}>
          <span className={cap}>Access notes</span>
          <textarea value={accessNotes} maxLength={1000} rows={3} onChange={(e) => setAccessNotes(e.target.value)} className={areaClass} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>
            <span className={cap}>Technician (optional)</span>
            <Select
              value={technicianValue}
              onChange={(e) => {
                setTechTouched(true);
                setTechnician(e.target.value);
              }}
            >
              <option value="">Assign later</option>
              {technicians.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                  {m.skill ? ` · ${m.skill}` : ""}
                </option>
              ))}
            </Select>
            {suggestion ? (
              <span className="block text-xs text-muted-foreground">
                Suggested: {suggestion.name}
                {suggestion.reason === "skill" ? " (skill match)" : " (fewest active jobs)"}
              </span>
            ) : null}
          </label>
          <label className={field}>
            <span className={cap}>Due date</span>
            <DatePicker value={due} onChange={setDue} className="h-10" />
          </label>
        </div>

        <label className={field}>
          <span className={cap}>Issue type</span>
          <Select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </Select>
        </label>

        <div className={field}>
          <span className={cap}>Time window</span>
          <WindowPicker variant="input" value={windowValue} onChange={setWindowValue} />
          <TenantPreferredTime value={initial.preferredTimes} />
        </div>
      </Card>

      <Card className="space-y-3">
        <CardHead title="Required when the technician submits" />
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {(["photos", "hours", "receipts", "notes"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={req[k]} onChange={(e) => setReq({ ...req, [k]: e.target.checked })} />
              {k[0].toUpperCase() + k.slice(1)}
            </label>
          ))}
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Link
          href="/work-orders"
          className="inline-flex items-center rounded-xl border border-border bg-card px-3.5 py-2 text-[13.5px] font-medium hover:bg-muted"
        >
          Cancel
        </Link>
        <Btn
          variant="pri"
          onClick={() => void submit()}
          disabled={busy || !unitId || !title.trim() || !scope.trim()}
        >
          {busy ? "Creating…" : "Create work order"}
        </Btn>
      </div>
    </div>
  );
}

export default function NewWorkOrderPage() {
  return (
    // Admin view only (any Admin, e.g. Pat or Alex, may create a work order directly). An asset
    // manager never creates a work order: their manual entries go to Pat as a request instead
    // (NewWorkOrderDrawer -> maintenance.createManual, always "Waiting on Pat").
    <RequireView views={["admin"]}>
      <Suspense fallback={<Spinner />}>
        <NewWorkOrderInner />
      </Suspense>
    </RequireView>
  );
}
