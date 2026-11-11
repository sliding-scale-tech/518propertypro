"use client";

import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  MessageSquareMore,
  Pencil,
  Phone,
  Undo2,
  Upload,
  Wrench,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage, useToast } from "@/components/toast";
import { Dropdown } from "@/components/ui/dropdown";
import { Card, Pill, SevChip } from "@/components/ui";
import { RejectPanel } from "@/components/board/reject-panel";
import { WorkOrderFormat, requestStage, requestTitle, useLeadName } from "@/components/work-orders/format";
import {
  Field,
  Modal,
  NoteDialog,
  SEVERITY_OPTIONS,
  UnitPickerDialog,
  btnDanger,
  btnOutline,
  btnPrimary,
  formatWhen,
  inputClass,
  mrNumber,
  timeAgo,
  type Severity,
  type Status,
} from "./shared";

const OPEN: Status[] = ["new", "under_review", "more_info_needed", "forwarded_to_pat"];
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;

type Dialog =
  | null
  | "info"
  | "close"
  | "forward"
  | "sendBack"
  | "closeNoWo"
  | "fixUnit"
  | "severity"
  | "withdraw"
  | "note";

/**
 * Full request review screen (P7). Used by /maintenance/[id] and, with `embedded`, inside the
 * validated-queue side panel. The server decides what each viewer may do (`canAct`,
 * `canManage`); the buttons here only mirror that.
 */
export function RequestDetail({
  requestId,
  embedded = false,
  backHref = "/work-orders",
}: {
  requestId: Id<"maintenanceRequests">;
  embedded?: boolean;
  backHref?: string;
}) {
  const toast = useToast();
  const data = useQuery(api.maintenance.get, { requestId });
  const markViewed = useMutation(api.maintenance.markViewed);
  const approveAndForward = useMutation(api.maintenance.approveAndForward);
  const requestInfo = useMutation(api.maintenance.requestInfo);
  const forwardToPat = useMutation(api.maintenance.forwardToPat);
  const markDuplicate = useMutation(api.maintenance.markDuplicate);
  const notDuplicate = useMutation(api.maintenance.notDuplicate);
  const fixUnit = useMutation(api.maintenance.fixUnit);
  const overrideSeverity = useMutation(api.maintenance.overrideSeverity);
  const sendBackToAM = useMutation(api.maintenance.sendBackToAM);
  const genUrl = useMutation(api.maintenance.generateMediaUploadUrl);
  const attach = useMutation(api.maintenance.attachMedia);
  const withdrawFromPat = useMutation(api.maintenance.withdrawFromPat);
  const addNote = useMutation(api.maintenance.addNote);
  const leadName = useLeadName();

  const [dialog, setDialog] = useState<Dialog>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const viewable = data !== undefined && data !== null;
  useEffect(() => {
    if (viewable) void markViewed({ requestId }).catch(() => {});
  }, [viewable, requestId, markViewed]);

  if (data === undefined) {
    return (
      <div className="flex min-h-[40dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (data === null) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">
          Request not found.{" "}
          {!embedded && (
            <Link href={backHref} className="text-primary underline">
              Back to the inbox
            </Link>
          )}
        </p>
      </Card>
    );
  }

  const { request: r, unit, property, conversation, workOrder } = data;
  const status = r.status as Status;
  const severity = r.severity as Severity;
  const isOpen = OPEN.includes(status);
  const stage = requestStage(r, leadName);
  const { canAct, canManage, canWithdraw, canAddNote, isCovering } = data;

  /** Runs a mutation, toasts the outcome; rethrows so dialogs stay open on failure. */
  const run = async (okMessage: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast(okMessage, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
      throw e;
    }
  };
  const runQuiet = (okMessage: string, fn: () => Promise<unknown>) => void run(okMessage, fn).catch(() => {});

  async function upload(files: File[]) {
    setUploading(true);
    let saved = 0;
    try {
      for (const file of files) {
        try {
          const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
          const isVideo = file.type.startsWith("video/");
          const reject = (why: string) => toast(`${file.name}: ${why}`, "error");
          if (!isImage && !isVideo) {
            reject("Only photos and videos can be attached.");
            continue;
          }
          if (file.size > (isImage ? MAX_IMAGE : MAX_VIDEO)) {
            reject(isImage ? "Photos can be at most 10 MB." : "Videos can be at most 50 MB.");
            continue;
          }
          const url = await genUrl({ requestId });
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
          if (!res.ok) {
            reject("Upload failed.");
            continue;
          }
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          const result = await attach({ requestId, storageId });
          if (!result.ok) {
            reject(result.error);
            continue;
          }
          saved += 1;
        } catch (e) {
          toast(`${file.name}: ${errorMessage(e, "Upload failed.")}`, "error");
        }
      }
      if (saved > 0) toast(saved === 1 ? "File attached." : `${saved} files attached.`, "success");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Validate + forward in one step; an already-validated request keeps the plain Forward button.
  const alreadyValidated = !!r.validatedAt && status === "under_review";
  const canApprove = canAct && !alreadyValidated && ["new", "under_review", "more_info_needed"].includes(status);
  const canRequestInfo = canAct && ["new", "under_review"].includes(status);
  const canCloseScope = canAct && ["new", "under_review", "more_info_needed"].includes(status);
  const canForward = canAct && alreadyValidated;
  const canFix = canAct && isOpen;
  const patCreate = canManage && isOpen;
  const patSendBack = canManage && status === "forwarded_to_pat";
  const patCloseNoWo = canManage && status === "forwarded_to_pat";
  const hasActions =
    canWithdraw || canAddNote || canApprove || canRequestInfo || canCloseScope || canForward || canFix || patCreate || patSendBack || patCloseNoWo;

  const where = [property?.name, unit ? `Unit ${unit.unitNumber}` : r.spokenUnit ? `Unit ${r.spokenUnit}?` : undefined]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      {!embedded && (
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      )}

      {/* Header */}
      <Card>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{mrNumber(r.number)}</span>
            <SevChip level={severity} score={r.severityScore ?? undefined} />
            <Pill tone={stage.tone}>{stage.label}</Pill>
            {canAct && isOpen && (
              <button
                onClick={() => setDialog("severity")}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Pencil className="h-3 w-3" /> Change severity
              </button>
            )}
          </div>
          <h1 className="text-xl font-semibold leading-snug">{requestTitle(r)}</h1>
          <p className="text-sm text-muted-foreground">
            {where || "No unit matched"} · Assigned to {data.assignedAssetManagerName ?? "nobody"} · opened{" "}
            {timeAgo(r.createdAt)} ago
          </p>
          {r.inExceptionQueue && (
            <Pill tone="warn">
              <AlertTriangle className="h-3.5 w-3.5" /> In exception queue: {r.routeReason ?? "needs review"}
            </Pill>
          )}
          {workOrder && (
            <Link href={`/work-orders/${workOrder._id}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Wrench className="h-4 w-4" /> Work order WO-{workOrder.number} ({workOrder.status.replace(/_/g, " ")})
            </Link>
          )}
        </div>
      </Card>

      {/* Duplicate banner */}
      {data.possibleDuplicateOf && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border bg-warning-soft p-4 text-sm text-warning-ink">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Possible duplicate of{" "}
            <Link href={`/maintenance/${data.possibleDuplicateOf._id}`} className="font-medium underline">
              {mrNumber(data.possibleDuplicateOf.number)}
            </Link>{" "}
            ({timeAgo(data.possibleDuplicateOf.createdAt)} older)
          </span>
          {canAct && isOpen && (
            <span className="flex gap-2">
              <button
                className={btnOutline}
                onClick={() =>
                  runQuiet("Marked as duplicate.", () =>
                    markDuplicate({ requestId, originalId: data.possibleDuplicateOf!._id }),
                  )
                }
              >
                Mark duplicate
              </button>
              <button className={btnOutline} onClick={() => runQuiet("Kept as separate request.", () => notDuplicate({ requestId }))}>
                Not a duplicate
              </button>
            </span>
          )}
        </div>
      )}

      {isCovering && (
        <Pill tone="neutral">
          You&apos;re covering this unit while {data.assignedAssetManagerName ?? "the asset manager"} is out. Read only.
        </Pill>
      )}

      {/* Action bar */}
      {hasActions && (
        <div className="flex flex-wrap gap-2 rounded-[20px] border border-border bg-card p-3">
          {canWithdraw && !canManage && (
            <button className={btnOutline} onClick={() => setDialog("withdraw")}>
              <Undo2 className="h-4 w-4" /> Withdraw to my review
            </button>
          )}
          {canAddNote && (
            <button className={btnOutline} onClick={() => setDialog("note")}>
              <Pencil className="h-4 w-4" /> {canManage ? "Add a note for the asset manager" : "Add a note for Pat"}
            </button>
          )}
          {canApprove && (
            <button
              className={btnPrimary}
              onClick={() => runQuiet("Approved and sent to Pat.", () => approveAndForward({ requestId }))}
            >
              <CheckCircle2 className="h-4 w-4" /> Approve &amp; send to Pat
            </button>
          )}
          {canRequestInfo && (
            <button
              className={btnOutline}
              onClick={() => {
                setDialog("info");
              }}
            >
              <MessageSquareMore className="h-4 w-4" /> Request more info
            </button>
          )}
          {canForward && (
            <button
              className={btnOutline}
              title="Send to the maintenance lead"
              onClick={() => setDialog("forward")}
            >
              <ArrowRight className="h-4 w-4" /> Forward to Pat
            </button>
          )}
          {canFix && (
            <button className={btnOutline} onClick={() => setDialog("fixUnit")}>
              <Pencil className="h-4 w-4" /> Fix unit
            </button>
          )}
          {patCreate && (
            <Link href={`/work-orders/new?request=${requestId}`} className={btnPrimary}>
              <Wrench className="h-4 w-4" /> Create work order
            </Link>
          )}
          {patSendBack && (
            <button className={btnOutline} onClick={() => setDialog("sendBack")}>
              <Undo2 className="h-4 w-4" /> Send back to AM
            </button>
          )}
          {patCloseNoWo && (
            <button
              className={btnDanger}
              onClick={() => {
                setDialog("closeNoWo");
              }}
            >
              <XCircle className="h-4 w-4" /> Close: no work order
            </button>
          )}
          {canCloseScope && (
            <button
              className={btnDanger}
              onClick={() => {
                setDialog("close");
              }}
            >
              <XCircle className="h-4 w-4" /> Close: not our responsibility
            </button>
          )}
        </div>
      )}

      <Card className="space-y-5">
        <WorkOrderFormat
          r={data}
          w={null}
          photosNote={isCovering ? "Covering view is read-only." : "You can't add photos to this item."}
          photosAction={
            data.canAttach ? (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    if (picked.length > 0) void upload(picked);
                  }}
                />
                <button className={btnOutline} disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Add photos / videos
                </button>
              </div>
            ) : null
          }
        />
        {conversation ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone aria-hidden className="h-3.5 w-3.5" />
            Call on {formatWhen(conversation.startedAt)}
            {conversation.durationSec ? ` · ${Math.round(conversation.durationSec / 60)} min` : ""}
          </p>
        ) : null}
      </Card>

      {/* Dialogs */}
      {dialog === "info" && (
        <NoteDialog
          title="Request more info"
          description="Say what you need from the tenant (details, a photo or a video)."
          label="What do you need?"
          required
          confirmLabel="Request info"
          onClose={() => setDialog(null)}
          extra={
            <div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled
                  checked={false}
                  readOnly
                  title="Texting is off for now"
                />
                <span className="text-muted-foreground">Text the tenant a photo link</span>
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Texting is off for now.</p>
            </div>
          }
          onSubmit={(note) =>
            run("Marked as waiting on tenant.", async () => {
              await requestInfo({
                requestId,
                note,
              });
            })
          }
        />
      )}
      {(dialog === "close" || dialog === "closeNoWo") && (
        <Modal title="Close as Out of Scope" onClose={() => setDialog(null)}>
          <RejectPanel
            requestId={requestId}
            mode={dialog === "close" ? "am" : "admin"}
            onDone={() => setDialog(null)}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
      {dialog === "forward" && (
        <NoteDialog
          title="Forward to Pat"
          label="Note for Pat"
          required={false}
          confirmLabel="Forward"
          onClose={() => setDialog(null)}
          onSubmit={(note) => run("Forwarded to Pat.", () => forwardToPat({ requestId, note: note || undefined }))}
        />
      )}
      {dialog === "withdraw" && (
        <NoteDialog
          title="Withdraw to my review"
          label="Note (optional)"
          required={false}
          confirmLabel="Withdraw"
          onClose={() => setDialog(null)}
          onSubmit={(note) =>
            run("Withdrawn. It is back in your review.", () => withdrawFromPat({ requestId, note: note || undefined }))
          }
        />
      )}
      {dialog === "note" && (
        <NoteDialog
          title={canManage ? "Add a note for the asset manager" : "Add a note for Pat"}
          label="Note"
          required
          confirmLabel="Save note"
          onClose={() => setDialog(null)}
          onSubmit={(note) => run("Note saved.", () => addNote({ requestId, note }))}
        />
      )}
      {dialog === "sendBack" && (
        <NoteDialog
          title="Send back to AM"
          label="Note for the asset manager"
          required
          confirmLabel="Send back"
          onClose={() => setDialog(null)}
          onSubmit={(note) => run("Sent back to the asset manager.", () => sendBackToAM({ requestId, note }))}
        />
      )}
      {dialog === "fixUnit" && (
        <UnitPickerDialog
          title="Fix unit"
          confirmLabel="Re-route"
          onClose={() => setDialog(null)}
          onSubmit={(unitId) => run("Unit updated and request re-routed.", () => fixUnit({ requestId, unitId }))}
        />
      )}
      {dialog === "severity" && (
        <SeverityDialog
          current={severity}
          onClose={() => setDialog(null)}
          onSubmit={(sev, reason) =>
            run("Severity updated.", () => overrideSeverity({ requestId, severity: sev, reason }))
          }
        />
      )}
    </div>
  );
}

function SeverityDialog({
  current,
  onSubmit,
  onClose,
}: {
  current: Severity;
  onSubmit: (severity: Severity, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [sev, setSev] = useState<Severity>(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = sev !== current && reason.trim().length > 0;
  return (
    <Modal title="Change severity" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Severity">
          <Dropdown value={sev} options={SEVERITY_OPTIONS} onChange={setSev} />
        </Field>
        <Field label="Reason (required, goes in the timeline)">
          <textarea className={`${inputClass} min-h-20`} value={reason} maxLength={450} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button className={btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btnPrimary}
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(sev, reason.trim());
                onClose();
              } catch {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
