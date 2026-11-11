"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowLeft, Camera, Check, Loader2, MapPin, Minus, PawPrint, Plus, Receipt, RotateCw, Video, X } from "lucide-react";
import Link from "next/link";
import { Component, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, DatePicker, Pill, SevChip } from "@/components/ui";
import { errorMessage, useToast } from "@/components/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { tenantPreferredTimeText } from "@/convex/workOrderWindow";
import { STATUS_LABEL, compressImage, dollarsToCents, formatCents, formatDate, mapsUrl, todayLocalIso, uploadBlob } from "./lib";

function NotFound() {
  return (
    <div className="rounded-[20px] border border-border bg-card p-8 text-center">
      <h1 className="text-lg font-semibold">Job not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">It may have been reassigned or removed.</p>
      <Link
        href="/tech"
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[14px] bg-primary px-5 text-sm font-semibold text-primary-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to my jobs
      </Link>
    </div>
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

const inputCls = "min-h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus:border-ring";
const btnCls =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-muted disabled:opacity-45";
const bigBtnCls =
  "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3 flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

type UploadItem = { key: number; name: string; pct: number; state: "working" | "error" | "done"; error?: string; retry?: boolean };

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

  // Hours
  const [date, setDate] = useState(todayLocalIso);
  const [hours, setHours] = useState("1");
  // Materials
  const [mDesc, setMDesc] = useState("");
  const [mQty, setMQty] = useState("1");
  const [mAmt, setMAmt] = useState("");
  // Receipt
  const [rFile, setRFile] = useState<File | null>(null);
  const [rAmt, setRAmt] = useState("");
  const [rDesc, setRDesc] = useState("");
  const rInput = useRef<HTMLInputElement>(null);
  // Note
  const [note, setNote] = useState("");

  if (data === undefined) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (data === null) return <NotFound />;

  const { workOrder: wo, unit, property, files, time, expenses, notes, totals } = data;
  const place = property?.address?.formatted ?? property?.name ?? "";
  const inProgress = wo.status === "in_progress";
  const canStart = data.viewerCan.work && wo.status === "assigned";
  const canEdit = data.viewerCan.work && inProgress;
  const photos = files.filter((f) => f.kind === "completion_photo" || f.kind === "completion_video");
  const receipts = files.filter((f) => f.kind === "receipt");

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
    if (!rFile) return toast("Take or choose a photo of the receipt.", "error");
    if (cents === null) return toast("Enter the amount like 12.50.", "error");
    if (!rDesc.trim()) return toast("Add a short description.", "error");
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

  async function onSubmit() {
    setSubmitError(null);
    setBusy("submit");
    try {
      await submit({ workOrderId: id });
      setJustSubmitted(true);
    } catch (e) {
      setSubmitError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Mirrors the server's submit gate so the button only lights up when it would succeed.
  const need = wo.requiredOnSubmit;
  const ready =
    (!need.photos || photos.length > 0) &&
    (!need.hours || time.length > 0) &&
    (!need.receipts || receipts.length > 0) &&
    (!need.notes || notes.length > 0);
  const missing = submitError?.match(/Missing:\s*(.*?)\.?$/)?.[1]?.split(/,\s*/);
  const hasPets = /\b(pet|pets|dog|dogs|cat|cats)\b/i.test(wo.accessNotes ?? "");
  const preferredTime = tenantPreferredTimeText(wo.tenantPreferredTime);

  return (
    <div className={canEdit ? "pb-28" : "pb-6"}>
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
      <Link href="/tech" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> My jobs
      </Link>

      <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">WO-{wo.number}</span>
        <SevChip level={wo.priority} />
      </p>
      <h1 className="mt-1 text-xl font-semibold leading-snug">{wo.title}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Pill>{STATUS_LABEL[wo.status] ?? wo.status}</Pill>
        {data.actionRequired ? (
          <Pill tone="warn" className="font-semibold">
            <AlertTriangle className="h-3 w-3" /> Action required
          </Pill>
        ) : null}
        {wo.window ? <Pill tone="warn">{wo.window}</Pill> : null}
        {wo.dueDate !== undefined ? <span>Due {formatDate(wo.dueDate)}</span> : null}
      </p>

      {data.actionRequired && (
        <div role="alert" className="mt-3 rounded-2xl border border-warning bg-warning-soft p-3.5 text-warning-ink">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {data.actionRequired.kind === "sent_back"
              ? `Action required: ${data.actionRequired.byName ?? "Pat"} sent this back`
              : `Action required: ${data.actionRequired.byName ?? "Pat"} needs more info`}
          </p>
          <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-warning pl-3 text-sm font-medium">
            &ldquo;{data.actionRequired.note}&rdquo;
          </blockquote>
          <p className="mt-2 text-xs">
            {new Date(data.actionRequired.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {" · "}
            {data.actionRequired.kind === "sent_back"
              ? "Fix it, add a note, then mark complete again."
              : "Add a note with the information, then continue the job."}
          </p>
        </div>
      )}

      <a
        href={mapsUrl(place || unit.unitNumber)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex min-h-11 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-medium text-primary"
      >
        <MapPin className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          {place || property?.name} · Unit {unit.unitNumber}
        </span>
      </a>

      {wo.accessNotes && (
        <p className={`mt-3 flex gap-2 rounded-2xl p-3 text-sm ${hasPets ? "bg-warning-soft font-medium text-warning-ink" : "bg-muted"}`}>
          {hasPets && <PawPrint className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            <span className="block text-xs font-semibold uppercase text-muted-foreground">Access</span>
            {wo.accessNotes}
          </span>
        </p>
      )}

      {preferredTime && (
        <p className="mt-3 rounded-2xl bg-muted p-3 text-sm">
          <span className="block text-xs font-semibold uppercase text-muted-foreground">Tenant&apos;s preferred time</span>
          <span className="block break-words">{preferredTime}</span>
          <span className="mt-1 block text-xs text-muted-foreground">What the tenant asked for, not a scheduled visit.</span>
        </p>
      )}

      <Section title="Scope">
        <p className="whitespace-pre-wrap text-sm">{wo.scope}</p>
      </Section>

      {(justSubmitted || wo.status === "completed") && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-success-soft p-4 text-sm font-medium text-success-ink">
          <Check className="h-5 w-5 shrink-0" />
          Sent to Pat for review
        </div>
      )}
      {wo.status === "reviewed_closed" && (
        <div className="mt-3 rounded-2xl bg-muted p-4 text-sm font-medium">This job is closed.</div>
      )}

      {canStart && (
        <button
          onClick={() => void run("start", async () => { await start({ workOrderId: id }); }, "Job started.")}
          disabled={busy !== null}
          className={`mt-3 ${bigBtnCls}`}
        >
          {busy === "start" && <Loader2 className="h-5 w-5 animate-spin" />}
          Start job
        </button>
      )}

      {(canEdit || photos.length > 0) && (
        <Section title={`Photos & videos (${photos.length})`}>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((f) =>
                f.url ? (
                  <div key={f._id} className="group relative aspect-square">
                    {f.kind === "completion_video" ? (
                      <video src={f.url} controls playsInline className="h-full w-full rounded-xl bg-black object-cover" />
                    ) : (
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt="Completion photo" className="h-full w-full rounded-xl object-cover" />
                      </a>
                    )}
                    {f.canRemove ? (
                      <button
                        type="button"
                        aria-label="Remove photo"
                        title="Remove photo"
                        onClick={() => setRemoveId(f._id)}
                        className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-black/65 text-white focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                      >
                        <X aria-hidden className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ) : null,
              )}
            </div>
          )}
          {uploads.map((u) => (
            <div key={u.key} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{u.name}</span>
                {u.state === "working" && <span>{u.pct}%</span>}
                {u.state === "done" && <Check className="h-4 w-4 text-success-ink" />}
              </div>
              {u.state === "working" && (
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${u.pct}%` }} />
                </div>
              )}
              {u.state === "error" && (
                <div className="mt-2 flex items-center justify-between gap-2 text-danger-ink">
                  <span>{u.error}</span>
                  {u.retry ? (
                    <button onClick={() => void uploadOne(u.key)} className={`${btnCls} text-foreground`}>
                      <RotateCw className="h-4 w-4" /> Retry
                    </button>
                  ) : (
                    <button onClick={() => setUploads((x) => x.filter((i) => i.key !== u.key))} className={`${btnCls} text-foreground`}>
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="flex flex-col gap-2">
            <label className={`${btnCls} cursor-pointer`}>
              <Camera className="h-5 w-5" /> Add photos
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
            <label className={`${btnCls} cursor-pointer`}>
              <Video className="h-5 w-5" /> Add video
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
        </Section>
      )}

      {(canEdit || receipts.length > 0) && (
        <Section title="Add receipt">
          {canEdit && (
            <>
              <label className={`${btnCls} cursor-pointer`}>
                <Receipt className="h-5 w-5" /> {rFile ? "Receipt photo ready" : "Photo of receipt"}
                <input
                  ref={rInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => setRFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <input
                inputMode="decimal"
                placeholder="Amount ($)"
                value={rAmt}
                onChange={(e) => setRAmt(e.target.value)}
                className={inputCls}
              />
              <input placeholder="What was it for?" value={rDesc} onChange={(e) => setRDesc(e.target.value)} maxLength={300} className={inputCls} />
              <button onClick={() => void onReceipt()} disabled={busy !== null} className={`${btnCls} w-full`}>
                {busy === "receipt" && <Loader2 className="h-4 w-4 animate-spin" />} Save receipt
              </button>
            </>
          )}
          {receipts.length > 0 && <p className="text-sm text-muted-foreground">{receipts.length} receipt photo(s) attached.</p>}
        </Section>
      )}

      {(canEdit || time.length > 0) && (
        <Section title={`Hours on site (${totals.hours} h)`}>
          {time.map((t) => (
            <p key={t._id} className="flex justify-between text-sm">
              <span>{t.date}</span>
              <span className="font-medium">{t.hours} h</span>
            </p>
          ))}
          {canEdit && (
            <div className="space-y-3">
              <DatePicker
                value={date}
                onChange={setDate}
                className="min-h-11 text-base"
                aria-label="Date worked"
              />
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  aria-label="Less time"
                  disabled={busy !== null || !(Number(hours) > 0)}
                  onClick={() => setHours(String(Math.max(0, (Number(hours) || 0) - 0.25)))}
                  className={`${btnCls} w-11 px-0`}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="min-w-16 text-center">
                  <div className="text-[22px] font-semibold tabular-nums" aria-live="polite">
                    {(Number(hours) || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">hours</div>
                </div>
                <button
                  type="button"
                  aria-label="More time"
                  disabled={busy !== null || (Number(hours) || 0) >= 24}
                  onClick={() => setHours(String(Math.min(24, (Number(hours) || 0) + 0.25)))}
                  className={`${btnCls} w-11 px-0`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                disabled={busy !== null}
                onClick={() => {
                  const h = Number(hours);
                  if (!Number.isFinite(h) || h <= 0) {
                    toast("Enter hours worked.", "error");
                    return;
                  }
                  void run("time", () => addTime({ workOrderId: id, date, hours: h }).then(() => undefined), "Hours added.");
                }}
                className={`${btnCls} w-full`}
              >
                Log hours
              </button>
            </div>
          )}
        </Section>
      )}

      {(canEdit || expenses.length > 0) && (
        <Section title={`Materials & expenses (${formatCents(totals.expenseCents)})`}>
          {expenses.map((e) => (
            <p key={e._id} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0">
                {e.description}
                {e.quantity && e.quantity !== 1 ? ` x${e.quantity}` : ""}
              </span>
              <span className="shrink-0 font-medium">{formatCents(e.amountCents)}</span>
            </p>
          ))}
          {canEdit && (
            <>
              <input placeholder="Description" value={mDesc} onChange={(e) => setMDesc(e.target.value)} maxLength={300} className={inputCls} />
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={mQty}
                  onChange={(e) => setMQty(e.target.value)}
                  className={`${inputCls} w-24`}
                  aria-label="Quantity"
                />
                <input
                  inputMode="decimal"
                  placeholder="Total ($)"
                  value={mAmt}
                  onChange={(e) => setMAmt(e.target.value)}
                  className={inputCls}
                />
              </div>
              <button
                disabled={busy !== null}
                className={`${btnCls} w-full`}
                onClick={() => {
                  const cents = dollarsToCents(mAmt);
                  const qty = Number(mQty);
                  if (cents === null) {
                    toast("Enter the amount like 12.50.", "error");
                    return;
                  }
                  if (!Number.isFinite(qty) || qty <= 0) {
                    toast("Quantity must be more than zero.", "error");
                    return;
                  }
                  void run(
                    "material",
                    async () => {
                      await addExpense({ workOrderId: id, kind: "material", description: mDesc, amountCents: cents, quantity: qty });
                      setMDesc("");
                      setMAmt("");
                      setMQty("1");
                    },
                    "Added.",
                  );
                }}
              >
                Add material / expense
              </button>
            </>
          )}
        </Section>
      )}

      {(canEdit || notes.length > 0) && (
        <Section title="Notes for Pat">
          {notes.map((n) => (
            <p key={n._id} className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">
              {n.body}
            </p>
          ))}
          {canEdit && (
            <>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="What you found and what you did"
                className="w-full rounded-xl border border-input bg-card p-3 text-base outline-none focus:border-ring"
              />
              <button
                disabled={busy !== null || !note.trim()}
                className={`${btnCls} w-full`}
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
              </button>
            </>
          )}
        </Section>
      )}

      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
          <div className="mx-auto max-w-2xl">
            {submitError && (
              <div role="alert" className="mb-3 rounded-2xl bg-danger-soft p-3 text-sm text-danger-ink">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {missing ? "Can't submit yet. Still needed:" : submitError}
                </p>
                {missing && (
                  <ul className="mt-1 list-disc pl-6">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <button
              onClick={() => void onSubmit()}
              disabled={busy !== null || !ready}
              className={bigBtnCls}
            >
              {busy === "submit" && <Loader2 className="h-5 w-5 animate-spin" />}
              Mark complete
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {ready
                ? "Pat gets the photos, receipts and hours right away."
                : "Add what is still needed (photo, hours, receipt or note) to submit."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
