"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BadgeCheck, Camera, ImageIcon, Pencil, ShieldQuestion, Sparkles, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { ConversationTranscript } from "@/components/transcript";
import { errorMessage, useToast } from "@/components/ui/toast";
import type { Id } from "@/convex/_generated/dataModel";
import { tenantPreferredTimeText } from "@/convex/workOrderWindow";
import {
  Btn,
  ConfirmDialog,
  DrawerSection,
  Field,
  Input,
  KeyValue,
  PhotoGrid,
  Pill,
  Select,
  Textarea,
  Timeline,
  type Tone,
} from "@/components/ui";
import {
  ISSUE_TYPES,
  SEVERITY_CHOICES,
  auditText,
  fmtDateTime,
  fmtMoney,
  hoursText,
  issueLabel,
  type Severity,
} from "@/components/board/shared";

export type ReqDetail = NonNullable<FunctionReturnType<typeof api.maintenance.get>>;
export type WoDetail = NonNullable<FunctionReturnType<typeof api.workOrders.get>>;

/** Stage pill for a request (lane names match the board and the prototype). */
export function requestStage(r: ReqDetail["request"], leadName: string): { label: string; tone: Tone } {
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

/** Stage pill for a work order. */
export function woStage(w: WoDetail["workOrder"]): { label: string; tone: Tone } {
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

/** Name of the maintenance lead when there is exactly one (same rule as the board lanes). */
export function useLeadName(): string {
  const team = useQuery(api.team.overview);
  const leads = (team?.members ?? []).filter((m) => m.jobRoles.includes("maintenance_lead"));
  return leads.length === 1 ? leads[0].name : "maintenance lead";
}

const OPEN_REQUEST = ["new", "under_review", "more_info_needed", "forwarded_to_pat"];

/** Title of a request: Sarah's (or the AM's edited) title, else the description. */
export function requestTitle(r: ReqDetail["request"]): string {
  return r.title?.trim() || r.description;
}

/**
 * The number "Ask tenant for photos" will text: the one the caller gave, else caller ID (same
 * order as the server). Undefined for a viewer who may not see contact details.
 */
export function photoTextNumber(r: ReqDetail["request"]): string | undefined {
  return r.callbackNumber || r.callerNumber || undefined;
}

/** Server-side name check (spoken name vs the unit's residents). For the asset manager only. */
function IdentityBadge({ r, resident }: { r: ReqDetail["request"]; resident: ReqDetail["resident"] }) {
  if (r.nameMatchesResident === "true") {
    return (
      <Pill tone="ok" title="The name the caller gave matches a resident of this unit">
        <BadgeCheck className="h-3 w-3" /> Name matches resident
      </Pill>
    );
  }
  if (r.nameMatchesResident === "false") {
    return (
      <Pill tone="warn" title="The name the caller gave does not match any resident on file for this unit">
        <ShieldQuestion className="h-3 w-3" /> Name does not match the resident on file
      </Pill>
    );
  }
  if (resident) return <Pill tone="neutral">Matched resident · not confirmed</Pill>;
  return (
    <Pill tone="neutral" title="No resident to compare the caller's name with">
      <ShieldQuestion className="h-3 w-3" /> Name not checked
    </Pill>
  );
}

/** "Photo request from the call": the caller offered photos; Sarah texted nobody. */
function PhotoRequestCard({ r }: { r: ReqDetail["request"] }) {
  const given = r.callbackNumber;
  const callerId = r.callerNumber;
  const rows: Array<{ label: ReactNode; value: ReactNode }> = [];
  if (given) rows.push({ label: "Number the caller gave", value: given });
  if (callerId) rows.push({ label: "Caller-ID number", value: callerId });
  if (r.callerEmail) rows.push({ label: "Email", value: r.callerEmail });
  if (r.photosRequestNote) rows.push({ label: "What the caller said", value: r.photosRequestNote });
  if (r.photosRequestedAt) rows.push({ label: "Time", value: fmtDateTime(r.photosRequestedAt) });
  const target = photoTextNumber(r);
  return (
    <DrawerSection
      title={
        <span className="inline-flex items-center gap-1.5">
          <Camera aria-hidden className="h-3.5 w-3.5" /> Photo request from the call
        </span>
      }
    >
      <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-muted/40 p-3.5">
        <p className="text-[13px]">
          The caller said they can send photos. Sarah did not text them; it is up to you.
        </p>
        {rows.length > 0 ? <KeyValue items={rows} /> : null}
        <p className="text-xs text-muted-foreground">
          {target
            ? `"Ask tenant for photos" texts the upload link to ${target}.`
            : "No phone number is available to text an upload link to."}
        </p>
      </div>
    </DrawerSection>
  );
}

// --- Draft editor ------------------------------------------------------------------------

function DraftEditor({ d, onDone }: { d: ReqDetail; onDone: () => void }) {
  const toast = useToast();
  const edit = useMutation(api.maintenance.editDraft);
  const overrideSeverity = useMutation(api.maintenance.overrideSeverity);
  const r = d.request;
  const [title, setTitle] = useState(requestTitle(r));
  const [category, setCategory] = useState(r.issueType);
  const [description, setDescription] = useState(r.description);
  const [level, setLevel] = useState<Severity>(r.severity);
  const [score, setScore] = useState(r.severityScore ? String(r.severityScore) : "");
  const [reason, setReason] = useState("");
  const [pets, setPets] = useState(r.pets ?? "");
  const [firstNoticed, setFirstNoticed] = useState(r.firstNoticed ?? "");
  const [access, setAccess] = useState(r.preferredAccessTimes ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.answers.map((a) => [a.key, a.value])),
  );
  const [busy, setBusy] = useState(false);

  const levelChanged = level !== r.severity;
  const valid = title.trim() && description.trim() && (!levelChanged || reason.trim());
  const categories = ISSUE_TYPES.includes(category as (typeof ISSUE_TYPES)[number])
    ? [...ISSUE_TYPES]
    : [category, ...ISSUE_TYPES];

  const save = async () => {
    setBusy(true);
    try {
      if (levelChanged) await overrideSeverity({ requestId: r._id, severity: level, reason: reason.trim() });
      await edit({
        requestId: r._id,
        title: title.trim(),
        category,
        description: description.trim(),
        severityScore: score ? Number(score) : undefined,
        pets,
        firstNoticed,
        preferredAccessTimes: access,
        answers: r.answers.map((a) => ({ key: a.key, value: answers[a.key] ?? a.value })),
      });
      toast("Draft updated.");
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-3.5">
      <Field label="Title">
        <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      </Field>
      <div className="grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-2">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            {categories.map((t) => (
              <option key={t} value={t}>
                {issueLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Severity">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Select value={level} onChange={(e) => setLevel(e.target.value as Severity)} aria-label="Severity level">
              {SEVERITY_CHOICES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Select value={score} onChange={(e) => setScore(e.target.value)} aria-label="Severity score">
              <option value="">No score</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}/10
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>
      {levelChanged ? (
        <Field label="Why change the severity? (goes in the activity log)">
          <Input value={reason} maxLength={450} onChange={(e) => setReason(e.target.value)} aria-label="Severity reason" />
        </Field>
      ) : null}
      <Field label="Summary">
        <Textarea
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Summary"
        />
      </Field>
      <Field label="Pets">
        <Input value={pets} maxLength={300} onChange={(e) => setPets(e.target.value)} aria-label="Pets" />
      </Field>
      <Field label="First noticed">
        <Input value={firstNoticed} maxLength={200} onChange={(e) => setFirstNoticed(e.target.value)} aria-label="First noticed" />
      </Field>
      <Field label="Tenant's preferred time">
        <Input value={access} maxLength={300} onChange={(e) => setAccess(e.target.value)} aria-label="Tenant's preferred time" />
      </Field>
      {r.answers.map((a) => (
        <Field key={a.key} label={a.question}>
          <Input
            value={answers[a.key] ?? ""}
            maxLength={500}
            onChange={(e) => setAnswers((cur) => ({ ...cur, [a.key]: e.target.value }))}
            aria-label={a.question}
          />
        </Field>
      ))}
      <div className="flex flex-wrap gap-2">
        <Btn variant="pri" disabled={busy || !valid} onClick={save}>
          Save draft
        </Btn>
        <Btn disabled={busy} onClick={onDone}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}

// --- Shared sections -----------------------------------------------------------------------

/**
 * The work order / request body, in the prototype's order: Request, Sarah's summary, From the
 * call, Tenant photos, Technician evidence, Activity.
 * Used by the board drawer and both full pages so they cannot drift. Permission flags come
 * from the server (`canAct` etc.); nothing here decides access.
 */
export function WorkOrderFormat({
  r,
  w,
  photosAction,
  photosNote,
  afterRequest,
  evidenceAlways = false,
}: {
  r: ReqDetail | null;
  w: WoDetail | null;
  /** e.g. an "Add file" button for the viewer who can attach photos. */
  photosAction?: ReactNode;
  /** Muted one-liner shown instead of the action when the viewer can't attach. */
  photosNote?: string;
  /** Extra section rendered right after Request (the work order scope on the full page). */
  afterRequest?: ReactNode;
  /** Show the evidence section while the job is in progress too (full page). */
  evidenceAlways?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const removeMedia = useMutation(api.board.removeMedia);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const removeToast = useToast();
  const confirmRemove = async () => {
    if (!removeId || (!w && !r)) return;
    setRemoving(true);
    try {
      await removeMedia(
        w
          ? { kind: "work_order", id: w.workOrder._id as Id<"workOrders">, mediaId: removeId }
          : { kind: "request", id: r!.request._id as string, mediaId: removeId },
      );
      removeToast("Photo removed", "success");
      setRemoveId(null);
    } catch (e) {
      removeToast(errorMessage(e), "error");
    } finally {
      setRemoving(false);
    }
  };

  const request = r?.request;
  const property = w ? w.property : r?.property;
  const unitNo = w ? w.unit.unitNumber : (r?.unit?.unitNumber ?? request?.spokenUnit);
  const tenant = request?.callerName ?? r?.resident?.fullName;
  const isOpenRequest = !!request && !w && OPEN_REQUEST.includes(request.status);
  const canEditDraft = !!r && r.canAct && !r.isCovering && isOpenRequest;
  const contact = [request?.callbackNumber ?? request?.callerNumber, request?.callerEmail].filter(Boolean);

  const kv: Array<{ label: ReactNode; value: ReactNode }> = [
    { label: "Property", value: `${property?.name ?? "Unknown"}${unitNo ? ` · ${unitNo}` : ""}` },
    {
      label: "Tenant",
      value: request ? (
        <span className="flex flex-wrap items-center gap-2">
          {tenant ?? "—"}
          <IdentityBadge r={request} resident={r?.resident ?? null} />
        </span>
      ) : (
        "—"
      ),
    },
  ];
  if (request && contact.length > 0) kv.push({ label: "Contact", value: contact.join(" · ") });
  kv.push(
    { label: "Category", value: request ? issueLabel(request.issueType) : "—" },
    { label: "Asset manager", value: r?.assignedAssetManagerName ?? "—" },
  );
  if (w?.technicianName) kv.push({ label: "Technician", value: w.technicianName });
  if (w?.workOrder.window) kv.push({ label: "Window", value: w.workOrder.window });
  // On a work order the page header shows this beside the time window.
  const preferredTime = w ? undefined : tenantPreferredTimeText(request?.preferredAccessTimes);
  if (preferredTime) kv.push({ label: "Tenant's preferred time", value: preferredTime });
  kv.push({ label: "Created", value: fmtDateTime(w ? w.workOrder.createdAt : (request?.createdAt ?? 0)) });

  // Structured answers as labelled rows (pets, first noticed, plus every Sarah question).
  const answerRows: Array<{ label: ReactNode; value: ReactNode }> = [];
  if (request) {
    if (request.firstNoticed) answerRows.push({ label: "First noticed", value: request.firstNoticed });
    if (request.pets) answerRows.push({ label: "Pets", value: request.pets });
    for (const a of request.answers) answerRows.push({ label: a.question, value: a.value });
    if (request.severityReason) {
      answerRows.push({
        label: "Severity reason",
        value:
          request.originalSeverity && request.originalSeverity !== request.severity
            ? `${request.severityReason} (Sarah scored it ${request.originalSeverity})`
            : request.severityReason,
      });
    }
  }
  const summaryText = r?.conversation?.summary ?? request?.description;

  const photos = (r?.media ?? []).filter((m) => m.kind === "photo");
  const videos = (r?.media ?? []).filter((m) => m.kind === "video" && m.url);
  // Always shown: the add tile (or the reason it is missing) must stay reachable in every status.
  const showPhotos = true;

  const hasEvidence = !!w && (w.files.length > 0 || w.time.length > 0 || w.expenses.length > 0 || w.notes.length > 0);
  const showEvidence =
    !!w &&
    (w.workOrder.status === "completed" ||
      w.workOrder.status === "reviewed_closed" ||
      (evidenceAlways && w.workOrder.status !== "cancelled" && hasEvidence));
  const completionPhotos = (w?.files ?? []).filter((f) => f.kind !== "receipt");
  const receiptFiles = (w?.files ?? []).filter((f) => f.kind === "receipt");

  const audit = [...(r?.audit ?? []), ...(w?.audit ?? [])].sort((a, b) => a.at - b.at);

  return (
    <>
      <DrawerSection title="Request">
        <KeyValue items={kv} />
      </DrawerSection>

      {afterRequest}

      {request && (summaryText || answerRows.length > 0 || canEditDraft) ? (
        <DrawerSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles aria-hidden className="h-3.5 w-3.5" /> Sarah&apos;s summary
            </span>
          }
        >
          {editing && r ? (
            <DraftEditor d={r} onDone={() => setEditing(false)} />
          ) : (
            <div className="flex flex-col gap-3">
              {summaryText ? <p className="whitespace-pre-wrap text-[13.5px]">{summaryText}</p> : null}
              {answerRows.length > 0 ? <KeyValue items={answerRows} /> : null}
              {canEditDraft ? (
                <div>
                  <Btn sm onClick={() => setEditing(true)}>
                    <Pencil aria-hidden className="h-3.5 w-3.5" /> Edit draft
                  </Btn>
                </div>
              ) : null}
            </div>
          )}
        </DrawerSection>
      ) : null}

      {r?.conversation ? (
        <DrawerSection title="From the call">
          <div className="max-h-72 overflow-y-auto rounded-[14px] bg-muted px-3.5 py-3">
            <ConversationTranscript conversationId={r.conversation._id} />
          </div>
        </DrawerSection>
      ) : null}

      {request?.photosRequestedByCaller ? <PhotoRequestCard r={request} /> : null}

      {showPhotos ? (
        <DrawerSection title="Tenant photos">
          <div className="flex flex-col gap-2">
            {request?.photosPending ? (
              <div>
                <Pill tone="warn">Photos pending</Pill>
              </div>
            ) : null}
            {photos.length > 0 ? (
              <PhotoGrid
                photos={photos.map((m) => ({
                  url: m.url,
                  caption: m.uploadedBy === "tenant" ? "Tenant" : "Staff",
                  onRemove: m.canRemove ? () => setRemoveId(m.id) : undefined,
                }))}
              />
            ) : !request?.photosPending ? (
              <p className="text-[13px] text-muted-foreground">
                No photos yet{request?.mediaRequested ? ". The tenant was asked to send some" : ""}.
              </p>
            ) : null}
            {videos.map((m) => (
              <div key={m._id} className="flex items-center gap-2">
                <a
                  href={m.url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[13px] text-primary hover:underline"
                >
                  <ImageIcon aria-hidden className="h-4 w-4" /> Video from {m.uploadedBy === "tenant" ? "the tenant" : "staff"}
                </a>
                {m.canRemove ? (
                  <button
                    type="button"
                    aria-label="Remove video"
                    title="Remove video"
                    onClick={() => setRemoveId(m.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white hover:bg-rose-600"
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
            {photosAction ? (
              photosAction
            ) : photosNote ? (
              <p className="text-[12.5px] text-muted-foreground">{photosNote}</p>
            ) : null}
          </div>
        </DrawerSection>
      ) : null}

      {showEvidence && w ? (
        <DrawerSection title="Technician evidence">
          {completionPhotos.length > 0 || receiptFiles.length > 0 ? (
            <PhotoGrid
              photos={[
                ...completionPhotos.map((f) => ({ url: f.url, caption: "Completion", onRemove: f.canRemove ? () => setRemoveId(f._id) : undefined })),
                ...receiptFiles.map((f) => ({ url: f.url, caption: "Receipt", onRemove: f.canRemove ? () => setRemoveId(f._id) : undefined })),
              ]}
            />
          ) : (
            <p className="text-[13px] text-muted-foreground">No photos uploaded.</p>
          )}
          <div className="mt-3">
            <KeyValue
              items={[
                { label: "Hours", value: hoursText(w.totals.hours) },
                ...w.expenses.map((e) => ({
                  label: e.kind === "material" ? "Material" : "Receipt",
                  value: `${e.description} · ${fmtMoney(e.amountCents)}`,
                })),
                ...w.notes.map((n) => ({ label: "Notes", value: n.body })),
                ...(w.workOrder.completedAt ? [{ label: "Completed", value: fmtDateTime(w.workOrder.completedAt) }] : []),
              ]}
            />
          </div>
        </DrawerSection>
      ) : null}

      {audit.length > 0 ? (
        <DrawerSection title="Activity">
          <Timeline entries={audit.map((a) => ({ id: a._id, text: auditText(a), time: fmtDateTime(a.at) }))} />
        </DrawerSection>
      ) : null}
      <ConfirmDialog
        open={removeId !== null}
        title="Remove this photo?"
        message="This can't be undone."
        confirmLabel="Remove"
        danger
        busy={removing}
        onCancel={() => setRemoveId(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}

/**
 * Sarah's side of a request for the board drawer: her summary and structured answers, the call
 * transcript, and the caller's photo offer. Read only; the full pages keep the editable version.
 */
export function CallDetails({ r }: { r: ReqDetail }) {
  const request = r.request;
  const rows: Array<{ label: ReactNode; value: ReactNode }> = [];
  if (request.firstNoticed) rows.push({ label: "First noticed", value: request.firstNoticed });
  if (request.pets) rows.push({ label: "Pets", value: request.pets });
  for (const a of request.answers) rows.push({ label: a.question, value: a.value });
  if (request.severityReason) {
    rows.push({
      label: "Severity reason",
      value:
        request.originalSeverity && request.originalSeverity !== request.severity
          ? `${request.severityReason} (Sarah scored it ${request.originalSeverity})`
          : request.severityReason,
    });
  }
  const summary = r.conversation?.summary ?? request.description;
  return (
    <div className="flex flex-col gap-4">
      <DrawerSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles aria-hidden className="h-3.5 w-3.5" /> Sarah&apos;s summary
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <IdentityBadge r={request} resident={r.resident ?? null} />
          </div>
          {summary ? <p className="whitespace-pre-wrap text-[13px]">{summary}</p> : null}
          {rows.length > 0 ? <KeyValue items={rows} /> : null}
        </div>
      </DrawerSection>
      {r.conversation ? (
        <DrawerSection title="Call transcript">
          <div className="max-h-72 overflow-y-auto rounded-[14px] bg-muted px-3.5 py-3">
            <ConversationTranscript conversationId={r.conversation._id} />
          </div>
        </DrawerSection>
      ) : null}
      {request.photosRequestedByCaller ? <PhotoRequestCard r={request} /> : null}
    </div>
  );
}
