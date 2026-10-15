"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Check, Circle, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { useToast } from "@/components/toast";
import { ChecklistEditor, newDraftItem, toChecklistArgs, type ChecklistDraftItem } from "@/components/work-orders/checklist-editor";
import { FileGallery, MoneyCell, PriorityBadge, StatusPill, type WoPriority } from "@/components/work-orders/shared";

type Detail = NonNullable<FunctionReturnType<typeof api.workOrders.get>>;

const inputClass =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50";
const areaClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/20";

function errorText(err: unknown): string {
  if (err && typeof err === "object" && "data" in err && typeof err.data === "string") return err.data;
  if (err instanceof Error) return (err.message.match(/Uncaught Error: (.*?)(?:\n|$)/)?.[1] ?? err.message).slice(0, 200);
  return "Something went wrong. Try again.";
}

const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateInput = (ms?: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function OutlineButton({ children, danger, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40 ${
        danger ? "border-rose-200 text-rose-700" : "border-input bg-card"
      }`}
    >
      {children}
    </button>
  );
}

function WorkOrderDetailInner() {
  const { id } = useParams<{ id: string }>();
  const data = useQuery(api.workOrders.get, { workOrderId: id as Id<"workOrders"> });
  const team = useQuery(api.team.overview);

  if (data === undefined) {
    return (
      <div className="flex min-h-[40dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Work order not found.{" "}
        <Link href="/work-orders" className="text-primary hover:underline">
          Back to work orders
        </Link>
      </div>
    );
  }
  const names = new Map((team?.members ?? []).map((m) => [m.userId as string, m.name]));
  return <View data={data} names={names} technicians={(team?.members ?? []).filter((m) => m.appRole === "technician")} />;
}

function View({
  data,
  names,
  technicians,
}: {
  data: Detail;
  names: Map<string, string>;
  technicians: Array<{ userId: Id<"users">; name: string }>;
}) {
  const { workOrder: wo, viewerCan } = data;
  const toast = useToast();
  const reviewClose = useMutation(api.workOrders.reviewClose);
  const addNote = useMutation(api.workOrders.addNote);

  const [modal, setModal] = useState<null | "edit" | "reassign" | "cancel" | "sendback">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const active = wo.status === "created" || wo.status === "assigned" || wo.status === "in_progress";
  const photos = data.files.filter((f) => f.kind === "completion_photo");
  const receipts = data.files.filter((f) => f.kind === "receipt");
  const canNote = (viewerCan.manage && (active || wo.status === "completed")) || viewerCan.review;
  const who = (uid?: string) => (uid ? (names.get(uid) ?? "Team member") : "");

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      return true;
    } catch (err) {
      toast(errorText(err), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <Link href="/work-orders" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Work orders
      </Link>

      <header className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">WO-{wo.number}</h1>
              <StatusPill status={wo.status} />
              <PriorityBadge priority={wo.priority as WoPriority} />
            </div>
            <p className="text-base font-medium">{wo.title}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {viewerCan.manage && active ? <OutlineButton onClick={() => setModal("edit")}>Edit scope</OutlineButton> : null}
            {viewerCan.manage && active ? <OutlineButton onClick={() => setModal("reassign")}>Reassign</OutlineButton> : null}
            {viewerCan.manage && active ? (
              <OutlineButton danger onClick={() => setModal("cancel")}>
                Cancel
              </OutlineButton>
            ) : null}
            {viewerCan.review ? <OutlineButton onClick={() => setModal("sendback")}>Send back</OutlineButton> : null}
            {viewerCan.review ? (
              <PrimaryButton
                disabled={busy}
                onClick={() => void run(() => reviewClose({ workOrderId: wo._id }), "Work order closed")}
              >
                Review &amp; close
              </PrimaryButton>
            ) : null}
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Unit">
            {data.unit.unitNumber}
            {data.property ? ` · ${data.property.name}` : ""}
          </Meta>
          <Meta label="Technician">{data.technicianName ?? "Unassigned"}</Meta>
          <Meta label="Due">{wo.dueDate ? fmtDate(wo.dueDate) : "None"}</Meta>
          <Meta label="Request">
            {data.request ? (
              <Link href={`/maintenance/${data.request._id}`} className="text-primary hover:underline">
                MR-{data.request.number}
              </Link>
            ) : (
              "Manual"
            )}
          </Meta>
        </dl>
        {wo.status === "cancelled" && wo.cancelReason ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Cancelled: {wo.cancelReason}</p>
        ) : null}
      </header>

      <Section title="Scope">
        <p className="whitespace-pre-wrap text-sm">{wo.scope}</p>
        {wo.accessNotes ? (
          <div>
            <div className="text-xs font-medium text-muted-foreground">Access notes</div>
            <p className="whitespace-pre-wrap text-sm">{wo.accessNotes}</p>
          </div>
        ) : null}
      </Section>

      <Section
        title="Checklist"
        aside={
          <span className="text-sm tabular-nums text-muted-foreground">
            {wo.checklist.filter((c) => c.done).length}/{wo.checklist.length}
          </span>
        }
      >
        {wo.checklist.length === 0 ? <p className="text-sm text-muted-foreground">No checklist.</p> : null}
        <ul className="space-y-2">
          {wo.checklist.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              {c.done ? <Check className="mt-0.5 h-4 w-4 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
              <div>
                <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.label}</span>
                {c.required ? <span className="ml-1.5 text-[11px] text-muted-foreground">required</span> : null}
                {c.done && c.doneAt ? (
                  <div className="text-xs text-muted-foreground">
                    {who(c.doneBy)} · {fmtDateTime(c.doneAt)}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Completion photos">
        <FileGallery files={photos} label="Completion photo" emptyLabel="No photos yet." />
      </Section>

      <Section title="Receipts">
        <FileGallery files={receipts} label="Receipt" emptyLabel="No receipts yet." />
      </Section>

      <Section
        title="Hours"
        aside={<span className="text-sm font-medium tabular-nums">{data.totals.hours.toFixed(2)} h total</span>}
      >
        {data.time.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hours logged.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Technician</th>
                  <th className="py-2 text-right font-medium">Hours</th>
                  <th className="py-2 pl-4 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {data.time.map((t) => (
                  <tr key={t._id} className="border-t border-border/70">
                    <td className="py-2">{t.date}</td>
                    <td className="py-2">{who(t.technicianUserId)}</td>
                    <td className="py-2 text-right tabular-nums">{t.hours}</td>
                    <td className="py-2 pl-4 text-muted-foreground">{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Materials and expenses"
        aside={<MoneyCell cents={data.totals.expenseCents} className="text-sm font-medium" />}
      >
        {data.expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No materials or expenses.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Description</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((e) => (
                  <tr key={e._id} className="border-t border-border/70">
                    <td className="py-2">{e.description}</td>
                    <td className="py-2 capitalize">{e.kind}</td>
                    <td className="py-2 text-right tabular-nums">{e.quantity ?? ""}</td>
                    <td className="py-2 text-right">
                      <MoneyCell cents={e.amountCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Notes">
        {data.notes.length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : null}
        <ul className="space-y-3">
          {data.notes.map((n) => (
            <li key={n._id} className="rounded-lg bg-muted/30 px-3 py-2 text-sm">
              <div className="text-xs text-muted-foreground">
                {who(n.authorUserId)} · {fmtDateTime(n.createdAt)}
              </div>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
        {canNote ? (
          <div className="flex gap-2">
            <textarea
              value={note}
              maxLength={2000}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note"
              aria-label="Add a note"
              className={areaClass}
            />
            <PrimaryButton
              disabled={busy || !note.trim()}
              onClick={() =>
                void run(() => addNote({ workOrderId: wo._id, body: note }), "Note added").then((ok) => {
                  if (ok) setNote("");
                })
              }
            >
              Add
            </PrimaryButton>
          </div>
        ) : null}
      </Section>

      {data.audit.length > 0 ? (
        <Section title="Timeline">
          <ul className="space-y-2">
            {data.audit.map((a) => (
              <li key={a._id} className="text-sm">
                <span className="font-medium">{a.actorLabel}</span>{" "}
                <span className="text-muted-foreground">{a.action.replace(/_/g, " ")}</span>
                {a.note ? <span className="text-muted-foreground"> — {a.note}</span> : null}
                <span className="ml-2 text-xs text-muted-foreground">{fmtDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {modal === "edit" ? <EditScopeModal data={data} onClose={() => setModal(null)} /> : null}
      {modal === "reassign" ? <ReassignModal data={data} technicians={technicians} onClose={() => setModal(null)} /> : null}
      {modal === "cancel" ? <ReasonModal wo={wo._id} mode="cancel" onClose={() => setModal(null)} /> : null}
      {modal === "sendback" ? <ReasonModal wo={wo._id} mode="sendback" onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function ReasonModal({ wo, mode, onClose }: { wo: Id<"workOrders">; mode: "cancel" | "sendback"; onClose: () => void }) {
  const toast = useToast();
  const cancel = useMutation(api.workOrders.cancel);
  const sendBack = useMutation(api.workOrders.sendBack);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const isCancel = mode === "cancel";

  const go = async () => {
    setBusy(true);
    try {
      if (isCancel) await cancel({ workOrderId: wo, reason: text });
      else await sendBack({ workOrderId: wo, note: text });
      toast(isCancel ? "Work order cancelled" : "Sent back to the technician");
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal title={isCancel ? "Cancel work order" : "Send back"} onClose={onClose}>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{isCancel ? "Reason" : "What is missing or needs fixing?"}</span>
        <textarea value={text} rows={4} maxLength={isCancel ? 500 : 1000} onChange={(e) => setText(e.target.value)} className={areaClass} />
      </label>
      <div className="flex justify-end gap-2">
        <OutlineButton onClick={onClose}>Back</OutlineButton>
        <PrimaryButton disabled={busy || !text.trim()} onClick={() => void go()}>
          {isCancel ? "Cancel work order" : "Send back"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function ReassignModal({
  data,
  technicians,
  onClose,
}: {
  data: Detail;
  technicians: Array<{ userId: Id<"users">; name: string }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const assign = useMutation(api.workOrders.assign);
  const [tech, setTech] = useState<string>(data.workOrder.technicianUserId ?? "");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await assign({ workOrderId: data.workOrder._id, technicianUserId: tech as Id<"users"> });
      toast("Technician updated");
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal title={data.workOrder.technicianUserId ? "Reassign technician" : "Assign technician"} onClose={onClose}>
      <select value={tech} onChange={(e) => setTech(e.target.value)} className={inputClass} aria-label="Technician">
        <option value="">Select a technician</option>
        {technicians.map((t) => (
          <option key={t.userId} value={t.userId}>
            {t.name}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <OutlineButton onClick={onClose}>Back</OutlineButton>
        <PrimaryButton disabled={busy || !tech || tech === data.workOrder.technicianUserId} onClick={() => void go()}>
          Save
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function EditScopeModal({ data, onClose }: { data: Detail; onClose: () => void }) {
  const wo = data.workOrder;
  const toast = useToast();
  const editScope = useMutation(api.workOrders.editScope);
  const [title, setTitle] = useState(wo.title);
  const [scope, setScope] = useState(wo.scope);
  const [priority, setPriority] = useState<WoPriority>(wo.priority);
  const [accessNotes, setAccessNotes] = useState(wo.accessNotes ?? "");
  const [due, setDue] = useState(dateInput(wo.dueDate));
  const [items, setItems] = useState<ChecklistDraftItem[]>(() => wo.checklist.map((c) => newDraftItem(c.label, c.required)));
  const [req, setReq] = useState(wo.requiredOnSubmit);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const originalDue = dateInput(wo.dueDate);
      await editScope({
        workOrderId: wo._id,
        title,
        scope,
        priority,
        accessNotes,
        checklist: toChecklistArgs(items),
        requiredOnSubmit: req,
        ...(due !== originalDue
          ? due
            ? { dueDate: new Date(`${due}T12:00:00`).getTime() }
            : { clearDueDate: true }
          : {}),
      });
      toast("Scope updated");
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit scope" onClose={onClose}>
      {wo.technicianUserId ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The technician will be notified of these changes.
        </p>
      ) : null}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Title</span>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Scope</span>
        <textarea value={scope} rows={5} maxLength={4000} onChange={(e) => setScope(e.target.value)} className={areaClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Access notes</span>
        <textarea value={accessNotes} rows={2} maxLength={1000} onChange={(e) => setAccessNotes(e.target.value)} className={areaClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as WoPriority)} className={inputClass}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Due date</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Checklist</span>
        <ChecklistEditor items={items} onChange={setItems} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {(["photos", "hours", "receipts", "notes"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={req[k]} onChange={(e) => setReq({ ...req, [k]: e.target.checked })} />
            Require {k}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <OutlineButton onClick={onClose}>Back</OutlineButton>
        <PrimaryButton disabled={busy || !title.trim() || !scope.trim()} onClick={() => void save()}>
          Save changes
        </PrimaryButton>
      </div>
    </Modal>
  );
}

export default function WorkOrderDetailPage() {
  return (
    <RequireView views={["admin", "asset_manager", "accountant"]}>
      <WorkOrderDetailInner />
    </RequireView>
  );
}
