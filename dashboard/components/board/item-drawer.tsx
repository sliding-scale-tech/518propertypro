"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Clock, HardHat, ImageIcon, Send, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OUT_OF_SCOPE_REASONS } from "@/convex/maintenanceReasons";
import { ConversationTranscript } from "@/components/transcript";
import { errorMessage } from "@/components/tech/lib";
import { useToast } from "@/components/toast";
import {
  ActBox,
  ActButtons,
  Btn,
  Checklist,
  Drawer,
  DrawerSection,
  Field,
  Input,
  KeyValue,
  PhotoGrid,
  Pill,
  Select,
  SevChip,
  Textarea,
  Timeline,
  WaitNote,
  type Tone,
} from "@/components/ui";
import type { ItemRef } from "./board";
import { auditText, fmtDateTime, fmtMoney, hoursText, issueLabel, mrId, priorityOf, WINDOW_PRESETS, woId } from "./shared";

type ReqDetail = NonNullable<FunctionReturnType<typeof api.maintenance.get>>;
type WoDetail = NonNullable<FunctionReturnType<typeof api.workOrders.get>>;
type View = "admin" | "asset_manager" | "technician" | "accountant" | undefined;

function useRun() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run, toast };
}

function requestStage(r: ReqDetail["request"], leadName: string): { label: string; tone: Tone } {
  switch (r.status) {
    case "new":
    case "under_review":
      return { label: "Asset manager review", tone: "acc" };
    case "more_info_needed":
      return { label: "Photos requested", tone: "warn" };
    case "forwarded_to_pat":
      return { label: `Waiting on ${leadName}`, tone: "vio" };
    case "work_order_created":
      return { label: "Work order created", tone: "ok" };
    default:
      return { label: "Rejected", tone: "bad" };
  }
}

function woStage(w: WoDetail["workOrder"]): { label: string; tone: Tone } {
  switch (w.status) {
    case "completed":
      return { label: "Completed · needs sign-off", tone: "ok" };
    case "reviewed_closed":
      return { label: "Closed", tone: "neutral" };
    case "cancelled":
      return { label: "Cancelled", tone: "bad" };
    default:
      return { label: "With technician", tone: "warn" };
  }
}

function CoveringNote({ d }: { d: ReqDetail }) {
  return (
    <WaitNote icon={<Clock />}>
      You&apos;re covering this unit while {d.assignedAssetManagerName ?? "the asset manager"} is out. Read only.
    </WaitNote>
  );
}

// --- Request actions -------------------------------------------------------------------

function RejectForm({ mode, d, onCancel }: { mode: "am" | "lead"; d: ReqDetail; onCancel: () => void }) {
  const { busy, run, toast } = useRun();
  const closeOutOfScope = useMutation(api.maintenance.closeOutOfScope);
  const closeNoWorkOrder = useMutation(api.maintenance.closeNoWorkOrder);
  const [reason, setReason] = useState<string>(OUT_OF_SCOPE_REASONS[0]);
  const [custom, setCustom] = useState("");
  const [notify, setNotify] = useState(false);
  const approved = d.tenantMessages.outOfScope;
  const finalReason = reason === "Other" ? custom.trim() : reason;

  return (
    <ActBox lead="Reject this request" icon={<X />}>
      <Field label="Reason">
        <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
          {OUT_OF_SCOPE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </Field>
      {reason === "Other" ? (
        <Input
          value={custom}
          maxLength={450}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Say why"
          aria-label="Other reason"
        />
      ) : null}
      {approved ? (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Text the tenant the approved out-of-scope message
        </label>
      ) : (
        <p className="text-xs text-muted-foreground">
          The tenant will not be texted: the out-of-scope wording is not approved in Sarah config.
        </p>
      )}
      <ActButtons>
        <Btn
          variant="dng"
          disabled={busy || !finalReason}
          onClick={() =>
            run(async () => {
              const args = { requestId: d.request._id, reason: finalReason, notifyTenant: approved && notify };
              const res = mode === "am" ? await closeOutOfScope(args) : await closeNoWorkOrder(args);
              if (res.notified) toast(`${mrId(d.request.number)} rejected. Tenant notified.`);
              else if (args.notifyTenant) toast(`Rejected. Tenant not notified: ${res.reason ?? "no reason given"}`, "info");
              else if (!approved) toast("Reason recorded. Tenant not notified (wording not approved).", "info");
              else toast(`${mrId(d.request.number)} rejected.`);
            })
          }
        >
          Reject request
        </Btn>
        <Btn onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
      </ActButtons>
    </ActBox>
  );
}

function ReviewActions({ d, view, leadName }: { d: ReqDetail; view: View; leadName: string }) {
  const { busy, run, toast } = useRun();
  const approve = useMutation(api.maintenance.approveAndForward);
  const requestInfo = useMutation(api.maintenance.requestInfo);
  const [rejecting, setRejecting] = useState(false);
  const photoOk = d.tenantMessages.photoRequest;
  const waitingPhotos = d.request.status === "more_info_needed";

  if (d.isCovering) return <CoveringNote d={d} />;
  if (!d.canAct) {
    return (
      <WaitNote icon={<Clock />}>Waiting on {d.assignedAssetManagerName ?? "the asset manager"} to review.</WaitNote>
    );
  }
  if (rejecting) return <RejectForm mode="am" d={d} onCancel={() => setRejecting(false)} />;

  return (
    <ActBox
      lead={view === "admin" ? "Asset manager review" : "Your review"}
      icon={<Send />}
      note={
        waitingPhotos
          ? "Sarah texted the tenant an upload link. Photos will appear here when they reply."
          : photoOk
            ? "Asking for photos makes Sarah text the tenant an upload link."
            : "Photo requests are off until the wording is approved in Sarah config."
      }
    >
      {view === "admin" && d.assignedAssetManagerName ? (
        <p className="-mt-1.5 text-xs text-muted-foreground">Normally {d.assignedAssetManagerName}.</p>
      ) : null}
      <ActButtons>
        <Btn
          variant="pri"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await approve({ requestId: d.request._id });
              toast(`${mrId(d.request.number)} sent to ${leadName}.`);
            })
          }
        >
          Approve &amp; send to {leadName}
        </Btn>
        {!waitingPhotos ? (
          <span title={photoOk ? undefined : "Approve the photo-request wording in Sarah config first."}>
            <Btn
              disabled={busy || !photoOk}
              onClick={() =>
                run(async () => {
                  const res = await requestInfo({
                    requestId: d.request._id,
                    note: "Asked the tenant for photos or a short video.",
                    sendPhotoLink: true,
                  });
                  if (res.texted) toast("Sarah texted the tenant an upload link.");
                  else toast(`Photos requested. Tenant not texted: ${res.reason ?? "unknown reason"}`, "info");
                })
              }
            >
              Ask tenant for photos
            </Btn>
          </span>
        ) : null}
        <Btn variant="dng" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </Btn>
      </ActButtons>
    </ActBox>
  );
}

function CreateWoBox({ d, onReject, onSendBack }: { d: ReqDetail; onReject: () => void; onSendBack: () => void }) {
  const { busy, run, toast } = useRun();
  const create = useMutation(api.workOrders.create);
  const team = useQuery(api.team.overview);
  const suggest = useQuery(api.workOrders.suggestTechnician, { issueType: d.request.issueType });
  const template = useQuery(api.workOrders.checklistFor, { issueType: d.request.issueType });
  const [techChoice, setTechChoice] = useState<string | null>(null);
  const [windowText, setWindowText] = useState(d.request.preferredAccessTimes ?? "");
  const [checklistEdit, setChecklistEdit] = useState<string | null>(null);

  const technicians = (team?.members ?? []).filter((m) => m.appRole === "technician");
  const techId = techChoice ?? suggest?.userId ?? "";
  const checklistText = checklistEdit ?? (template ?? []).join("\n");
  const r = d.request;

  if (!r.unitId) {
    return <WaitNote icon={<Clock />}>This request has no unit yet. Resolve it from the routing banner first.</WaitNote>;
  }
  const unitId = r.unitId;

  const submit = () =>
    run(async () => {
      const lines = checklistText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const scope = [r.description, ...r.answers.map((a) => `${a.question}: ${a.value}`)].join("\n").slice(0, 4000);
      const access = [r.pets ? `Pets: ${r.pets}` : "", r.preferredAccessTimes ? `Preferred times: ${r.preferredAccessTimes}` : ""]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1000);
      await create({
        requestId: r._id,
        unitId,
        title: `${issueLabel(r.issueType)}: ${r.description.replace(/\s+/g, " ")}`.slice(0, 200),
        scope,
        priority: priorityOf(r.severity),
        checklist: lines.map((label) => ({ label, required: true })),
        technicianUserId: techId ? (techId as Id<"users">) : undefined,
        accessNotes: access || undefined,
        requiredOnSubmit: { photos: true, hours: true, receipts: false, notes: false },
        window: windowText.trim() || undefined,
      });
      const tech = technicians.find((t) => t.userId === techId);
      toast(tech ? `Work order created. ${tech.name} notified.` : "Work order created.");
    });

  return (
    <ActBox lead="Create the work order" icon={<Wrench />}>
      <Field
        label="Technician"
        hint={suggest && techChoice === null ? `Suggested: ${suggest.reason === "skill" ? "skill match" : "least loaded"}` : undefined}
      >
        <Select value={techId} onChange={(e) => setTechChoice(e.target.value)} aria-label="Technician">
          <option value="">Unassigned</option>
          {technicians.map((t) => (
            <option key={t.userId} value={t.userId}>
              {t.name}
              {t.skill ? ` · ${t.skill}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Time window">
        <Input
          value={windowText}
          maxLength={100}
          onChange={(e) => setWindowText(e.target.value)}
          placeholder="e.g. Tomorrow, 9–11 AM"
          aria-label="Time window"
        />
        <div className="flex flex-wrap gap-1.5">
          {WINDOW_PRESETS.map((p) => (
            <Btn key={p} sm onClick={() => setWindowText(p)}>
              {p}
            </Btn>
          ))}
        </div>
      </Field>
      <Field label="Checklist (one item per line)">
        <Textarea value={checklistText} onChange={(e) => setChecklistEdit(e.target.value)} aria-label="Checklist" />
      </Field>
      <ActButtons>
        <Btn variant="pri" disabled={busy} onClick={submit}>
          Create &amp; assign
        </Btn>
        <Btn variant="dng" disabled={busy} onClick={onReject}>
          Reject
        </Btn>
        <Btn disabled={busy} onClick={onSendBack}>
          Send back to asset manager
        </Btn>
      </ActButtons>
    </ActBox>
  );
}

function SendBackBox({
  lead,
  noteLabel,
  cta,
  onSubmit,
  onCancel,
}: {
  lead: string;
  noteLabel: string;
  cta: string;
  onSubmit: (note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { busy, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <ActBox lead={lead}>
      <Field label={noteLabel}>
        <Textarea value={note} maxLength={900} onChange={(e) => setNote(e.target.value)} aria-label={noteLabel} />
      </Field>
      <ActButtons>
        <Btn variant="pri" disabled={busy || !note.trim()} onClick={() => run(() => onSubmit(note.trim()))}>
          {cta}
        </Btn>
        <Btn disabled={busy} onClick={onCancel}>
          Cancel
        </Btn>
      </ActButtons>
    </ActBox>
  );
}

function AddNoteBox({ d, lead }: { d: ReqDetail; lead: string }) {
  const { busy, run, toast } = useRun();
  const addNote = useMutation(api.maintenance.addNote);
  const [note, setNote] = useState("");
  return (
    <ActBox lead={lead}>
      <Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} aria-label={lead} />
      <ActButtons>
        <Btn
          variant="pri"
          disabled={busy || !note.trim()}
          onClick={() =>
            run(async () => {
              await addNote({ requestId: d.request._id, note: note.trim() });
              setNote("");
              toast("Note saved.");
            })
          }
        >
          Save note
        </Btn>
      </ActButtons>
    </ActBox>
  );
}

function WithdrawBox({ d }: { d: ReqDetail }) {
  const { busy, run, toast } = useRun();
  const withdraw = useMutation(api.maintenance.withdrawFromPat);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) {
    return (
      <div>
        <Btn disabled={busy} onClick={() => setOpen(true)}>
          Withdraw to my review
        </Btn>
      </div>
    );
  }
  return (
    <ActBox lead="Withdraw to my review">
      <Field label="Note (optional)">
        <Textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} aria-label="Withdraw note" />
      </Field>
      <ActButtons>
        <Btn
          variant="pri"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await withdraw({ requestId: d.request._id, note: note.trim() || undefined });
              toast("Withdrawn. It is back in your review.");
            })
          }
        >
          Confirm withdraw
        </Btn>
        <Btn disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Btn>
      </ActButtons>
    </ActBox>
  );
}

function LeadActions({ d, leadName }: { d: ReqDetail; leadName: string }) {
  const sendBack = useMutation(api.maintenance.sendBackToAM);
  const toast = useToast();
  const [mode, setMode] = useState<"main" | "reject" | "sendback">("main");
  if (d.isCovering) return <CoveringNote d={d} />;
  if (!d.canManage) {
    return (
      <>
        <WaitNote icon={<Clock />}>Approved. Waiting on {leadName} to create the work order.</WaitNote>
        {d.canWithdraw ? <WithdrawBox d={d} /> : null}
        {d.canAddNote ? <AddNoteBox d={d} lead={`Add a note for ${leadName}`} /> : null}
      </>
    );
  }
  if (mode === "reject") return <RejectForm mode="lead" d={d} onCancel={() => setMode("main")} />;
  if (mode === "sendback") {
    return (
      <SendBackBox
        lead="Send back to the asset manager"
        noteLabel="What does the asset manager need to do?"
        cta="Send back"
        onCancel={() => setMode("main")}
        onSubmit={async (note) => {
          await sendBack({ requestId: d.request._id, note });
          toast("Sent back to the asset manager.");
        }}
      />
    );
  }
  return (
    <>
      <CreateWoBox d={d} onReject={() => setMode("reject")} onSendBack={() => setMode("sendback")} />
      {d.canAddNote ? <AddNoteBox d={d} lead="Add a note for the asset manager" /> : null}
    </>
  );
}

function RequestActions({ d, view, leadName }: { d: ReqDetail; view: View; leadName: string }) {
  const s = d.request.status;
  if (s === "new" || s === "under_review" || s === "more_info_needed") {
    return <ReviewActions d={d} view={view} leadName={leadName} />;
  }
  if (s === "forwarded_to_pat") return <LeadActions d={d} leadName={leadName} />;
  if (s === "work_order_created") {
    return (
      <WaitNote icon={<Wrench />}>
        Work order created
        {d.workOrder ? `: ${woId(d.workOrder.number)}` : ""}.
      </WaitNote>
    );
  }
  return (
    <WaitNote icon={<X />}>
      {s === "closed_duplicate" ? "Closed as a duplicate." : "Rejected."}
      {d.request.closeReason ? ` ${d.request.closeReason}` : ""}
    </WaitNote>
  );
}

// --- Work order actions ----------------------------------------------------------------

function WoActions({ w, leadName, covering }: { w: WoDetail; leadName: string; covering: boolean }) {
  const { busy, run, toast } = useRun();
  const close = useMutation(api.workOrders.reviewClose);
  const sendBack = useMutation(api.workOrders.sendBack);
  const [sending, setSending] = useState(false);
  const wo = w.workOrder;
  const tech = w.technicianName ?? "The technician";
  if (covering) {
    return (
      <WaitNote icon={<Clock />}>
        You&apos;re covering this unit while its asset manager is out. Read only.
      </WaitNote>
    );
  }

  if (wo.status === "completed") {
    if (!w.viewerCan.review) {
      return <WaitNote icon={<Clock />}>Completed. {leadName} is reviewing the evidence.</WaitNote>;
    }
    if (sending) {
      return (
        <SendBackBox
          lead={`Send back to ${tech}`}
          noteLabel="What is missing?"
          cta="Send back"
          onCancel={() => setSending(false)}
          onSubmit={async (note) => {
            await sendBack({ workOrderId: wo._id, note });
            toast("Sent back to the technician.");
          }}
        />
      );
    }
    return (
      <ActBox lead="Review the completion" icon={<Check />} note="Approving closes the work order with its hours and materials.">
        <ActButtons>
          <Btn
            variant="pri"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await close({ workOrderId: wo._id });
                toast(`${woId(wo.number)} closed.`);
              })
            }
          >
            Approve completion
          </Btn>
          <Btn disabled={busy} onClick={() => setSending(true)}>
            Send back to {tech.split(" ")[0]}
          </Btn>
        </ActButtons>
      </ActBox>
    );
  }
  if (wo.status === "reviewed_closed") {
    return <WaitNote icon={<Check />}>Closed{wo.closedAt ? ` ${fmtDateTime(wo.closedAt)}` : ""}.</WaitNote>;
  }
  if (wo.status === "cancelled") {
    return <WaitNote icon={<X />}>Cancelled.{wo.cancelReason ? ` ${wo.cancelReason}` : ""}</WaitNote>;
  }
  if (!wo.technicianUserId) {
    return <WaitNote icon={<HardHat />}>Not assigned to a technician yet. Open the full page to assign one.</WaitNote>;
  }
  const done = wo.checklist.filter((c) => c.done).length;
  return (
    <WaitNote icon={<HardHat />}>
      {tech} has this on their phone{wo.window ? ` · ${wo.window}` : ""}. {done} of {wo.checklist.length} checklist items
      done.
    </WaitNote>
  );
}

// --- Drawer ----------------------------------------------------------------------------

export function ItemDrawer({
  item,
  open,
  onClose,
  leadName,
}: {
  item: ItemRef | null;
  open: boolean;
  onClose: () => void;
  leadName: string;
}) {
  const access = useQuery(api.team.myAccess);
  const view = access?.view as View;
  const requestArg = item?.kind === "request" ? (item.id as Id<"maintenanceRequests">) : undefined;
  const woArg = item?.kind === "work_order" ? (item.id as Id<"workOrders">) : undefined;
  const wo = useQuery(api.workOrders.get, woArg ? { workOrderId: woArg } : "skip");
  const linkedRequest = requestArg ?? wo?.request?._id;
  const req = useQuery(api.maintenance.get, linkedRequest ? { requestId: linkedRequest } : "skip");

  const primary = item?.kind === "request" ? req : wo;
  if (!item || !primary) {
    const missing = item !== null && primary === null;
    return (
      <Drawer open={open} onClose={onClose} title={missing ? "Not found" : "Loading…"}>
        <p className="text-sm text-muted-foreground">
          {missing ? "This item doesn't exist or you don't have access to it." : "Loading…"}
        </p>
      </Drawer>
    );
  }

  const r = req ?? null;
  const w = item.kind === "work_order" ? (wo ?? null) : null;
  const stage = w ? woStage(w.workOrder) : r ? requestStage(r.request, leadName) : { label: "", tone: "neutral" as Tone };
  const idLabel = w ? woId(w.workOrder.number) : r ? mrId(r.request.number) : "";
  const title = w ? w.workOrder.title : (r?.request.description ?? "");
  const level = w ? w.workOrder.priority : (r?.request.severity ?? "routine");
  const score = r?.request.severityScore;

  const property = w ? w.property : r?.property;
  const unitNo = w ? w.unit.unitNumber : (r?.unit?.unitNumber ?? r?.request.spokenUnit);
  const tenant = r?.request.callerName ?? r?.resident?.fullName;

  const kv: Array<{ label: ReactNode; value: ReactNode }> = [
    { label: "Property", value: `${property?.name ?? "Unknown"}${unitNo ? ` · ${unitNo}` : ""}` },
    { label: "Tenant", value: tenant ?? "—" },
    { label: "Category", value: r ? issueLabel(r.request.issueType) : "—" },
    { label: "Asset manager", value: r?.assignedAssetManagerName ?? "—" },
  ];
  if (w?.technicianName) kv.push({ label: "Technician", value: w.technicianName });
  if (w?.workOrder.window) kv.push({ label: "Window", value: w.workOrder.window });
  kv.push({ label: "Created", value: fmtDateTime(w ? w.workOrder.createdAt : (r?.request.createdAt ?? 0)) });

  const photos = (r?.media ?? []).filter((m) => m.kind === "photo");
  const videos = (r?.media ?? []).filter((m) => m.kind === "video" && m.url);

  const showEvidence = !!w && (w.workOrder.status === "completed" || w.workOrder.status === "reviewed_closed");
  const audit = [...(r?.audit ?? []), ...(w?.audit ?? [])].sort((a, b) => a.at - b.at);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      eyebrow={
        <>
          <span className="font-mono">{idLabel}</span>
          <SevChip level={level} score={score ?? undefined} />
          <Pill tone={stage.tone}>{stage.label}</Pill>
        </>
      }
    >
      {w ? <WoActions w={w} leadName={leadName} covering={!!r?.isCovering} /> : r ? <RequestActions d={r} view={view} leadName={leadName} /> : null}

      <DrawerSection title="Request">
        <KeyValue items={kv} />
      </DrawerSection>

      {r?.conversation?.summary ? (
        <DrawerSection title="Sarah's summary">
          <p className="text-[13.5px]">{r.conversation.summary}</p>
        </DrawerSection>
      ) : null}

      {r?.conversation ? (
        <DrawerSection title="From the call">
          <div className="max-h-72 overflow-y-auto rounded-[14px] bg-muted px-3.5 py-3">
            <ConversationTranscript conversationId={r.conversation._id} />
          </div>
        </DrawerSection>
      ) : null}

      {photos.length > 0 || videos.length > 0 ? (
        <DrawerSection title="Tenant photos">
          {photos.length > 0 ? (
            <PhotoGrid photos={photos.map((m) => ({ url: m.url, caption: m.uploadedBy === "tenant" ? "Tenant" : "Staff" }))} />
          ) : null}
          {videos.map((m) => (
            <a
              key={m._id}
              href={m.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 text-[13px] text-primary hover:underline"
            >
              <ImageIcon className="h-4 w-4" /> Video from {m.uploadedBy === "tenant" ? "the tenant" : "staff"}
            </a>
          ))}
        </DrawerSection>
      ) : null}

      {showEvidence && w ? (
        <DrawerSection title="Technician evidence">
          {w.files.length > 0 ? (
            <PhotoGrid photos={w.files.map((f) => ({ url: f.url, caption: f.kind === "receipt" ? "Receipt" : undefined }))} />
          ) : (
            <p className="text-[13px] text-muted-foreground">No photos uploaded.</p>
          )}
          <div className="mt-3">
            <KeyValue
              items={[
                { label: "Hours", value: hoursText(w.totals.hours) },
                ...w.expenses.map((e) => ({
                  label: e.kind === "material" ? "Material" : "Expense",
                  value: `${e.description} · ${fmtMoney(e.amountCents)}`,
                })),
                ...w.notes.map((n) => ({ label: "Note", value: n.body })),
                ...(w.workOrder.completedAt ? [{ label: "Completed", value: fmtDateTime(w.workOrder.completedAt) }] : []),
              ]}
            />
          </div>
        </DrawerSection>
      ) : null}

      {w && w.workOrder.checklist.length > 0 ? (
        <DrawerSection title="Checklist">
          <Checklist items={w.workOrder.checklist.map((c) => ({ label: c.label, done: c.done }))} />
        </DrawerSection>
      ) : null}

      {audit.length > 0 ? (
        <DrawerSection title="Activity">
          <Timeline
            entries={audit.map((a) => ({
              id: a._id,
              text: auditText(a),
              time: fmtDateTime(a.at),
            }))}
          />
        </DrawerSection>
      ) : null}

      <Link
        href={w ? `/work-orders/${item.id}` : `/maintenance/${item.id}`}
        className="text-[13px] font-medium text-primary hover:underline"
      >
        Open full page →
      </Link>
    </Drawer>
  );
}
