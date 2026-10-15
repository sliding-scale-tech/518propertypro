"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { useToast } from "@/components/toast";
import {
  ChecklistEditor,
  newDraftItem,
  toChecklistArgs,
  type ChecklistDraftItem,
} from "@/components/work-orders/checklist-editor";
import type { WoPriority } from "@/components/work-orders/shared";

const inputClass =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50";
const areaClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/20";

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

function errorText(err: unknown): string {
  if (err && typeof err === "object" && "data" in err && typeof err.data === "string") return err.data;
  if (err instanceof Error) return (err.message.match(/Uncaught Error: (.*?)(?:\n|$)/)?.[1] ?? err.message).slice(0, 200);
  return "Something went wrong. Try again.";
}

type Initial = {
  requestId?: Id<"maintenanceRequests">;
  unitId: string;
  issueType: string;
  title: string;
  scope: string;
  priority: WoPriority;
  accessNotes: string;
  checklist: string[];
};

function NewWorkOrderInner() {
  const params = useSearchParams();
  const requestParam = params.get("request");
  const requestId = requestParam ? (requestParam as Id<"maintenanceRequests">) : undefined;

  const detail = useQuery(api.maintenance.get, requestId ? { requestId } : "skip");
  const issueType = detail?.request.issueType;
  const template = useQuery(api.workOrders.checklistFor, issueType ? { issueType } : "skip");

  if (requestId) {
    if (detail === undefined || (issueType && template === undefined)) return <Spinner />;
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
    const access = [r.pets ? `Pets: ${r.pets}` : "", r.preferredAccessTimes ? `Preferred times: ${r.preferredAccessTimes}` : ""]
      .filter(Boolean)
      .join("\n");
    const initial: Initial = {
      requestId: r._id,
      unitId: r.unitId ?? "",
      issueType: r.issueType,
      title: `${label(r.issueType)}: ${r.description.replace(/\s+/g, " ").slice(0, 80)}`,
      scope: scopeLines.join("\n"),
      priority: sev === "emergency" ? "emergency" : sev === "urgent" ? "urgent" : "routine",
      accessNotes: access,
      checklist: template ?? [],
    };
    return <Form initial={initial} />;
  }

  return (
    <Form
      initial={{ unitId: "", issueType: "other", title: "", scope: "", priority: "routine", accessNotes: "", checklist: [] }}
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
  const saveTemplate = useMutation(api.workOrders.saveChecklistTemplate);

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
  const [items, setItems] = useState<ChecklistDraftItem[]>(() => initial.checklist.map((l) => newDraftItem(l)));
  const [technician, setTechnician] = useState("");
  const [req, setReq] = useState({ photos: true, hours: true, receipts: false, notes: false });
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const typeTemplate = useQuery(api.workOrders.checklistFor, { issueType });
  const canTemplate = access?.canManageMaintenance ?? false;
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
        checklist: toChecklistArgs(items),
        technicianUserId: technician ? (technician as Id<"users">) : undefined,
        accessNotes: accessNotes.trim() || undefined,
        requiredOnSubmit: req,
        dueDate: due ? new Date(`${due}T12:00:00`).getTime() : undefined,
      });
      toast("Work order created");
      router.push(`/work-orders/${id}`);
    } catch (err) {
      toast(errorText(err), "error");
      setBusy(false);
    }
  };

  const doSaveTemplate = async () => {
    try {
      await saveTemplate({ issueType, items: toChecklistArgs(items).map((i) => i.label) });
      toast(`Template saved for ${label(issueType)}`);
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const field = "block space-y-1.5";
  const cap = "text-sm font-medium";

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">New work order</h1>
        {initial.requestId ? (
          <p className="mt-1 text-sm text-muted-foreground">Prefilled from the maintenance request. Review before creating.</p>
        ) : null}
      </header>

      <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>
            <span className={cap}>Unit</span>
            <select value={unitId} disabled={lockedUnit} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
              <option value="">Select a unit</option>
              {unitOptions.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.unitNumber}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span className={cap}>Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as WoPriority)} className={inputClass}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </select>
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
            <select value={technician} onChange={(e) => setTechnician(e.target.value)} className={inputClass}>
              <option value="">Assign later</option>
              {technicians.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span className={cap}>Due date</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} />
          </label>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold">Checklist</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Issue type"
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
            >
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!typeTemplate}
              onClick={() => typeTemplate && setItems(typeTemplate.map((l) => newDraftItem(l)))}
              className="h-9 rounded-lg border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-40"
            >
              Load template
            </button>
          </div>
        </div>
        <ChecklistEditor items={items} onChange={setItems} />
        {canTemplate ? (
          <button
            type="button"
            onClick={() => void doSaveTemplate()}
            disabled={toChecklistArgs(items).length === 0}
            className="text-sm font-medium text-primary hover:underline disabled:opacity-40"
          >
            Save checklist as template for {label(issueType)}
          </button>
        ) : null}
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">Required when the technician submits</h2>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {(["photos", "hours", "receipts", "notes"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={req[k]} onChange={(e) => setReq({ ...req, [k]: e.target.checked })} />
              {k[0].toUpperCase() + k.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Link href="/work-orders" className="rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-accent">
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !unitId || !title.trim() || !scope.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create work order"}
        </button>
      </div>
    </div>
  );
}

export default function NewWorkOrderPage() {
  return (
    <RequireView views={["admin", "asset_manager"]}>
      <Suspense fallback={<Spinner />}>
        <NewWorkOrderInner />
      </Suspense>
    </RequireView>
  );
}
