"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { errorMessage, useToast } from "@/components/toast";
import { WorkOrderFormat, woStage } from "@/components/work-orders/format";
import { BillingBlock, CloseBillForm } from "@/components/work-orders/close-bill-form";
import type { WoPriority } from "@/components/work-orders/shared";
import { TenantPreferredTime, WindowPicker, type WindowValue } from "@/components/work-orders/window-picker";
import { tenantPreferredTimeText } from "@/convex/workOrderWindow";
import { browserTimeZone } from "@/components/dashboard/format";
import { Btn, Card, CardHead, DatePicker, DrawerSection, Pill, Select, SevChip, Modal as UiModal } from "@/components/ui";

type Detail = NonNullable<FunctionReturnType<typeof api.workOrders.get>>;

const inputClass =
  "w-full rounded-xl border border-input bg-card px-[11px] py-2 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const areaClass = `${inputClass} leading-[1.45]`;

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateInput = (ms?: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Staff photo / video upload for a work order (managers while active or awaiting sign-off). */
function AddMedia({ workOrderId }: { workOrderId: Id<"workOrders"> }) {
  const genUrl = useMutation(api.workOrders.generateUploadUrl);
  const attach = useMutation(api.workOrders.attachFile);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: File[]) {
    setUploading(true);
    let saved = 0;
    try {
      for (const file of files) {
        try {
          const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
          const isVideo = ["video/mp4", "video/webm", "video/quicktime"].includes(file.type);
          const reject = (why: string) => toast(`${file.name}: ${why}`, "error");
          if (!isImage && !isVideo) {
            reject("Choose a photo or an mp4, webm or mov video.");
            continue;
          }
          if (file.size > (isVideo ? 50 : 10) * 1024 * 1024) {
            reject(isVideo ? "Videos can be at most 50 MB." : "Photos can be at most 10 MB.");
            continue;
          }
          const url = await genUrl({ workOrderId });
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
          if (!res.ok) {
            reject("Upload failed.");
            continue;
          }
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          const result = await attach({ workOrderId, storageId, kind: isVideo ? "completion_video" : "completion_photo" });
          if (!result.ok) {
            reject(result.error);
            continue;
          }
          saved += 1;
        } catch (e) {
          toast(`${file.name}: ${errorMessage(e, "Upload failed.")}`, "error");
        }
      }
      if (saved > 0) toast(saved === 1 ? "File added." : `${saved} files added.`);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length > 0) void upload(picked);
        }}
      />
      <Btn variant="default" disabled={uploading} onClick={() => input.current?.click()}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Add photos / videos
      </Btn>
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card className="space-y-3">
      <CardHead title={title} right={aside} />
      {children}
    </Card>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <UiModal title={title} onClose={onClose} size="lg">
      <div className="space-y-4">{children}</div>
    </UiModal>
  );
}

function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Btn variant="pri" {...rest}>
      {children}
    </Btn>
  );
}

function OutlineButton({ children, danger, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <Btn variant={danger ? "dng" : "default"} {...rest}>
      {children}
    </Btn>
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
  return <View data={data} technicians={(team?.members ?? []).filter((m) => m.appRole === "technician")} />;
}

function View({
  data,
  technicians,
}: {
  data: Detail;
  technicians: Array<{ userId: Id<"users">; name: string }>;
}) {
  const { workOrder: wo, viewerCan } = data;
  const toast = useToast();
  const addNote = useMutation(api.workOrders.addNote);

  const [modal, setModal] = useState<null | "edit" | "reassign" | "cancel" | "sendback" | "close" | "billing">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const active = wo.status === "created" || wo.status === "assigned" || wo.status === "in_progress";
  const stage = woStage(wo);
  const req = useQuery(api.maintenance.get, data.request ? { requestId: data.request._id } : "skip");
  // The work order's own copy; a work order older than that field reads its request.
  const preferredTime = tenantPreferredTimeText(wo.tenantPreferredTime ?? req?.request.preferredAccessTimes);
  const canNote = (viewerCan.manage && (active || wo.status === "completed")) || viewerCan.review;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      return true;
    } catch (err) {
      toast(errorMessage(err), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <Link href="/work-orders" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Work orders
      </Link>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">WO-{wo.number}</span>
              <SevChip level={wo.priority as WoPriority} score={req?.request.severityScore ?? undefined} />
              <Pill tone={stage.tone}>{stage.label}</Pill>
            </div>
            <h1 className="text-xl font-semibold leading-snug">{wo.title}</h1>
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
              <PrimaryButton disabled={busy} onClick={() => setModal("close")}>
                Review &amp; close
              </PrimaryButton>
            ) : null}
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <Meta label="Due">{wo.dueDate ? fmtDate(wo.dueDate) : "None"}</Meta>
          <Meta label="Time window">{wo.window ? <Pill tone="acc">{wo.window}</Pill> : "Not set"}</Meta>
          {preferredTime ? <Meta label="Tenant's preferred time">{preferredTime}</Meta> : null}
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
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">Cancelled: {wo.cancelReason}</p>
        ) : null}
      </Card>

      <Card className="space-y-5">
        <WorkOrderFormat
          r={req ?? null}
          w={data}
          evidenceAlways
          afterRequest={
            <DrawerSection title="Scope">
              <p className="whitespace-pre-wrap text-[13.5px]">{wo.scope}</p>
              {wo.accessNotes ? (
                <div className="mt-2">
                  <div className="text-xs font-medium text-muted-foreground">Access notes</div>
                  <p className="whitespace-pre-wrap text-[13.5px]">{wo.accessNotes}</p>
                </div>
              ) : null}
            </DrawerSection>
          }
          photosNote="You can't add photos to this item."
          photosAction={viewerCan.attach ? <AddMedia workOrderId={wo._id} /> : null}
        />
      </Card>

      {data.billing && wo.status === "reviewed_closed" ? (
        <Section title="Billing">
          <BillingBlock billing={data.billing} onEdit={() => setModal("billing")} />
        </Section>
      ) : null}

      {canNote ? (
        <Section title="Add a note">
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
        </Section>
      ) : null}


      {modal === "edit" ? <EditScopeModal data={data} preferredTime={preferredTime} onClose={() => setModal(null)} /> : null}
      {modal === "reassign" ? <ReassignModal data={data} technicians={technicians} onClose={() => setModal(null)} /> : null}
      {modal === "cancel" ? <ReasonModal wo={wo._id} mode="cancel" onClose={() => setModal(null)} /> : null}
      {modal === "sendback" ? <ReasonModal wo={wo._id} mode="sendback" onClose={() => setModal(null)} /> : null}
      {(modal === "close" && viewerCan.review) || (modal === "billing" && data.billing?.canEdit) ? (
        <Modal title={modal === "close" ? `Close WO-${wo.number}` : `Edit billing for WO-${wo.number}`} onClose={() => setModal(null)}>
          <CloseBillForm
            mode={modal === "close" ? "close" : "edit"}
            workOrderId={wo._id}
            woNumber={wo.number}
            billing={data.billing}
            suggestedDescription={data.expensesTab?.technicianExpenseNote ?? null}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
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
      toast(errorMessage(err), "error");
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
      toast(errorMessage(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal title={data.workOrder.technicianUserId ? "Reassign technician" : "Assign technician"} onClose={onClose}>
      <Select value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Technician">
        <option value="">Select a technician</option>
        {technicians.map((t) => (
          <option key={t.userId} value={t.userId}>
            {t.name}
          </option>
        ))}
      </Select>
      <div className="flex justify-end gap-2">
        <OutlineButton onClick={onClose}>Back</OutlineButton>
        <PrimaryButton disabled={busy || !tech || tech === data.workOrder.technicianUserId} onClick={() => void go()}>
          Save
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function EditScopeModal({ data, preferredTime, onClose }: { data: Detail; preferredTime?: string; onClose: () => void }) {
  const wo = data.workOrder;
  const toast = useToast();
  const editScope = useMutation(api.workOrders.editScope);
  const [title, setTitle] = useState(wo.title);
  const [scope, setScope] = useState(wo.scope);
  const [priority, setPriority] = useState<WoPriority>(wo.priority);
  const [accessNotes, setAccessNotes] = useState(wo.accessNotes ?? "");
  const [due, setDue] = useState(dateInput(wo.dueDate));
  const savedWindow: WindowValue | null =
    wo.windowStart !== undefined && wo.windowEnd !== undefined ? { start: wo.windowStart, end: wo.windowEnd } : null;
  const [windowValue, setWindowValue] = useState<WindowValue | null>(savedWindow);
  const [windowCleared, setWindowCleared] = useState(false);
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
        requiredOnSubmit: req,
        // Only sent when it changed so the audit trail stays clean.
        ...(windowValue
          ? windowValue.start !== savedWindow?.start || windowValue.end !== savedWindow?.end
            ? { windowStart: windowValue.start, windowEnd: windowValue.end, fallbackTimeZone: browserTimeZone() }
            : {}
          : windowCleared
            ? { clearWindow: true }
            : {}),
        ...(due !== originalDue
          ? due
            ? { dueDate: new Date(`${due}T12:00:00`).getTime() }
            : { clearDueDate: true }
          : {}),
      });
      toast("Scope updated");
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit scope" onClose={onClose}>
      {wo.technicianUserId ? (
        <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-ink">
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
          <Select value={priority} onChange={(e) => setPriority(e.target.value as WoPriority)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Due date</span>
          <DatePicker value={due} onChange={setDue} className="h-10" />
        </label>
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Time window</span>
        <WindowPicker
          variant="input"
          value={windowValue}
          legacyLabel={windowCleared ? null : wo.window}
          onChange={(next) => {
            setWindowValue(next);
            setWindowCleared(next === null);
          }}
        />
        <TenantPreferredTime value={preferredTime} />
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
