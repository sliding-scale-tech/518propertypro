"use client";

import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";
import { Dropdown } from "@/components/ui/dropdown";
import { Card, CardHead, Pill, SevChip, Timeline } from "@/components/ui";
import { auditText } from "@/components/board/shared";
import { OUT_OF_SCOPE_REASONS } from "@/convex/maintenanceReasons";
import { ConversationTranscript } from "@/components/transcript";
import {
  Field,
  Modal,
  NoteDialog,
  SEVERITY_OPTIONS,
  SeverityBadge,
  StatusPill,
  UnitPickerDialog,
  btnDanger,
  btnOutline,
  btnPrimary,
  cleanError,
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

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card>
      <CardHead title={title} right={right} />
      {children}
    </Card>
  );
}

function KV({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

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
  const closeOutOfScope = useMutation(api.maintenance.closeOutOfScope);
  const forwardToPat = useMutation(api.maintenance.forwardToPat);
  const markDuplicate = useMutation(api.maintenance.markDuplicate);
  const notDuplicate = useMutation(api.maintenance.notDuplicate);
  const fixUnit = useMutation(api.maintenance.fixUnit);
  const overrideSeverity = useMutation(api.maintenance.overrideSeverity);
  const sendBackToAM = useMutation(api.maintenance.sendBackToAM);
  const closeNoWorkOrder = useMutation(api.maintenance.closeNoWorkOrder);
  const genUrl = useMutation(api.maintenance.generateMediaUploadUrl);
  const attach = useMutation(api.maintenance.attachMedia);
  const withdrawFromPat = useMutation(api.maintenance.withdrawFromPat);
  const addNote = useMutation(api.maintenance.addNote);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [uploading, setUploading] = useState(false);
  // Optional tenant texts: only offered when the matching wording is approved in Sarah config.
  const [notifyTenant, setNotifyTenant] = useState(false);
  const [sendPhotoLink, setSendPhotoLink] = useState(false);
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

  const { request: r, unit, property, resident, conversation, media, workOrder, audit } = data;
  const status = r.status as Status;
  const severity = r.severity as Severity;
  const isOpen = OPEN.includes(status);
  const { canAct, canManage, canWithdraw, canAddNote, isCovering } = data;

  /** Runs a mutation, toasts the outcome; rethrows so dialogs stay open on failure. */
  const run = async (okMessage: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast(okMessage, "success");
    } catch (e) {
      toast(cleanError(e), "error");
      throw e;
    }
  };
  const runQuiet = (okMessage: string, fn: () => Promise<unknown>) => void run(okMessage, fn).catch(() => {});
  /** Follow-up toast after a close that may have texted the tenant. */
  const reportNotice = (res: { notified: boolean; reason?: string }) => {
    if (!notifyTenant || !tenantMessages.outOfScope) return;
    toast(res.notified ? "Tenant notified." : `Tenant not notified${res.reason ? `: ${res.reason}` : "."}`, res.notified ? "success" : "error");
  };

  async function upload(file: File) {
    const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) return toast("Only photos and videos can be attached.", "error");
    if (file.size > (isImage ? MAX_IMAGE : MAX_VIDEO)) {
      return toast(isImage ? "Photos can be at most 10 MB." : "Videos can be at most 50 MB.", "error");
    }
    setUploading(true);
    try {
      const url = await genUrl({ requestId });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const result = await attach({ requestId, storageId });
      if (result.ok) toast("File attached.", "success");
      else toast(result.error, "error");
    } catch (e) {
      toast(cleanError(e), "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const tenantMessages = data.tenantMessages;
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
            <h1 className="font-mono text-lg font-semibold">{mrNumber(r.number)}</h1>
            {typeof r.severityScore === "number" ? (
              <SevChip level={severity} score={r.severityScore} />
            ) : (
              <SeverityBadge severity={severity} />
            )}
            <StatusPill status={status} />
            {canAct && isOpen && (
              <button
                onClick={() => setDialog("severity")}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Pencil className="h-3 w-3" /> Change severity
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {where || "No unit matched"} · Assigned to {data.assignedAssetManagerName ?? "nobody"} · opened{" "}
            {timeAgo(r.createdAt)} ago
          </p>
          {r.originalSeverity && r.originalSeverity !== r.severity ? (
            <p className="text-xs text-muted-foreground">
              Sarah scored it {r.originalSeverity}. {r.severityReason ? `Reason: ${r.severityReason}` : ""}
            </p>
          ) : r.severityReason ? (
            <p className="text-xs text-muted-foreground">Severity: {r.severityReason}</p>
          ) : null}
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
                setSendPhotoLink(false);
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
                setNotifyTenant(false);
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
                setNotifyTenant(false);
                setDialog("close");
              }}
            >
              <XCircle className="h-4 w-4" /> Close: not our responsibility
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Caller */}
        <Section title="Caller">
          <dl className="grid grid-cols-2 gap-3">
            <KV label="Name" value={r.callerName} />
            <KV label="Caller ID" value={r.callerNumber} />
            <KV label="Callback number" value={r.callbackNumber} />
            <KV label="Matched resident" value={resident?.fullName} />
            <KV label="Match" value={r.matchConfidence.replace("_", " ")} />
            <KV label="Pets" value={r.pets} />
            <KV label="Preferred access" value={r.preferredAccessTimes} />
            <KV label="Spoken address" value={r.spokenAddress} />
          </dl>
        </Section>

        {/* Issue */}
        <Section title="Issue">
          <dl className="space-y-3">
            <KV label="Type" value={<span className="capitalize">{r.issueType}</span>} />
            <KV label="Description" value={<span className="whitespace-pre-wrap">{r.description}</span>} />
            <KV label="First noticed" value={r.firstNoticed} />
            {r.nextAction ? <KV label="Latest note" value={r.nextAction} /> : null}
          </dl>
          {r.answers.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {r.answers.map((a) => (
                    <tr key={a.key} className="border-b border-border last:border-0">
                      <td className="w-1/2 bg-muted px-3 py-2 text-muted-foreground">{a.question}</td>
                      <td className="px-3 py-2">{a.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {/* Media */}
      <Section
        title={`Photos and videos (${media.length})`}
        right={
          canAct ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/gif,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <button className={btnOutline} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Add file
              </button>
            </>
          ) : null
        }
      >
        {media.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Camera className="h-4 w-4" /> No media yet{r.mediaRequested ? " (Sarah asked the tenant to send some)" : ""}.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {media.map((m) =>
              !m.url ? null : m.kind === "photo" ? (
                <a key={m._id} href={m.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt="Tenant or staff photo" className="aspect-square w-full object-cover" loading="lazy" />
                  <span className="block px-2 py-1 text-[11px] text-muted-foreground">{m.uploadedBy}</span>
                </a>
              ) : (
                <div key={m._id} className="overflow-hidden rounded-xl border border-border">
                  <video src={m.url} controls preload="metadata" className="aspect-square w-full bg-black object-contain" />
                  <span className="block px-2 py-1 text-[11px] text-muted-foreground">{m.uploadedBy}</span>
                </div>
              ),
            )}
          </div>
        )}
      </Section>

      {/* Call */}
      {conversation && (
        <Section
          title="Call"
          right={
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              {formatWhen(conversation.startedAt)}
              {conversation.durationSec ? ` · ${Math.round(conversation.durationSec / 60)} min` : ""}
            </span>
          }
        >
          {conversation.summary ? (
            <div className="mb-4 rounded-xl bg-muted p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Sarah&apos;s summary</div>
              {conversation.summary}
            </div>
          ) : null}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary">Full transcript</summary>
            <div className="mt-3">
              <ConversationTranscript conversationId={conversation._id} />
            </div>
          </details>
        </Section>
      )}

      {/* Timeline */}
      <Section title="Timeline">
        <Timeline
          entries={audit.map((a) => ({
            id: a._id,
            text: ["note_added", "withdrawn_from_pat", "reassigned_with_unit"].includes(a.action) ? (
              auditText(a)
            ) : (
              <>
                <span className="font-medium capitalize">{a.action.replace(/_/g, " ")}</span>
                {a.from || a.to ? (
                  <span className="ml-2 text-xs text-muted-foreground">{[a.from, a.to].filter(Boolean).join(" → ")}</span>
                ) : null}
                {a.note ? <div className="text-muted-foreground">{a.note}</div> : null}
              </>
            ),
            time: `${a.actorLabel} · ${formatWhen(a.at)}`,
          }))}
        />
      </Section>

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
                  disabled={!tenantMessages.photoRequest}
                  checked={sendPhotoLink && tenantMessages.photoRequest}
                  onChange={(e) => setSendPhotoLink(e.target.checked)}
                />
                <span>Text the tenant a photo link</span>
              </label>
              {!tenantMessages.photoRequest ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Needs approved photo-request wording in Sarah config (Tenant messages).
                </p>
              ) : null}
            </div>
          }
          onSubmit={(note) =>
            run("Marked as waiting on tenant.", async () => {
              const res = await requestInfo({
                requestId,
                note,
                sendPhotoLink: sendPhotoLink && tenantMessages.photoRequest ? true : undefined,
              });
              if (sendPhotoLink && tenantMessages.photoRequest) {
                toast(
                  res.texted ? "Photo link texted to the tenant." : `Photo link not sent${res.reason ? `: ${res.reason}` : "."}`,
                  res.texted ? "success" : "error",
                );
              }
            })
          }
        />
      )}
      {dialog === "close" && (
        <NoteDialog
          title="Close: not our responsibility"
          label="Details"
          required
          presets={[...OUT_OF_SCOPE_REASONS]}
          confirmLabel="Close request"
          danger
          onClose={() => setDialog(null)}
          extra={<NotifyTenantCheckbox enabled={tenantMessages.outOfScope} checked={notifyTenant} onChange={setNotifyTenant} />}
          onSubmit={(reason) =>
            run("Request closed.", async () => {
              const res = await closeOutOfScope({
                requestId,
                reason,
                notifyTenant: notifyTenant && tenantMessages.outOfScope ? true : undefined,
              });
              reportNotice(res);
            })
          }
        />
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
      {dialog === "closeNoWo" && (
        <NoteDialog
          title="Close: no work order needed"
          label="Reason"
          required
          confirmLabel="Close request"
          danger
          onClose={() => setDialog(null)}
          extra={<NotifyTenantCheckbox enabled={tenantMessages.outOfScope} checked={notifyTenant} onChange={setNotifyTenant} />}
          onSubmit={(reason) =>
            run("Request closed.", async () => {
              const res = await closeNoWorkOrder({
                requestId,
                reason,
                notifyTenant: notifyTenant && tenantMessages.outOfScope ? true : undefined,
              });
              reportNotice(res);
            })
          }
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

function NotifyTenantCheckbox({
  enabled,
  checked,
  onChange,
}: {
  enabled: boolean;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  // Only offered once the out-of-scope wording is approved in Sarah config.
  if (!enabled) return null;
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>Notify tenant</span>
    </label>
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
