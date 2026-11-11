"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowLeft, Camera, Check, Loader2, MapPin, Minus, PawPrint, Plus, Receipt, RotateCw, Video, X } from "lucide-react";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, DatePicker } from "@/components/ui";
import { errorMessage, useToast } from "@/components/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { tenantPreferredTimeText } from "@/convex/workOrderWindow";
import { MAX_WORK_DESCRIPTION } from "@/convex/rosPolicy";
import { STATUS_LABEL, compressImage, dollarsToCents, formatCents, formatDate, mapsUrl, todayLocalIso, uploadBlob } from "./lib";
import {
  PriorityBadge,
  TechBadge,
  TechButton,
  TechCallout,
  TechCard,
  TechField,
  TechHeading,
  TechLinkButton,
  TechPageTitle,
  TechRow,
  TechSeg,
  techBtnCls,
  techInputCls,
} from "./ui";

/** SWEEP = paid on the company card (reimbursable false); REIMB = the technician paid (true). */
type PaidBy = "" | "sweep" | "reimb";
const PAID_BY_OPTIONS: { value: PaidBy; label: string }[] = [
  { value: "sweep", label: "SWEEP (company card)" },
  { value: "reimb", label: "REIMB (I paid, reimburse me)" },
];

function NotFound() {
  return (
    <TechCard as="div" className="items-center py-10 text-center">
      <h1 className="text-base font-semibold">Job not found</h1>
      <p className="text-sm text-muted-foreground">It may have been reassigned or removed.</p>
      <TechLinkButton href="/tech" variant="primary">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Back to my jobs
      </TechLinkButton>
    </TechCard>
  );
}

/** A malformed id makes the query throw on validation; treat that as "not found". */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <NotFound /> : this.props.children;
  }
}

export function JobDetail({ id }: { id: string }) {
  return (
    <Boundary>
      <JobBody id={id as Id<"workOrders">} />
    </Boundary>
  );
}

type UploadItem = { key: number; name: string; pct: number; state: "working" | "error" | "done"; error?: string; retry?: boolean };
type Step = "job" | "evidence" | "submitted";

/** "1.5" / "2" (no trailing zeros). */
function fmtHours(h: number): string {
  return String(Number(h.toFixed(2)));
}

function JobBody({ id }: { id: Id<"workOrders"> }) {
  const toast = useToast();
  const data = useQuery(api.workOrders.get, { workOrderId: id });
  const start = useMutation(api.workOrders.start);
  const addTime = useMutation(api.workOrders.addTime);
  const addExpense = useMutation(api.workOrders.addExpense);
  const addNote = useMutation(api.workOrders.addNote);
  const genUrl = useMutation(api.workOrders.generateUploadUrl);
  const attach = useMutation(api.workOrders.attachFile);
  const submit = useMutation(api.workOrders.submitCompleted);
  const removeOwn = useMutation(api.workOrders.removeOwnFile);
  const [removeId, setRemoveId] = useState<Id<"workOrderFiles"> | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const blobs = useRef(new Map<number, { blob: Blob; kind: "completion_photo" | "completion_video" | "receipt" }>());
  const keySeq = useRef(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);
  // null = not chosen yet: the first screen is derived from the job (see `step` below).
  const [chosenStep, setChosenStep] = useState<Step | null>(null);

  // Hours
  const [date, setDate] = useState(todayLocalIso);
  const [hours, setHours] = useState("1");
  // Materials
  const [mDesc, setMDesc] = useState("");
  const [mQty, setMQty] = useState("1");
  const [mAmt, setMAmt] = useState("");
  // SWEEP / REIMB: required on a new material line, no default.
  const [mPaidBy, setMPaidBy] = useState<PaidBy>("");
  // Description of work completed (null = untouched: start from what was saved on the job).
  const [workDesc, setWorkDesc] = useState<string | null>(null);
  // Receipt
  const [rFile, setRFile] = useState<File | null>(null);
  const [rAmt, setRAmt] = useState("");
  const [rDesc, setRDesc] = useState("");
  const rInput = useRef<HTMLInputElement>(null);
  // Note
  const [note, setNote] = useState("");
  // Field-level validation messages (red border + text under the field), keyed by field.
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const status = data?.workOrder.status;
  // Already submitted and awaiting review opens on Submitted; anything sent back or needing
  // info opens on Job. Once the technician has navigated, their choice wins, except that
  // "submitted" is never shown for a job that is back in the technician's hands.
  const defaultStep: Step = status === "completed" && !data?.actionRequired ? "submitted" : "job";
  let step: Step = chosenStep ?? defaultStep;
  if (step === "submitted" && !justSubmitted && status !== "completed" && status !== "reviewed_closed") step = "job";

  function go(next: Step) {
    setChosenStep(next);
  }

  // Each step is its own screen: start it at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  if (data === undefined) {
    return (
      <TechCard as="div" className="items-center py-10 text-center">
        <Loader2 aria-hidden className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading the job…</p>
      </TechCard>
    );
  }
  if (data === null) return <NotFound />;

  const { workOrder: wo, unit, property, files, time, expenses, notes, totals } = data;
  const place = property?.address?.formatted ?? property?.name ?? "";
  const inProgress = wo.status === "in_progress";
  const canStart = data.viewerCan.work && wo.status === "assigned";
  const canEdit = data.viewerCan.work && inProgress;
  const finished = wo.status === "completed" || wo.status === "reviewed_closed";
  const photos = files.filter((f) => f.kind === "completion_photo" || f.kind === "completion_video");
  const receipts = files.filter((f) => f.kind === "receipt");
  const propUnit = `${property?.name ?? "Unknown property"} · Unit ${unit.unitNumber}`;
  const woRef = `WO-${wo.number}`;

  function setErr(field: string, message: string | null) {
    setFieldErr((e) => {
      const next = { ...e };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }
  /** Show a message as a toast and mark the field. */
  function invalid(field: string, message: string) {
    setErr(field, message);
    toast(message, "error");
  }

  async function run(label: string, fn: () => Promise<void>, ok?: string) {
    setBusy(label);
    try {
      await fn();
      if (ok) toast(ok, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  /** Upload one blob and attach it. Returns the new file id, or null on failure (shown in the list). */
  async function uploadOne(key: number): Promise<Id<"workOrderFiles"> | null> {
    const entry = blobs.current.get(key);
    if (!entry) return null;
    const patch = (p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));
    patch({ state: "working", pct: 0, error: undefined });
    try {
      const url = await genUrl({ workOrderId: id });
      const storageId = await uploadBlob(url, entry.blob, (pct) => patch({ pct }));
      const res = await attach({ workOrderId: id, storageId: storageId as Id<"_storage">, kind: entry.kind });
      if (!res.ok) {
        patch({ state: "error", error: res.error, retry: false });
        blobs.current.delete(key); // server rejected it; retry would fail the same way
        return null;
      }
      patch({ state: "done", pct: 100 });
      blobs.current.delete(key);
      setTimeout(() => setUploads((u) => u.filter((x) => x.key !== key)), 2500);
      return res.fileId;
    } catch (e) {
      patch({ state: "error", error: errorMessage(e), retry: true });
      return null;
    }
  }

  async function onPhotos(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list)) {
      const key = ++keySeq.current;
      setUploads((u) => [...u, { key, name: file.name || "Photo", pct: 0, state: "working" }]);
      blobs.current.set(key, { blob: await compressImage(file), kind: "completion_photo" });
      await uploadOne(key);
    }
  }

  async function onVideo(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast("Videos can be at most 50 MB.", "error");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const guessed: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogg: "video/ogg", m4v: "video/x-m4v" };
    const type = file.type && file.type !== "application/octet-stream" ? file.type : guessed[ext];
    if (!type) {
      toast("Choose an mp4, webm, or mov video.", "error");
      return;
    }
    const key = ++keySeq.current;
    setUploads((u) => [...u, { key, name: file.name || "Video", pct: 0, state: "working" }]);
    blobs.current.set(key, { blob: type === file.type ? file : new Blob([file], { type }), kind: "completion_video" });
    await uploadOne(key);
  }

  async function onReceipt() {
    const cents = dollarsToCents(rAmt);
    const errs: Record<string, string> = {};
    if (!rFile) errs.rFile = "Take or choose a photo of the receipt.";
    if (cents === null) errs.rAmt = "Enter the amount like 12.50.";
    if (!rDesc.trim()) errs.rDesc = "Add a short description.";
    setFieldErr((e) => {
      const next = { ...e };
      delete next.rFile;
      delete next.rAmt;
      delete next.rDesc;
      return { ...next, ...errs };
    });
    const first = errs.rFile ?? errs.rAmt ?? errs.rDesc;
    if (first || !rFile || cents === null) {
      toast(first ?? "Check the receipt details.", "error");
      return;
    }
    setBusy("receipt");
    const key = ++keySeq.current;
    setUploads((u) => [...u, { key, name: "Receipt", pct: 0, state: "working" }]);
    blobs.current.set(key, { blob: await compressImage(rFile), kind: "receipt" });
    const fileId = await uploadOne(key);
    if (fileId) {
      try {
        await addExpense({ workOrderId: id, kind: "expense", description: rDesc, amountCents: cents, receiptFileId: fileId });
        toast("Receipt added.", "success");
        setRFile(null);
        setRAmt("");
        setRDesc("");
        if (rInput.current) rInput.current.value = "";
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    }
    setBusy(null);
  }

  const workDescText = workDesc ?? wo.workCompletedDescription ?? "";

  async function onSubmit() {
    setSubmitError(null);
    const text = workDescText.trim();
    if (!text) {
      invalid("workDesc", "Describe the work you completed.");
      document.getElementById("work-desc")?.focus();
      return;
    }
    if (text.length > MAX_WORK_DESCRIPTION) {
      invalid("workDesc", "Keep the description under 2,000 characters.");
      document.getElementById("work-desc")?.focus();
      return;
    }
    setBusy("submit");
    try {
      await submit({ workOrderId: id, workCompletedDescription: text });
      setJustSubmitted(true);
      go("submitted");
    } catch (e) {
      setSubmitError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Mirrors the server's submit gate so the button only lights up when it would succeed. The
  // description is part of the gate too, but it is checked on tap so the field can say what is missing.
  const need = wo.requiredOnSubmit;
  const evidenceReady =
    (!need.photos || photos.length > 0) &&
    (!need.hours || time.length > 0) &&
    (!need.receipts || receipts.length > 0) &&
    (!need.notes || notes.length > 0);
  const ready = evidenceReady && workDescText.trim() !== "";
  const missing = submitError?.match(/Missing:\s*(.*?)\.?$/)?.[1]?.split(/,\s*/);
  const hasPets = /\b(pet|pets|dog|dogs|cat|cats)\b/i.test(wo.accessNotes ?? "");
  const preferredTime = tenantPreferredTimeText(wo.tenantPreferredTime);
  const fmtWhen = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const confirm = (
    <ConfirmDialog
      open={removeId !== null}
      title="Remove this photo?"
      message="This can't be undone."
      confirmLabel="Remove"
      danger
      busy={busy !== null}
      onCancel={() => setRemoveId(null)}
      onConfirm={() => {
        const fileId = removeId;
        if (!fileId) return;
        void run("remove", async () => {
          await removeOwn({ workOrderId: id, fileId });
          setRemoveId(null);
        }, "Photo removed");
      }}
    />
  );

  /* ---------------------------------------------------------------- Step 3: Submitted */
  if (step === "submitted") {
    const hoursText = `${fmtHours(totals.hours)} ${totals.hours === 1 ? "hour" : "hours"}`;
    const closed = wo.status === "reviewed_closed";
    return (
      <div className="flex flex-col gap-4">
        <TechPageTitle title="Work submitted" subtitle={`${woRef} · ${propUnit}`} />
        <TechCallout tone="success" role="status" icon={<Check aria-hidden className="h-4 w-4" />} title="Ready for Pat's review">
          Your photos, receipts, hours and notes were submitted together.
        </TechCallout>
        <TechCard>
          <TechHeading>Submission summary</TechHeading>
          <TechRow label="Status" value={closed ? "Closed" : "Completed · awaiting review"} />
          {data.technicianName || wo.completedAt ? (
            <TechRow
              label="Submitted by"
              value={[data.technicianName, wo.completedAt ? fmtWhen(wo.completedAt) : null].filter(Boolean).join(" · ")}
            />
          ) : null}
          <TechRow label="Work recorded" value={`${hoursText} · ${formatCents(totals.expenseCents)} materials`} />
        </TechCard>
        <p className="text-xs text-muted-foreground">
          This job stays in Submitted until office staff review it. You will see any requested corrections here.
        </p>
        <div className="flex flex-col gap-3">
          <TechLinkButton href="/tech" variant="primary">
            Back to my jobs
          </TechLinkButton>
          <TechButton onClick={() => go("job")}>View job details</TechButton>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- Step 2: Evidence & costs */
  if (step === "evidence") {
    return (
      <div className="flex flex-col gap-4">
        {confirm}
        <TechPageTitle title="Evidence & costs" subtitle={`${woRef} · Your updates stay linked to this unit and job`} />

        {(canEdit || photos.length > 0 || uploads.length > 0) && (
          <TechCard>
            <TechHeading>Completion photos ({photos.length})</TechHeading>
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((f) =>
                  f.url ? (
                    <div key={f._id} className="group relative aspect-square">
                      {f.kind === "completion_video" ? (
                        <video src={f.url} controls playsInline className="h-full w-full rounded-[8px] bg-black object-cover" />
                      ) : (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={f.url} alt="Completion photo" className="h-full w-full rounded-[8px] object-cover" />
                        </a>
                      )}
                      {f.canRemove ? (
                        <button
                          type="button"
                          aria-label="Remove photo"
                          title="Remove photo"
                          onClick={() => setRemoveId(f._id)}
                          className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white">
                            <X aria-hidden className="h-4 w-4" />
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null,
                )}
              </div>
            )}
            {uploads.map((u) => (
              <div key={u.key} className="rounded-[8px] border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{u.name}</span>
                  {u.state === "working" && <span className="text-xs text-muted-foreground">{u.pct}%</span>}
                  {u.state === "done" && <Check aria-hidden className="h-4 w-4 text-success-ink" />}
                </div>
                {u.state === "working" && (
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${u.pct}%` }} />
                  </div>
                )}
                {u.state === "error" && (
                  <div className="mt-2 flex flex-col gap-2 text-danger-ink">
                    <span className="break-words text-xs">{u.error}</span>
                    {u.retry ? (
                      <TechButton onClick={() => void uploadOne(u.key)}>
                        <RotateCw aria-hidden className="h-4 w-4" /> Retry
                      </TechButton>
                    ) : (
                      <TechButton onClick={() => setUploads((x) => x.filter((i) => i.key !== u.key))}>Dismiss</TechButton>
                    )}
                  </div>
                )}
              </div>
            ))}
            {canEdit && (
              <div className="flex flex-col gap-3">
                <label className={`${techBtnCls("secondary")} cursor-pointer`}>
                  <Camera aria-hidden className="h-4 w-4" /> Add photos
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                    capture="environment"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      void onPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className={`${techBtnCls("secondary")} cursor-pointer`}>
                  <Video aria-hidden className="h-4 w-4" /> Add video
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm"
                    className="sr-only"
                    onChange={(e) => {
                      void onVideo(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            )}
          </TechCard>
        )}

        {(canEdit || time.length > 0) && (
          <TechCard>
            <TechHeading>Hours on site ({fmtHours(totals.hours)} h)</TechHeading>
            {time.length > 0 && (
              <div className="flex flex-col gap-2">
                {time.map((t) => (
                  <p key={t._id} className="flex justify-between gap-3 rounded-[8px] bg-muted px-3 py-2.5 text-sm">
                    <span>{t.date}</span>
                    <span className="font-medium">{t.hours} h</span>
                  </p>
                ))}
              </div>
            )}
            {canEdit && (
              <>
                <TechField label="Date worked">
                  <DatePicker value={date} onChange={setDate} className="min-h-11 rounded-[8px] text-sm" aria-label="Date worked" />
                </TechField>
                <div className="flex items-center justify-center gap-3">
                  <TechButton
                    aria-label="Less time"
                    disabled={busy !== null || !(Number(hours) > 0)}
                    onClick={() => setHours(String(Math.max(0, (Number(hours) || 0) - 0.25)))}
                    className="!w-11 shrink-0 px-0"
                  >
                    <Minus aria-hidden className="h-4 w-4" />
                  </TechButton>
                  <div className="min-w-20 text-center">
                    <div className="text-[22px] font-semibold tabular-nums" aria-live="polite">
                      {(Number(hours) || 0).toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">hours</div>
                  </div>
                  <TechButton
                    aria-label="More time"
                    disabled={busy !== null || (Number(hours) || 0) >= 24}
                    onClick={() => setHours(String(Math.min(24, (Number(hours) || 0) + 0.25)))}
                    className="!w-11 shrink-0 px-0"
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                  </TechButton>
                </div>
                <TechButton
                  disabled={busy !== null}
                  loading={busy === "time"}
                  onClick={() => {
                    const h = Number(hours);
                    if (!Number.isFinite(h) || h <= 0) {
                      toast("Enter hours worked.", "error");
                      return;
                    }
                    void run("time", () => addTime({ workOrderId: id, date, hours: h }).then(() => undefined), "Hours added.");
                  }}
                >
                  Log hours
                </TechButton>
              </>
            )}
          </TechCard>
        )}

        {(canEdit || expenses.length > 0) && (
          <TechCard>
            <TechHeading>Materials &amp; expenses ({formatCents(totals.expenseCents)})</TechHeading>
            {expenses.length > 0 && (
              <div className="flex flex-col gap-2">
                {expenses.map((e) => (
                  <p key={e._id} className="flex justify-between gap-3 rounded-[8px] bg-muted px-3 py-2.5 text-sm">
                    <span className="min-w-0 break-words">
                      {e.description}
                      {e.quantity && e.quantity !== 1 ? ` x${e.quantity}` : ""}
                      {/* Older lines saved before SWEEP / REIMB existed show no tag. */}
                      {e.kind === "material" && e.reimbursable !== undefined ? (
                        <TechBadge tone={e.reimbursable ? "warning" : "neutral"} className="ml-2 align-middle">
                          {e.reimbursable ? "REIMB" : "SWEEP"}
                        </TechBadge>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-medium">{formatCents(e.amountCents)}</span>
                  </p>
                ))}
              </div>
            )}
            {canEdit && (
              <>
                <TechField label="Description" htmlFor="m-desc" error={fieldErr.mDesc}>
                  <input
                    id="m-desc"
                    placeholder="What was used"
                    value={mDesc}
                    onChange={(e) => {
                      setMDesc(e.target.value);
                      setErr("mDesc", null);
                    }}
                    maxLength={300}
                    aria-invalid={!!fieldErr.mDesc}
                    className={techInputCls(!!fieldErr.mDesc)}
                  />
                </TechField>
                <div className="flex gap-3">
                  <TechField label="Quantity" htmlFor="m-qty" error={fieldErr.mQty} className="w-24 shrink-0">
                    <input
                      id="m-qty"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={mQty}
                      onChange={(e) => {
                        setMQty(e.target.value);
                        setErr("mQty", null);
                      }}
                      aria-invalid={!!fieldErr.mQty}
                      className={techInputCls(!!fieldErr.mQty)}
                    />
                  </TechField>
                  <TechField label="Total ($)" htmlFor="m-amt" error={fieldErr.mAmt} className="min-w-0 flex-1">
                    <input
                      id="m-amt"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={mAmt}
                      onChange={(e) => {
                        setMAmt(e.target.value);
                        setErr("mAmt", null);
                      }}
                      aria-invalid={!!fieldErr.mAmt}
                      className={techInputCls(!!fieldErr.mAmt)}
                    />
                  </TechField>
                </div>
                <TechField label="Who paid? *" error={fieldErr.mPaidBy}>
                  <div
                    id="m-paid-by"
                    tabIndex={-1}
                    className={fieldErr.mPaidBy ? "rounded-[10px] ring-1 ring-danger-ink" : undefined}
                  >
                    <TechSeg<PaidBy>
                      label="Who paid for this material"
                      value={mPaidBy}
                      options={PAID_BY_OPTIONS}
                      onChange={(v) => {
                        setMPaidBy(v);
                        setErr("mPaidBy", null);
                      }}
                    />
                  </div>
                </TechField>
                <TechButton
                  disabled={busy !== null}
                  loading={busy === "material"}
                  onClick={() => {
                    const cents = dollarsToCents(mAmt);
                    const qty = Number(mQty);
                    if (cents === null) {
                      invalid("mAmt", "Enter the amount like 12.50.");
                      return;
                    }
                    if (!Number.isFinite(qty) || qty <= 0) {
                      invalid("mQty", "Quantity must be more than zero.");
                      return;
                    }
                    if (mPaidBy !== "sweep" && mPaidBy !== "reimb") {
                      invalid("mPaidBy", "Choose SWEEP or REIMB for this material.");
                      document.getElementById("m-paid-by")?.focus();
                      return;
                    }
                    const reimbursable = mPaidBy === "reimb";
                    void run(
                      "material",
                      async () => {
                        await addExpense({
                          workOrderId: id,
                          kind: "material",
                          description: mDesc,
                          amountCents: cents,
                          quantity: qty,
                          reimbursable,
                        });
                        setMDesc("");
                        setMAmt("");
                        setMQty("1");
                        setMPaidBy("");
                        setFieldErr((f) => {
                          const next = { ...f };
                          delete next.mDesc;
                          delete next.mAmt;
                          delete next.mQty;
                          delete next.mPaidBy;
                          return next;
                        });
                      },
                      "Added.",
                    );
                  }}
                >
                  Add material / expense
                </TechButton>
              </>
            )}
          </TechCard>
        )}

        {(canEdit || receipts.length > 0) && (
          <TechCard>
            <TechHeading>Receipt</TechHeading>
            {canEdit && (
              <>
                <TechField label="Receipt photo" error={fieldErr.rFile}>
                  <label className={`${techBtnCls("secondary", fieldErr.rFile ? "!border-danger-ink" : undefined)} cursor-pointer`}>
                    <Receipt aria-hidden className="h-4 w-4" /> {rFile ? "Receipt photo ready" : "Photo of receipt"}
                    <input
                      ref={rInput}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={(e) => {
                        setRFile(e.target.files?.[0] ?? null);
                        setErr("rFile", null);
                      }}
                    />
                  </label>
                </TechField>
                <TechField label="Amount ($)" htmlFor="r-amt" error={fieldErr.rAmt}>
                  <input
                    id="r-amt"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={rAmt}
                    onChange={(e) => {
                      setRAmt(e.target.value);
                      setErr("rAmt", null);
                    }}
                    aria-invalid={!!fieldErr.rAmt}
                    className={techInputCls(!!fieldErr.rAmt)}
                  />
                </TechField>
                <TechField label="What was it for?" htmlFor="r-desc" error={fieldErr.rDesc}>
                  <input
                    id="r-desc"
                    placeholder="Short description"
                    value={rDesc}
                    onChange={(e) => {
                      setRDesc(e.target.value);
                      setErr("rDesc", null);
                    }}
                    maxLength={300}
                    aria-invalid={!!fieldErr.rDesc}
                    className={techInputCls(!!fieldErr.rDesc)}
                  />
                </TechField>
                <TechButton onClick={() => void onReceipt()} disabled={busy !== null} loading={busy === "receipt"}>
                  Save receipt
                </TechButton>
              </>
            )}
            {receipts.length > 0 && <p className="text-xs text-muted-foreground">{receipts.length} receipt photo(s) attached.</p>}
          </TechCard>
        )}

        {canEdit ? (
          <>
            <TechCard>
              <TechHeading>Description of work completed *</TechHeading>
              <TechField label="What you did, in a sentence or two" htmlFor="work-desc" error={fieldErr.workDesc}>
                <textarea
                  id="work-desc"
                  value={workDescText}
                  onChange={(e) => {
                    setWorkDesc(e.target.value);
                    setErr("workDesc", null);
                  }}
                  rows={3}
                  maxLength={MAX_WORK_DESCRIPTION}
                  placeholder="e.g. Replaced the kitchen faucet cartridge and tested for leaks"
                  aria-invalid={!!fieldErr.workDesc}
                  className={techInputCls(!!fieldErr.workDesc)}
                />
              </TechField>
            </TechCard>
            <p className="text-xs text-muted-foreground">
              {ready
                ? "Pat gets the photos, receipts and hours right away."
                : evidenceReady
                  ? "Describe the work you completed to submit."
                  : "Add what is still needed (photo, hours, receipt or note) to submit."}
            </p>
            {submitError && (
              <TechCallout
                tone="danger"
                role="alert"
                icon={<AlertTriangle aria-hidden className="h-4 w-4" />}
                title={missing ? "Can't submit yet. Still needed:" : submitError}
              >
                {missing && (
                  <ul className="list-disc pl-5">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </TechCallout>
            )}
            <div className="flex flex-col gap-3">
              <TechButton variant="primary" onClick={() => void onSubmit()} disabled={busy !== null || !evidenceReady} loading={busy === "submit"}>
                Submit completed work
              </TechButton>
              <TechButton onClick={() => go("job")}>Back to job</TechButton>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <TechButton onClick={() => go(finished ? "submitted" : "job")}>{finished ? "Back to summary" : "Back to job"}</TechButton>
          </div>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------------- Step 1: Job */
  return (
    <div className="flex flex-col gap-4">
      {confirm}
      <TechPageTitle title={wo.title} subtitle={`${woRef} · ${propUnit}`} />

      <div className="flex flex-wrap gap-2">
        <TechBadge tone="info">{STATUS_LABEL[wo.status] ?? wo.status}</TechBadge>
        <PriorityBadge level={wo.priority} />
        {data.actionRequired ? (
          <TechBadge tone="warning">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> Action required
          </TechBadge>
        ) : null}
      </div>

      {data.actionRequired && (
        <TechCallout
          tone="warning"
          role="alert"
          icon={<AlertTriangle aria-hidden className="h-4 w-4" />}
          title={
            data.actionRequired.kind === "sent_back"
              ? `Action required: ${data.actionRequired.byName ?? "Pat"} sent this back`
              : `Action required: ${data.actionRequired.byName ?? "Pat"} needs more info`
          }
        >
          <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-warning pl-3 text-sm font-medium">
            &ldquo;{data.actionRequired.note}&rdquo;
          </blockquote>
          <p className="mt-2">
            {fmtWhen(data.actionRequired.at)}
            {" · "}
            {data.actionRequired.kind === "sent_back"
              ? "Fix it, add a note, then mark complete again."
              : "Add a note with the information, then continue the job."}
          </p>
        </TechCallout>
      )}

      {wo.accessNotes && (
        <TechCallout
          tone={hasPets ? "warning" : "info"}
          icon={hasPets ? <PawPrint aria-hidden className="h-4 w-4" /> : undefined}
          title="Access notes"
        >
          <span className="whitespace-pre-wrap break-words">{wo.accessNotes}</span>
        </TechCallout>
      )}

      {wo.status === "completed" && (
        <TechCallout tone="success" role="status" icon={<Check aria-hidden className="h-4 w-4" />} title="Sent to Pat for review" />
      )}
      {wo.status === "reviewed_closed" && <TechCallout tone="info" title="This job is closed." />}

      <TechCard>
        <TechHeading>Scope</TechHeading>
        <p className="whitespace-pre-wrap break-words text-sm">{wo.scope}</p>
        <div className="flex flex-col gap-3">
          <TechRow label="Location" value={`${place || property?.name || ""} · Unit ${unit.unitNumber}`} />
          {wo.window ? <TechRow label="Appointment" value={wo.window} /> : null}
          {preferredTime ? <TechRow label="Tenant's preferred time" value={preferredTime} /> : null}
          {wo.dueDate !== undefined ? <TechRow label="Due" value={formatDate(wo.dueDate)} /> : null}
        </div>
        {preferredTime ? <p className="-mt-2 text-xs text-muted-foreground">What the tenant asked for, not a scheduled visit.</p> : null}
        <a
          href={mapsUrl(place || unit.unitNumber)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
        >
          <MapPin aria-hidden className="h-4 w-4 shrink-0" />
          Open in maps
        </a>
      </TechCard>

      {(canEdit || notes.length > 0) && (
        <TechCard>
          <TechHeading>Work notes</TechHeading>
          {notes.length > 0 && (
            <div className="flex flex-col gap-2">
              {notes.map((n) => (
                <p key={n._id} className="whitespace-pre-wrap break-words rounded-[8px] bg-muted p-3 text-sm">
                  {n.body}
                </p>
              ))}
            </div>
          )}
          {canEdit && (
            <>
              <TechField label="What you found and what you did" htmlFor="job-note">
                <textarea
                  id="job-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Add a note for Pat"
                  className={techInputCls(false)}
                />
              </TechField>
              <TechButton
                disabled={busy !== null || !note.trim()}
                loading={busy === "note"}
                onClick={() =>
                  void run(
                    "note",
                    async () => {
                      await addNote({ workOrderId: id, body: note });
                      setNote("");
                    },
                    "Note added.",
                  )
                }
              >
                Add note
              </TechButton>
            </>
          )}
        </TechCard>
      )}

      <div className="flex flex-col gap-3">
        {canStart && (
          <TechButton
            variant="primary"
            disabled={busy !== null}
            loading={busy === "start"}
            onClick={() => void run("start", async () => { await start({ workOrderId: id }); }, "Job started.")}
          >
            Start job
          </TechButton>
        )}
        {canEdit && (
          <TechButton variant="primary" onClick={() => go("evidence")}>
            Add evidence &amp; costs
          </TechButton>
        )}
        {finished && (
          <TechButton onClick={() => go("evidence")}>View evidence &amp; costs</TechButton>
        )}
        {wo.status === "completed" && (
          <TechButton onClick={() => go("submitted")}>Back to summary</TechButton>
        )}
        <TechLinkButton href="/tech">Back to my jobs</TechLinkButton>
      </div>
    </div>
  );
}
