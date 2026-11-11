"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Clock, FileText, Phone, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConfirmDialog, Drawer, Textarea, Timeline, WaitNote, cx } from "@/components/ui";
import { errorMessage, toast } from "@/components/ui/toast";
import { browserTimeZone } from "@/components/dashboard/format";
import { CallDetails } from "@/components/work-orders/format";
import { TenantPreferredTime, WindowPicker, type WindowValue } from "@/components/work-orders/window-picker";
import type { ItemRef } from "./board";
import { StatusPill } from "./chips";
import { DesignSelect } from "./design-select";
import { RejectPanel } from "./reject-panel";
import {
  PRIORITY_LEVELS,
  auditText,
  fmtCreated,
  fmtDateTime,
  fmtLong,
  fmtMoney,
  hoursText,
  priorityOf,
  safeUrl,
  shortPerson,
  type Severity,
  type StatusKey,
} from "./shared";

type Detail = NonNullable<FunctionReturnType<typeof api.board.detail>>;
type Step = "view" | "create" | "info" | "withdraw" | "reject";
type Media = { id: string; url: string | null; kind: "photo" | "video"; canRemove?: boolean };

/** Small "x" overlay for a thumbnail: hover/focus on desktop, always visible on touch. */
function RemoveBtn({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Remove photo"
      title="Remove photo"
      onClick={onClick}
      className={cx(
        "absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white opacity-100 transition-opacity hover:bg-rose-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
        className,
      )}
    >
      <X aria-hidden className="h-4 w-4" />
    </button>
  );
}

const MAX_PHOTO = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "video/3gpp",
  "video/3gpp2",
  "video/x-m4v",
]);
const EXT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogg: "video/ogg",
  "3gp": "video/3gpp",
  m4v: "video/x-m4v",
};

/** Content type to upload with, or null when the file is not an allowed photo / video. */
function uploadType(file: File): { type: string; media: "photo" | "video" } | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = file.type && file.type !== "application/octet-stream" ? file.type : (EXT_TYPE[ext] ?? "");
  if (IMAGE_TYPES.has(type)) return { type, media: "photo" };
  if (VIDEO_TYPES.has(type)) return { type, media: "video" };
  return null;
}

function useRun() {
  const [busy, setBusy] = useState(false);
  /** Runs fn, toasts the outcome, resolves true on success. */
  const run = async (fn: () => Promise<unknown>, okMessage?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      if (okMessage) toast.success(okMessage);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// --- Small UI pieces -------------------------------------------------------------------------

function Labeled({ label, extra, children }: { label: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-500">
        {label}
        {extra}
      </span>
      {children}
    </div>
  );
}

type ActionTone = "primary" | "outline" | "danger";
const ACTION_TONE: Record<ActionTone, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 border border-blue-600",
  outline: "bg-white text-blue-600 border border-blue-500 hover:bg-blue-50",
  danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
};

function ActionBtn({
  tone,
  children,
  ...rest
}: { tone: ActionTone; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "h-11 w-full rounded-lg text-[13.5px] font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        ACTION_TONE[tone],
      )}
    >
      {children}
    </button>
  );
}

function MediaGrid({
  items,
  onAdd,
  onRemove,
  uploading,
  reason,
}: {
  items: Media[];
  onAdd?: (files: FileList) => void;
  /** Asks to remove one item (the parent confirms); the button shows only on items with canRemove. */
  onRemove?: (id: string) => void;
  uploading: boolean;
  /** Shown (muted) under the grid when the viewer can't add. */
  reason?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
    {!onAdd && reason ? <p className="text-[12px] text-slate-500">{reason}</p> : null}
    {items.length === 0 ? <p className="text-[12.5px] text-slate-500">No photos yet.</p> : null}
    <div className="grid grid-cols-4 gap-2">
      {items.map((m) => {
        const url = safeUrl(m.url);
        if (!url) return null;
        return (
          <div key={m.id} className="group relative aspect-square">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative block h-full w-full overflow-hidden rounded-[10px] border border-slate-200 bg-slate-50"
          >
            {m.kind === "video" ? (
              <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="h-full w-full object-cover" />
            )}
            {m.kind === "video" ? (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                Video
              </span>
            ) : null}
          </a>
          {m.canRemove && onRemove ? <RemoveBtn onClick={() => onRemove(m.id)} /> : null}
          </div>
        );
      })}
      {onAdd ? (
        <>
          <button
            type="button"
            aria-label="Add photos or videos"
            disabled={uploading}
            onClick={() => input.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-[10px] border-2 border-dashed border-slate-200 px-1 text-center text-blue-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {uploading ? (
              <span className="text-[11px] text-slate-500">Uploading…</span>
            ) : (
              <>
                <Plus className="h-5 w-5" aria-hidden />
                <span className="text-[10.5px] font-medium leading-tight">Add photos / videos</span>
              </>
            )}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif,.mov,.mp4,.webm"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) onAdd(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      ) : null}
    </div>
    </>
  );
}

/** Second-step form: a required note and a submit button. */
function NoteStep({
  title,
  hint,
  label,
  cta,
  required = true,
  extra,
  busy,
  onSubmit,
  onBack,
}: {
  title: string;
  hint: string;
  label: string;
  cta: string;
  required?: boolean;
  extra?: ReactNode;
  busy: boolean;
  onSubmit: (note: string) => void;
  onBack: () => void;
}) {
  const [note, setNote] = useState("");
  const ok = !required || note.trim().length > 0;
  return (
    <>
      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-[12.5px] text-slate-500">{hint}</p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-slate-500">
            {label}
            {required ? " *" : " (optional)"}
          </span>
          <Textarea value={note} maxLength={900} onChange={(e) => setNote(e.target.value)} aria-label={label} autoFocus />
        </label>
        {extra}
      </div>
      <Footer>
        <ActionBtn tone="primary" disabled={busy || !ok} onClick={() => onSubmit(note.trim())}>
          {cta}
        </ActionBtn>
        <ActionBtn tone="outline" disabled={busy} onClick={onBack}>
          Back
        </ActionBtn>
      </Footer>
    </>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-slate-100 bg-white px-5 py-4">{children}</div>;
}

// --- Drawer ----------------------------------------------------------------------------------

export function WorkOrderDrawer({
  item,
  open,
  onClose,
  leadName,
  onSwitch,
}: {
  item: ItemRef | null;
  open: boolean;
  onClose: () => void;
  leadName: string;
  /** Jump to another record (e.g. the work order just created from a request). */
  onSwitch: (ref: ItemRef) => void;
}) {
  const detail = useQuery(api.board.detail, item ? { kind: item.kind, id: item.id } : "skip");
  const missing = item !== null && detail === null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={detail ? `${detail.number} ${detail.title}` : missing ? "Not found" : "Loading"}
      hideHeader
      width={620}
    >
      {!item || detail === undefined ? (
        <div className="flex flex-1 items-center justify-center p-10 text-[13px] text-slate-500">Loading…</div>
      ) : detail === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center text-[13px] text-slate-500">
          This item doesn&apos;t exist or you don&apos;t have access to it.
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-700">
            Close
          </button>
        </div>
      ) : (
        <DrawerBody key={detail.id} d={detail} onClose={onClose} leadName={leadName} onSwitch={onSwitch} />
      )}
    </Drawer>
  );
}

function DrawerBody({
  d,
  onClose,
  leadName,
  onSwitch,
}: {
  d: Detail;
  onClose: () => void;
  leadName: string;
  onSwitch: (ref: ItemRef) => void;
}) {
  const { busy, run } = useRun();
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<"overview" | "expenses">("overview");
  const [step, setStep] = useState<Step>("view");
  const [comment, setComment] = useState("");
  const [windowDraft, setWindowDraft] = useState<WindowValue | null>(null);
  const [techDraft, setTechDraft] = useState<string | null>(null);

  const overrideSeverity = useMutation(api.maintenance.overrideSeverity);
  const editScope = useMutation(api.workOrders.editScope);
  const assign = useMutation(api.workOrders.assign);
  const addComment = useMutation(api.board.addComment);
  const genUrl = useMutation(api.board.generateUploadUrl);
  const attachMedia = useMutation(api.board.attachMedia);
  const removeMedia = useMutation(api.board.removeMedia);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const createWo = useMutation(api.workOrders.create);
  const approve = useMutation(api.maintenance.approveAndForward);
  const requestInfo = useMutation(api.maintenance.requestInfo);
  const sendBackToAM = useMutation(api.maintenance.sendBackToAM);
  const withdraw = useMutation(api.maintenance.withdrawFromPat);
  const reopen = useMutation(api.maintenance.reopen);
  const woRequestInfo = useMutation(api.workOrders.requestInfo);
  const woSendBack = useMutation(api.workOrders.sendBack);
  const reviewClose = useMutation(api.workOrders.reviewClose);

  const isRequest = d.kind === "request";
  const requestId = (isRequest ? d.id : d.linkedRequest?.id) as Id<"maintenanceRequests"> | undefined;
  const reqFull = useQuery(api.maintenance.get, requestId ? { requestId } : "skip");
  const team = useQuery(api.team.overview);
  const technicians = (team?.members ?? []).filter((m) => m.appRole === "technician");

  const statusKey = d.statusKey as StatusKey;
  const f = d.flags;
  const rawStatus = d.status;
  const forwarded = isRequest && rawStatus === "forwarded_to_pat";
  const inAmReview = isRequest && (rawStatus === "new" || rawStatus === "under_review" || rawStatus === "more_info_needed");
  const canCreate = forwarded && f.canManage;
  const suggest = useQuery(
    api.workOrders.suggestTechnician,
    canCreate && reqFull ? { issueType: reqFull.request.issueType } : "skip",
  );

  const showExpenses = d.expensesTab !== null && (statusKey === "completed" || statusKey === "closed");
  const activeTab = showExpenses ? tab : "overview";
  const place = [d.propertyName, d.unitNumber ? `Unit ${d.unitNumber}` : ""].filter(Boolean).join(" · ") || "—";
  const priorityEditable = f.canChangePriority;
  const windowEditable = isRequest ? canCreate : f.canChangeWindow;
  const techEditable = isRequest ? canCreate : f.canReassign;

  const savedWindow: WindowValue | null =
    d.windowStart !== null && d.windowEnd !== null ? { start: d.windowStart, end: d.windowEnd } : null;
  const windowValue = isRequest ? windowDraft : savedWindow;
  const legacyWindow = !isRequest && !savedWindow ? d.window : null;
  const techValue = isRequest ? (techDraft ?? suggest?.userId ?? "") : (d.technician?.userId ?? "");
  const techOptions = [
    ...(isRequest ? [{ value: "", label: "Unassigned" }] : []),
    ...(d.technician && !technicians.some((t) => t.userId === d.technician!.userId)
      ? [{ value: d.technician.userId as string, label: shortPerson(d.technician.name) }]
      : []),
    ...technicians.map((t) => ({
      value: t.userId as string,
      label: `${shortPerson(t.name)}${t.skill ? ` · ${t.skill}` : ""}`,
    })),
  ];
  const levels = PRIORITY_LEVELS.filter((p) => isRequest || p.value !== "informational");

  // --- handlers ------------------------------------------------------------------------------

  const onPriority = (value: string) =>
    run(async () => {
      if (isRequest) {
        await overrideSeverity({
          requestId: d.id as Id<"maintenanceRequests">,
          severity: value as Severity,
          reason: "Changed by admin",
        });
      } else {
        await editScope({ workOrderId: d.id as Id<"workOrders">, priority: priorityOf(value as Severity) });
      }
    }, "Priority updated.");

  const onWindow = (value: WindowValue | null) => {
    if (isRequest) {
      setWindowDraft(value);
      return;
    }
    const workOrderId = d.id as Id<"workOrders">;
    void run(
      () =>
        value
          ? editScope({ workOrderId, windowStart: value.start, windowEnd: value.end, fallbackTimeZone: browserTimeZone() })
          : editScope({ workOrderId, clearWindow: true }),
      value ? "Time window updated." : "Time window cleared.",
    );
  };

  const onTech = (value: string) => {
    if (isRequest) {
      setTechDraft(value);
      return;
    }
    if (!value) return;
    void run(
      () => assign({ workOrderId: d.id as Id<"workOrders">, technicianUserId: value as Id<"users"> }),
      "Technician assigned.",
    );
  };

  const postComment = () =>
    run(async () => {
      await addComment({ kind: d.kind, id: d.id, note: comment.trim() });
      setComment("");
    }, "Comment saved.");

  const onAddFiles = f.canAttach
    ? async (files: FileList) => {
        setUploading(true);
        try {
          const list = Array.from(files);
          let saved = 0;
          for (const file of list) {
            try {
              const kind = uploadType(file);
              const reject = (why: string) => toast.error(`${file.name}: ${why}`);
              if (!kind) {
                reject("Choose a photo or an mp4, webm or mov video.");
                continue;
              }
              if (file.size > (kind.media === "video" ? MAX_VIDEO : MAX_PHOTO)) {
                reject(kind.media === "video" ? "Videos can be at most 50 MB." : "Photos can be at most 10 MB.");
                continue;
              }
              const postUrl = await genUrl({ kind: d.kind, id: d.id });
              const res = await fetch(postUrl, { method: "POST", headers: { "Content-Type": kind.type }, body: file });
              if (!res.ok) {
                reject("Upload failed.");
                continue;
              }
              const json = (await res.json()) as { storageId?: string };
              if (!json.storageId) {
                reject("Upload failed.");
                continue;
              }
              const result = await attachMedia({ kind: d.kind, id: d.id, storageId: json.storageId as Id<"_storage"> });
              if (!result.ok) {
                reject(result.error);
                continue;
              }
              saved += 1;
            } catch (e) {
              toast.error(`${file.name}: ${errorMessage(e, "Upload failed.")}`);
            }
          }
          if (saved > 0) toast.success(saved === 1 ? "Saved." : `${saved} files saved.`);
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setUploading(false);
        }
      }
    : undefined;

  /** Receipts / documents (photo or PDF) on a work order's Expenses tab. */
  const receiptInput = useRef<HTMLInputElement>(null);
  const onAddReceipts =
    f.canAttachReceipt && !isRequest
      ? async (files: FileList) => {
          setUploading(true);
          let saved = 0;
          try {
            for (const file of Array.from(files)) {
              try {
                const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
                const isPdf = file.type === "application/pdf" || ext === "pdf";
                const img = uploadType(file);
                const reject = (why: string) => toast.error(`${file.name}: ${why}`);
                if (!isPdf && img?.media !== "photo") {
                  reject("Choose a PDF or a photo.");
                  continue;
                }
                if (file.size > MAX_PHOTO) {
                  reject("Receipts can be at most 10 MB.");
                  continue;
                }
                const type = isPdf ? "application/pdf" : img!.type;
                const postUrl = await genUrl({ kind: d.kind, id: d.id, receipt: true });
                const res = await fetch(postUrl, { method: "POST", headers: { "Content-Type": type }, body: file });
                if (!res.ok) {
                  reject("Upload failed.");
                  continue;
                }
                const json = (await res.json()) as { storageId?: string };
                if (!json.storageId) {
                  reject("Upload failed.");
                  continue;
                }
                const result = await attachMedia({ kind: d.kind, id: d.id, storageId: json.storageId as Id<"_storage">, receipt: true });
                if (!result.ok) {
                  reject(result.error);
                  continue;
                }
                saved += 1;
              } catch (e) {
                toast.error(`${file.name}: ${errorMessage(e, "Upload failed.")}`);
              }
            }
            if (saved > 0) toast.success(saved === 1 ? "Receipt saved." : `${saved} receipts saved.`);
          } finally {
            setUploading(false);
          }
        }
      : undefined;

  const back = () => setStep("view");

  const createAndAssign = async () => {
    if (!isRequest || !d.unitId || !reqFull) return;
    const r = reqFull.request;
    const ok = await run(async () => {
      if (comment.trim()) await addComment({ kind: "request", id: d.id, note: comment.trim() });
      const scope = [r.description, ...r.answers.map((a) => `${a.question}: ${a.value}`)].join("\n").slice(0, 4000);
      const access = r.pets ? `Pets: ${r.pets}`.slice(0, 1000) : "";
      const id = await createWo({
        requestId: d.id as Id<"maintenanceRequests">,
        unitId: d.unitId as Id<"units">,
        title: d.title.slice(0, 200),
        scope,
        priority: priorityOf(d.priorityLevel),
        technicianUserId: techValue ? (techValue as Id<"users">) : undefined,
        accessNotes: access || undefined,
        requiredOnSubmit: { photos: true, hours: true, receipts: false, notes: false },
        ...(windowDraft ? { windowStart: windowDraft.start, windowEnd: windowDraft.end, fallbackTimeZone: browserTimeZone() } : {}),
      });
      setComment("");
      onSwitch({ kind: "work_order", id });
    }, "Work order created.");
    if (ok) setStep("view");
  };

  // --- body ----------------------------------------------------------------------------------

  const covering = f.isCovering;
  const amName = d.assetManager?.name ?? "the asset manager";
  const mediaItems: Media[] = d.media.map((m) => ({ id: m.id, url: m.url, kind: m.kind, canRemove: m.canRemove }));
  const noAttachReason = covering ? "Covering view is read-only." : "You can't add photos to this item.";
  const photosSection = (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
      <span className="text-[12px] font-medium text-slate-800">Photos &amp; videos ({d.media.length})</span>
      <MediaGrid items={mediaItems} onAdd={onAddFiles} onRemove={setRemoveId} uploading={uploading} reason={noAttachReason} />
    </div>
  );
  const tenantName = d.tenant.name;
  const tenantPhone = d.tenant.phone;

  const buildOverview = (withPhotos: boolean) => (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-3.5 gap-y-3.5">
        <Labeled
          label="Priority"
          extra={
            typeof d.severityScore === "number" ? (
              <span className="text-[10.5px] font-normal text-slate-400">{Math.round(d.severityScore)}/10</span>
            ) : null
          }
        >
          <DesignSelect
            ariaLabel="Priority"
            value={d.priorityLevel}
            onChange={priorityEditable && !busy ? (v) => void onPriority(v) : undefined}
            options={levels.map((p) => ({ value: p.value, label: p.label, dot: p.dot }))}
          />
        </Labeled>
        <Labeled label="Time Window">
          <WindowPicker value={windowValue} legacyLabel={legacyWindow} onChange={windowEditable && !busy ? onWindow : undefined} />
          <TenantPreferredTime value={d.tenantPreferredTime} />
        </Labeled>
        <Labeled label="Assigned to">
          <DesignSelect
            ariaLabel="Assigned to"
            value={techValue}
            placeholder="Unassigned"
            onChange={techEditable && !busy ? onTech : undefined}
            options={techOptions}
          />
        </Labeled>
        <Labeled label="Asset Manager">
          <DesignSelect
            ariaLabel="Asset manager"
            value="am"
            options={[{ value: "am", label: d.assetManager ? shortPerson(d.assetManager.name) : "Unassigned" }]}
          />
          <span className="text-[10.5px] leading-tight text-slate-400">The designated asset manager can&apos;t be changed here.</span>
        </Labeled>
      </div>

      <Labeled label="Work Order Description">
        <div className="whitespace-pre-wrap rounded-[12px] border border-slate-200 px-3.5 py-3 text-[13px] leading-relaxed text-slate-700">
          {d.description || "—"}
        </div>
      </Labeled>

      <div className="flex flex-col gap-3 text-[13px]">
        <Meta label="Location" value={d.propertyName ?? "—"} href={d.propertyId ? `/properties?property=${d.propertyId}` : undefined} link="View property" />
        <Meta label="Unit" value={d.unitNumber ?? "—"} href={d.propertyId ? `/properties?property=${d.propertyId}` : undefined} link="View unit" />
        <Meta label="Asset Manager" value={d.assetManager?.name ?? "—"} />
        <Meta label="Created" value={fmtCreated(d.createdAt)} />
      </div>

      {tenantName || tenantPhone ? (
        <div className="flex items-end justify-between gap-3 border-t border-slate-100 pt-3 text-[13px]">
          <div>
            <div className="text-[11.5px] text-slate-400">Tenant</div>
            <div className="font-medium text-slate-800">{tenantName ?? "—"}</div>
          </div>
          {tenantPhone ? (
            <a href={`tel:${tenantPhone}`} className="inline-flex items-center gap-1.5 text-slate-600">
              <Phone aria-hidden className="h-3.5 w-3.5" />
              {tenantPhone}
            </a>
          ) : null}
        </div>
      ) : null}

      {withPhotos ? photosSection : null}

      <Labeled label="Comment (optional)">
        <Textarea
          value={comment}
          maxLength={1000}
          onChange={(e) => setComment(e.target.value)}
          aria-label="Comment"
          disabled={!f.canAddNote && !canCreate}
          placeholder={f.canAddNote || canCreate ? "" : "Comments are closed on this record."}
        />
        {f.canAddNote ? (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !comment.trim()}
              onClick={() => void postComment()}
              className="h-8 rounded-lg border border-blue-500 px-3 text-[12.5px] font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            >
              Save comment
            </button>
          </div>
        ) : null}
      </Labeled>

      {d.comments.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-slate-800">Comments ({d.comments.length})</span>
          {d.comments.map((c) => (
            <div key={c.id} className="rounded-[10px] bg-slate-50 px-3 py-2 text-[12.5px]">
              <div className="flex items-center justify-between gap-2 text-[11.5px] text-slate-500">
                <span className="font-medium text-slate-700">{c.authorName}</span>
                <span>{fmtDateTime(c.at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{c.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      {reqFull ? (
        <details className="group rounded-[12px] border border-slate-200 px-3.5 py-2.5">
          <summary className="cursor-pointer text-[12.5px] font-medium text-slate-700">From the call</summary>
          <div className="mt-3">
            <CallDetails r={reqFull} />
          </div>
        </details>
      ) : null}

      {d.timeline.length > 0 ? (
        <details className="group rounded-[12px] border border-slate-200 px-3.5 py-2.5">
          <summary className="cursor-pointer text-[12.5px] font-medium text-slate-700">Activity ({d.timeline.length})</summary>
          <div className="mt-3">
            <Timeline
              entries={d.timeline.map((a) => ({
                id: a.id,
                text: auditText({ actorLabel: a.actorName, action: a.action, note: a.note }),
                time: fmtDateTime(a.at),
              }))}
            />
          </div>
        </details>
      ) : null}
    </div>
  );

  const overview = buildOverview(true);
  const closure = d.closure;
  const rejectedView = closure ? (
    <div className="flex flex-col gap-4">
      <div className="rounded-[12px] bg-emerald-50 px-4 py-3">
        <div className="text-[13px] font-semibold text-emerald-800">Work Order Rejection recorded</div>
        <div className="mt-0.5 text-[12.5px] text-emerald-700">
          {fmtLong(closure.at)}
          {closure.byName ? ` · by ${closure.byName}` : ""}
        </div>
      </div>
      <div className="rounded-[12px] bg-slate-50 px-4 py-3">
        <div className="text-[12.5px] font-semibold text-slate-900">Reason</div>
        {closure.reason ? <p className="mt-1 text-[13px] font-medium text-slate-700">{closure.reason}</p> : null}
        {closure.explanation ? (
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug text-slate-500">{closure.explanation}</p>
        ) : null}
      </div>
      <details className="group rounded-[12px] border border-slate-200 px-3.5 py-2.5">
        <summary className="cursor-pointer text-[12.5px] font-medium text-slate-700">Request details</summary>
        <div className="mt-3">{buildOverview(false)}</div>
      </details>
      {photosSection}
    </div>
  ) : null;

  const et = d.expensesTab;
  const laborText = et?.laborNote.replace(/^Labor amount calculated:?\s*/i, "") ?? "";
  const expensesView = et ? (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11.5px] text-slate-400">Hours submitted</div>
          <div className="mt-0.5 text-[13.5px] font-semibold text-slate-900">{hoursText(et.hoursSubmitted)}</div>
        </div>
        <div>
          <div className="text-[11.5px] text-slate-400">Materials total</div>
          <div className="mt-0.5 text-[13.5px] font-semibold text-slate-900">{fmtMoney(et.materialsTotal)}</div>
        </div>
      </div>
      {et.expenses.length === 0 ? (
        <p className="text-[12.5px] text-slate-500">No expenses submitted.</p>
      ) : (
        et.expenses.map((e) => (
          <div key={e._id} className="rounded-[10px] bg-slate-50 px-3.5 py-3">
            <div className="text-[13px] font-medium text-slate-800">
              {e.description} · {fmtMoney(e.amount)}
            </div>
            <div className="mt-0.5 text-[11.5px] text-slate-500">
              Submitted by {e.submittedBy}
              {e.hasReceipt ? " · Receipt attached" : ""}
            </div>
          </div>
        ))
      )}
      <Labeled label="Technician expense note">
        <div className="rounded-[10px] border border-slate-200 px-3.5 py-2.5 text-[13px] text-slate-700">
          {et.technicianExpenseNote ?? "No note from the technician."}
        </div>
      </Labeled>
      <div className="rounded-[10px] bg-amber-50 px-3.5 py-3">
        <div className="text-[12.5px] font-semibold text-amber-900">Labor amount calculated</div>
        <p className="mt-0.5 text-[12px] leading-snug text-amber-800">{laborText}</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-slate-800">Photos &amp; videos ({et.photos.length})</span>
        <MediaGrid
          items={et.photos.map((p) => ({ id: p._id, url: p.url, kind: p.kind, canRemove: p.canRemove }))}
          onAdd={onAddFiles}
          onRemove={setRemoveId}
          uploading={uploading}
          reason={noAttachReason}
        />
      </div>
      {onAddReceipts ? (
        <div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => receiptInput.current?.click()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-blue-400 text-[13px] font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          >
            <FileText aria-hidden className="h-4 w-4" /> {uploading ? "Uploading…" : "Add receipt or document (PDF / photo)"}
          </button>
          <input
            ref={receiptInput}
            type="file"
            multiple
            accept="application/pdf,.pdf,image/*,.heic,.heif"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) void onAddReceipts(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : null}
      {et.documents.map((doc) => {
        const url = safeUrl(doc.url);
        return (
          <div key={doc._id} className="flex flex-col gap-2.5">
            <div className="group relative flex h-[88px] items-center justify-center gap-2 rounded-[12px] border border-slate-200 bg-slate-50 text-[13px] font-medium text-slate-800">
              <FileText aria-hidden className="h-6 w-6 text-rose-500" />
              {doc.name}
              {doc.canRemove ? <RemoveBtn onClick={() => setRemoveId(doc._id)} /> : null}
            </div>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 items-center justify-center rounded-lg border border-blue-500 text-[13px] font-semibold text-blue-600 hover:bg-blue-50"
              >
                Open Document
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  ) : null;

  // --- footer actions ------------------------------------------------------------------------

  const canReopen = f.canReopen;
  const reopenId = (f.reopenRequestId ?? (isRequest ? d.id : requestId)) as Id<"maintenanceRequests"> | undefined;
  const rfiLabel = "Request for More Information";

  const reopenBtn = canReopen && reopenId ? (
    <ActionBtn tone="outline" disabled={busy} onClick={() => setStep("info")}>
      {rfiLabel}
    </ActionBtn>
  ) : null;

  let actions: ReactNode = null;
  let infoStep: ReactNode = null;

  if (covering) {
    actions = (
      <WaitNote icon={<Clock />}>
        You&apos;re covering this unit while {amName} is out. Read only.
      </WaitNote>
    );
  } else if (isRequest && inAmReview) {
    if (f.canAct) {
      actions = (
        <>
          <ActionBtn
            tone="primary"
            disabled={busy}
            onClick={() =>
              void run(() => approve({ requestId: d.id as Id<"maintenanceRequests"> }), `${d.number} sent to ${leadName}.`)
            }
          >
            Approve &amp; Send to {leadName}
          </ActionBtn>
          <ActionBtn tone="outline" disabled={busy} onClick={() => setStep("info")}>
            {rfiLabel}
          </ActionBtn>
          <ActionBtn tone="danger" disabled={busy} onClick={() => setStep("reject")}>
            Reject as Out of Scope
          </ActionBtn>
        </>
      );
      infoStep = (
        <NoteStep
          title={rfiLabel}
          hint="Recorded on the request for the asset manager. The tenant is not texted."
          label="What information is needed"
          cta="Send Request"
          busy={busy}
          onBack={back}
          extra={
            <div>
              <label className="flex items-center gap-2 text-[13px] text-slate-500" title="Texting is off for now">
                <input type="checkbox" checked={false} disabled readOnly />
                Ask tenant for photos
              </label>
              <p className="mt-1 text-xs text-slate-500">Texting is off for now. The tenant will not be texted.</p>
            </div>
          }
          onSubmit={(note) =>
            void run(() => requestInfo({ requestId: d.id as Id<"maintenanceRequests">, note }), "Request recorded.").then(
              (ok) => ok && back(),
            )
          }
        />
      );
    } else {
      actions = <WaitNote icon={<Clock />}>Waiting on {amName} to review.</WaitNote>;
    }
  } else if (isRequest && forwarded) {
    if (f.canManage) {
      actions = (
        <>
          <ActionBtn tone="primary" disabled={busy || !d.unitId} onClick={() => setStep("create")}>
            Create and Assign
          </ActionBtn>
          <ActionBtn tone="outline" disabled={busy || !f.canRequestInfo} onClick={() => setStep("info")}>
            {rfiLabel}
          </ActionBtn>
          <ActionBtn tone="danger" disabled={busy} onClick={() => setStep("reject")}>
            Reject as Out of Scope
          </ActionBtn>
          {!d.unitId ? (
            <p className="text-center text-[12px] text-slate-500">
              This request has no unit yet. Resolve it from the routing banner first.
            </p>
          ) : null}
        </>
      );
      infoStep = (
        <NoteStep
          title={rfiLabel}
          hint="Goes back to the asset manager"
          label="What do you need from the asset manager"
          cta="Send Back"
          busy={busy}
          onBack={back}
          onSubmit={(note) =>
            void run(
              () => sendBackToAM({ requestId: d.id as Id<"maintenanceRequests">, note }),
              "Sent back to the asset manager.",
            ).then((ok) => ok && back())
          }
        />
      );
    } else {
      actions = (
        <>
          <WaitNote icon={<Clock />}>Approved. Waiting on {leadName} to create the work order.</WaitNote>
          {f.canWithdraw ? (
            <ActionBtn tone="outline" disabled={busy} onClick={() => setStep("withdraw")}>
              Withdraw to my review
            </ActionBtn>
          ) : null}
        </>
      );
    }
  } else if (isRequest && rawStatus === "work_order_created") {
    actions = (
      <>
        {d.workOrder ? (
          <ActionBtn tone="primary" onClick={() => onSwitch({ kind: "work_order", id: d.workOrder!.id })}>
            Open {d.workOrder.number}
          </ActionBtn>
        ) : null}
        {reopenBtn}
      </>
    );
  } else if (isRequest) {
    // Rejected (closed out of scope / duplicate).
    actions = (
      <>
        {reopenBtn}
        <ActionBtn tone="outline" onClick={onClose}>
          Back to Work Orders
        </ActionBtn>
      </>
    );
  } else if (statusKey === "in_progress") {
    actions = f.canRequestInfo ? (
      <ActionBtn tone="outline" disabled={busy} onClick={() => setStep("info")}>
        {rfiLabel}
      </ActionBtn>
    ) : null;
    infoStep = (
      <NoteStep
        title={rfiLabel}
        hint="Goes to the technician"
        label="What do you need from the technician"
        cta="Send Request"
        busy={busy}
        onBack={back}
        onSubmit={(note) =>
          void run(() => woRequestInfo({ workOrderId: d.id as Id<"workOrders">, note }), "Request sent to the technician.").then(
            (ok) => ok && back(),
          )
        }
      />
    );
  } else if (statusKey === "completed") {
    actions = (
      <>
        {f.canSignOff ? (
          <ActionBtn
            tone="primary"
            disabled={busy}
            onClick={() => void run(() => reviewClose({ workOrderId: d.id as Id<"workOrders"> }), `${d.number} closed.`)}
          >
            Confirm as Completed
          </ActionBtn>
        ) : (
          <WaitNote icon={<Clock />}>Completed. {leadName} is reviewing the evidence.</WaitNote>
        )}
        {f.canRequestInfo ? (
          <ActionBtn tone="outline" disabled={busy} onClick={() => setStep("info")}>
            {rfiLabel}
          </ActionBtn>
        ) : null}
      </>
    );
    infoStep = (
      <NoteStep
        title={rfiLabel}
        hint="Sends it back to the technician"
        label="What needs another look"
        cta="Send Back"
        busy={busy}
        onBack={back}
        onSubmit={(note) =>
          void run(() => woSendBack({ workOrderId: d.id as Id<"workOrders">, note }), "Sent back to the technician.").then(
            (ok) => ok && back(),
          )
        }
      />
    );
  } else {
    // Closed work order.
    actions = reopenBtn;
  }

  // Reopen note step (closed work order, rejected request, request whose work order is closed).
  if (!infoStep && canReopen && reopenId) {
    infoStep = (
      <NoteStep
        title={rfiLabel}
        hint="Reopens it for the asset manager"
        label="Note for the asset manager"
        cta="Reopen"
        busy={busy}
        onBack={back}
        onSubmit={(note) =>
          void run(() => reopen({ requestId: reopenId, note }), "Reopened for the asset manager.").then((ok) => ok && back())
        }
      />
    );
  }

  const header = (
    <div className="px-5 pt-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="text-[18px] font-bold tracking-[-0.01em] text-slate-900">{d.number}</span>
          <StatusPill statusKey={statusKey} label={d.statusLabel} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <h2 className="mt-3 text-[16px] font-semibold leading-snug text-slate-900">{d.title}</h2>
      <p className="mt-0.5 text-[12.5px] text-slate-500">{place}</p>
    </div>
  );

  const tabs = (
    <div role="tablist" className="mt-3 flex gap-5 border-b border-slate-200 px-5 text-[13px] font-medium">
      <TabButton on={activeTab === "overview"} onClick={() => setTab("overview")}>
        Overview
      </TabButton>
      {showExpenses ? (
        <TabButton on={activeTab === "expenses"} onClick={() => setTab("expenses")}>
          Expenses
        </TabButton>
      ) : null}
    </div>
  );

  // Close as Out of Scope: its own drawer layout.
  if (step === "reject" && isRequest) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-white">
        <div className="px-5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-slate-900">Close as Out of Scope</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-[12.5px] text-slate-500">{d.number} · A reason is required before closing</p>
        </div>
        <RejectPanel
          requestId={d.id as Id<"maintenanceRequests">}
          mode={forwarded ? "admin" : "am"}
          onDone={back}
          onCancel={back}
        />
      </div>
    );
  }

  if (step === "info" && infoStep) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-white">
        {header}
        {infoStep}
      </div>
    );
  }

  if (step === "withdraw" && isRequest) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-white">
        {header}
        <NoteStep
          title="Withdraw to my review"
          hint="Takes it back from the admin."
          label="Note"
          required={false}
          cta="Confirm Withdraw"
          busy={busy}
          onBack={back}
          onSubmit={(note) =>
            void run(
              () => withdraw({ requestId: d.id as Id<"maintenanceRequests">, note: note || undefined }),
              "Withdrawn. It is back in your review.",
            ).then((ok) => ok && back())
          }
        />
      </div>
    );
  }

  if (step === "create" && isRequest) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-white">
        {header}
        <div className="flex flex-1 flex-col gap-4 px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Create and Assign</h3>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {suggest && techDraft === null
                ? `Technician suggested by ${suggest.reason === "skill" ? "skill match" : "lowest workload"}.`
                : "Pick the technician and an appointment window."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Labeled label="Technician">
              <DesignSelect ariaLabel="Technician" value={techValue} placeholder="Unassigned" onChange={setTechDraft} options={techOptions} />
            </Labeled>
            <Labeled label="Time Window">
              <WindowPicker value={windowDraft} onChange={setWindowDraft} />
              <TenantPreferredTime value={d.tenantPreferredTime} />
            </Labeled>
          </div>
          <Labeled label="Comment (optional)">
            <Textarea value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
          </Labeled>
        </div>
        <Footer>
          <ActionBtn tone="primary" disabled={busy || !reqFull} onClick={() => void createAndAssign()}>
            {busy ? "Creating…" : "Create and Assign"}
          </ActionBtn>
          <ActionBtn tone="outline" disabled={busy} onClick={back}>
            Back
          </ActionBtn>
        </Footer>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-white">
      {header}
      {tabs}
      <div className="flex-1 px-5 py-4">
        {activeTab === "expenses" && expensesView ? expensesView : (rejectedView ?? overview)}
      </div>
      {actions ? <Footer>{actions}</Footer> : null}
      <ConfirmDialog
        open={removeId !== null}
        title="Remove this photo?"
        message="This can't be undone."
        confirmLabel="Remove"
        danger
        busy={busy}
        onCancel={() => setRemoveId(null)}
        onConfirm={() => {
          const mediaId = removeId;
          if (!mediaId) return;
          void run(() => removeMedia({ kind: d.kind, id: d.id, mediaId }), "Photo removed").then(() => setRemoveId(null));
        }}
      />
    </div>
  );
}

function TabButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cx("-mb-px border-b-2 pb-2", on ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500")}
    >
      {children}
    </button>
  );
}

function Meta({ label, value, href, link }: { label: string; value: string; href?: string; link?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11.5px] text-slate-400">{label}</div>
        <div className="font-medium text-slate-800">{value}</div>
      </div>
      {href && link ? (
        <Link href={href} className="shrink-0 text-[12px] font-medium text-blue-600 hover:underline">
          {link} →
        </Link>
      ) : null}
    </div>
  );
}
