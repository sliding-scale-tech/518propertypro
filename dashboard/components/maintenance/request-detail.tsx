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

export const OUT_OF_SCOPE_REASONS = [
  "Tenant responsibility (bulbs/blinds/trash)",
  "Not a maintenance issue",
  "Resolved by tenant",
  "Other",
];

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
  | "validate";

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function KV({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
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
  backHref = "/maintenance",
}: {
  requestId: Id<"maintenanceRequests">;
  embedded?: boolean;
  backHref?: string;
}) {
  const toast = useToast();
  const data = useQuery(api.maintenance.get, { requestId });
  const markViewed = useMutation(api.maintenance.markViewed);
  const validate = useMutation(api.maintenance.validate);
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
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Request not found.{" "}
        {!embedded && (
          <Link href={backHref} className="text-primary underline">
            Back to the inbox
          </Link>
        )}
      </div>
    );
  }

  const { request: r, unit, property, resident, conversation, media, workOrder, audit } = data;
  const status = r.status as Status;
  const severity = r.severity as Severity;
  const isOpen = OPEN.includes(status);
  const { canAct, canManage } = data;

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

  const canValidate = canAct && !r.validatedAt && ["new", "under_review", "more_info_needed"].includes(status);
  const canRequestInfo = canAct && ["new", "under_review"].includes(status);
  const canCloseScope = canAct && ["new", "under_review", "more_info_needed"].includes(status);
  const canForward = canAct && status === "under_review";
  const canFix = canAct && isOpen;
  const patCreate = canManage && isOpen;
  const patSendBack = canManage && status === "forwarded_to_pat";
  const patCloseNoWo = canManage && status === "forwarded_to_pat";
  const hasActions =
    canValidate || canRequestInfo || canCloseScope || canForward || canFix || patCreate || patSendBack || patCloseNoWo;

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
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{mrNumber(r.number)}</h1>
            <SeverityBadge severity={severity} />
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
            <p className="flex items-center gap-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="h-3.5 w-3.5" /> In exception queue: {r.routeReason ?? "needs review"}
            </p>
          )}
          {workOrder && (
            <Link href={`/work-orders/${workOrder._id}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Wrench className="h-4 w-4" /> Work order WO-{workOrder.number} ({workOrder.status.replace(/_/g, " ")})
            </Link>
          )}
        </div>
      </div>

      {/* Duplicate banner */}
      {data.possibleDuplicateOf && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
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

      {/* Action bar */}
      {hasActions && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
          {canValidate && (
            <button className={btnPrimary} onClick={() => setDialog("validate")}>
              <CheckCircle2 className="h-4 w-4" /> Validate
            </button>
          )}
          {canRequestInfo && (
            <button className={btnOutline} onClick={() => setDialog("info")}>
              <MessageSquareMore className="h-4 w-4" /> Request more info
            </button>
          )}
          {canForward && (
            <button
              className={btnOutline}
              disabled={!r.validatedAt}
              title={r.validatedAt ? "Send to the maintenance lead" : "Validate the request before forwarding it"}
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
            <button className={btnDanger} onClick={() => setDialog("closeNoWo")}>
              <XCircle className="h-4 w-4" /> Close: no work order
            </button>
          )}
          {canCloseScope && (
            <button className={btnDanger} onClick={() => setDialog("close")}>
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
                      <td className="w-1/2 bg-muted/30 px-3 py-2 text-muted-foreground">{a.question}</td>
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
            <div className="mb-4 rounded-xl bg-muted/40 p-3 text-sm">
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
        <ol className="space-y-3">
          {audit.map((a) => (
            <li key={a._id} className="border-l-2 border-border pl-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium capitalize">{a.action.replace(/_/g, " ")}</span>
                {a.from || a.to ? (
                  <span className="text-xs text-muted-foreground">
                    {[a.from, a.to].filter(Boolean).join(" → ")}
                  </span>
                ) : null}
              </div>
              {a.note ? <div className="text-muted-foreground">{a.note}</div> : null}
              <div className="text-xs text-muted-foreground">
                {a.actorLabel} · {formatWhen(a.at)}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* Dialogs */}
      {dialog === "validate" && (
        <NoteDialog
          title="Validate request"
          description="Confirms the details look right. You can forward it to Pat afterwards."
          label="Note"
          required={false}
          confirmLabel="Validate"
          onClose={() => setDialog(null)}
          onSubmit={(note) => run("Request validated.", () => validate({ requestId, note: note || undefined }))}
        />
      )}
      {dialog === "info" && (
        <NoteDialog
          title="Request more info"
          description="Say what you need from the tenant (details, a photo or a video)."
          label="What do you need?"
          required
          confirmLabel="Request info"
          onClose={() => setDialog(null)}
          onSubmit={(note) => run("Marked as waiting on tenant.", () => requestInfo({ requestId, note }))}
        />
      )}
      {dialog === "close" && (
        <NoteDialog
          title="Close: not our responsibility"
          label="Details"
          required
          presets={OUT_OF_SCOPE_REASONS}
          confirmLabel="Close request"
          danger
          onClose={() => setDialog(null)}
          onSubmit={(reason) => run("Request closed.", () => closeOutOfScope({ requestId, reason }))}
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
          onSubmit={(reason) => run("Request closed.", () => closeNoWorkOrder({ requestId, reason }))}
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
