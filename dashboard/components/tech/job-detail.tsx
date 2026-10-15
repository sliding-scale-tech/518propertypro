"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowLeft, Camera, Check, Loader2, MapPin, PawPrint, Receipt, RotateCw } from "lucide-react";
import Link from "next/link";
import { Component, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { STATUS_LABEL, compressImage, dollarsToCents, errorMessage, formatCents, formatDate, mapsUrl, todayLocalIso, uploadBlob } from "./lib";

function NotFound() {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center">
      <h1 className="text-lg font-semibold">Job not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">It may have been reassigned or removed.</p>
      <Link
        href="/tech"
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
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

const inputCls = "min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base";
const btnCls =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

type UploadItem = { key: number; name: string; pct: number; state: "working" | "error" | "done"; error?: string; retry?: boolean };

function JobBody({ id }: { id: Id<"workOrders"> }) {
  const toast = useToast();
  const data = useQuery(api.workOrders.get, { workOrderId: id });
  const start = useMutation(api.workOrders.start);
  const toggle = useMutation(api.workOrders.toggleChecklistItem);
  const addTime = useMutation(api.workOrders.addTime);
  const addExpense = useMutation(api.workOrders.addExpense);
  const addNote = useMutation(api.workOrders.addNote);
  const genUrl = useMutation(api.workOrders.generateUploadUrl);
  const attach = useMutation(api.workOrders.attachFile);
  const submit = useMutation(api.workOrders.submitCompleted);

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const blobs = useRef(new Map<number, { blob: Blob; kind: "completion_photo" | "receipt" }>());
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
  const photos = files.filter((f) => f.kind === "completion_photo");
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

  async function onToggle(itemId: string, done: boolean) {
    setOverrides((o) => ({ ...o, [itemId]: done }));
    try {
      await toggle({ workOrderId: id, itemId, done });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setOverrides((o) => {
        const next = { ...o };
        delete next[itemId];
        return next;
      });
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

  const missing = submitError?.match(/Missing:\s*(.*?)\.?$/)?.[1]?.split(/,\s*/);
  const hasPets = /\b(pet|pets|dog|dogs|cat|cats)\b/i.test(wo.accessNotes ?? "");

  return (
    <div className={canEdit ? "pb-28" : "pb-6"}>
      <Link href="/tech" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> My jobs
      </Link>

      <h1 className="mt-1 text-xl font-semibold leading-snug">{wo.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {STATUS_LABEL[wo.status] ?? wo.status}
        {wo.dueDate !== undefined ? ` · Due ${formatDate(wo.dueDate)}` : ""}
      </p>

      <a
        href={mapsUrl(place || unit.unitNumber)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-muted px-3 text-sm font-medium text-primary"
      >
        <MapPin className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          {place || property?.name} · Unit {unit.unitNumber}
        </span>
      </a>

      {wo.accessNotes && (
        <p className={`mt-3 flex gap-2 rounded-xl p-3 text-sm ${hasPets ? "bg-warning/15 font-medium" : "bg-muted"}`}>
          {hasPets && <PawPrint className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            <span className="block text-xs font-semibold uppercase text-muted-foreground">Access</span>
            {wo.accessNotes}
          </span>
        </p>
      )}

      <Section title="Scope">
        <p className="whitespace-pre-wrap text-sm">{wo.scope}</p>
      </Section>

      {(justSubmitted || wo.status === "completed") && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm font-medium">
          <Check className="h-5 w-5 shrink-0 text-success" />
          Sent to Pat for review
        </div>
      )}
      {wo.status === "reviewed_closed" && (
        <div className="mt-6 rounded-2xl bg-muted p-4 text-sm font-medium">This job is closed.</div>
      )}

      {canStart && (
        <button
          onClick={() => void run("start", async () => { await start({ workOrderId: id }); }, "Job started.")}
          disabled={busy !== null}
          className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy === "start" && <Loader2 className="h-5 w-5 animate-spin" />}
          Start job
        </button>
      )}

      {wo.checklist.length > 0 && (
        <Section title={`Checklist (${wo.checklist.filter((c) => overrides[c.id] ?? c.done).length}/${wo.checklist.length})`}>
          <ul className="space-y-2">
            {wo.checklist.map((c) => {
              const done = overrides[c.id] ?? c.done;
              return (
                <li key={c.id}>
                  <label
                    className={`flex min-h-12 items-center gap-3 rounded-xl border border-border px-3 py-2 ${
                      canEdit ? "" : "opacity-80"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={!canEdit}
                      onChange={(e) => void onToggle(c.id, e.target.checked)}
                      className="h-7 w-7 shrink-0 accent-primary"
                    />
                    <span className={`text-sm ${done ? "text-muted-foreground line-through" : ""}`}>
                      {c.label}
                      {c.required && <span className="ml-1 text-xs text-destructive">required</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {(canEdit || photos.length > 0) && (
        <Section title={`Photos (${photos.length})`}>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((f) =>
                f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={f._id} src={f.url} alt="Completion photo" className="aspect-square w-full rounded-lg object-cover" />
                ) : null,
              )}
            </div>
          )}
          {uploads.map((u) => (
            <div key={u.key} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{u.name}</span>
                {u.state === "working" && <span>{u.pct}%</span>}
                {u.state === "done" && <Check className="h-4 w-4 text-success" />}
              </div>
              {u.state === "working" && (
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${u.pct}%` }} />
                </div>
              )}
              {u.state === "error" && (
                <div className="mt-2 flex items-center justify-between gap-2 text-destructive">
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
            <label className={`${btnCls} cursor-pointer`}>
              <Camera className="h-5 w-5" /> Add photos
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(e) => {
                  void onPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
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
        <Section title={`Hours (${totals.hours} h)`}>
          {time.map((t) => (
            <p key={t._id} className="flex justify-between text-sm">
              <span>{t.date}</span>
              <span className="font-medium">{t.hours} h</span>
            </p>
          ))}
          {canEdit && (
            <div className="flex gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              <input
                type="number"
                inputMode="decimal"
                step={0.25}
                min={0.25}
                max={24}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className={`${inputCls} w-24`}
                aria-label="Hours"
              />
              <button
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "time",
                    async () => {
                      const h = Number(hours);
                      if (!Number.isFinite(h) || h <= 0) throw new Error("Enter hours worked.");
                      await addTime({ workOrderId: id, date, hours: h });
                    },
                    "Hours added.",
                  )
                }
                className={`${btnCls} shrink-0`}
              >
                Add
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
                onClick={() =>
                  void run(
                    "material",
                    async () => {
                      const cents = dollarsToCents(mAmt);
                      const qty = Number(mQty);
                      if (cents === null) throw new Error("Enter the amount like 12.50.");
                      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity must be more than zero.");
                      await addExpense({ workOrderId: id, kind: "material", description: mDesc, amountCents: cents, quantity: qty });
                      setMDesc("");
                      setMAmt("");
                      setMQty("1");
                    },
                    "Added.",
                  )
                }
              >
                Add material / expense
              </button>
            </>
          )}
        </Section>
      )}

      {(canEdit || notes.length > 0) && (
        <Section title="Notes">
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
                placeholder="What did you find or do?"
                className="w-full rounded-xl border border-border bg-background p-3 text-base"
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
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
          <div className="mx-auto max-w-2xl">
            {submitError && (
              <div role="alert" className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
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
              disabled={busy !== null}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy === "submit" && <Loader2 className="h-5 w-5 animate-spin" />}
              Submit as completed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
