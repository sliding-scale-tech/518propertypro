"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, CheckCircle2, Eye, FileText, Search, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PriorityChip } from "@/components/board/chips";
import { toast } from "@/components/toast";
import { Btn, Card, ConfirmDialog, Input, Modal, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { ActionMenu, LabelValue, Pager, UnderlineTabs, fmtStamp, useDebounced } from "@/components/asset-managers/shared";
import { E164_RE, EMAIL_RE, INVALID, TechStatusBadge, WO_STATUS_OPTIONS, WoStatusPill, type WoStatusGroup } from "./shared";

type Tab = "overview" | "work-orders";
type Profile = NonNullable<FunctionReturnType<typeof api.technicians.profile>>;
type WoData = FunctionReturnType<typeof api.technicians.workOrders>;
type WoRow = WoData["rows"][number];
type ReassignResult = FunctionReturnType<typeof api.workOrders.reassignMany>;

const STATUS_VALUES = WO_STATUS_OPTIONS.map((o) => o.value) as string[];

export function ProfileView({ userId }: { userId: Id<"users"> }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get("tab") === "work-orders" ? "work-orders" : "overview";
  const rawStatus = params.get("status");
  const initialStatus = rawStatus && STATUS_VALUES.includes(rawStatus) ? rawStatus : "";
  const profile = useQuery(api.technicians.profile, { userId });
  const base = `/technicians/${userId}`;
  const setTab = (t: Tab) => router.replace(t === "overview" ? base : `${base}?tab=${t}`, { scroll: false });
  const openWorkOrders = (status: WoStatusGroup) => router.replace(`${base}?tab=work-orders&status=${status}`, { scroll: false });

  return (
    <div className="space-y-5 pb-10">
      <div>
        <Link href="/technicians" className="mb-2 inline-block text-[13px] font-medium text-primary hover:underline">
          ← Technicians
        </Link>
        <PageHeader title="Technician Profile" subtitle="Manage technician profile" />
      </div>
      <UnderlineTabs
        label="Technician sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview" },
          { value: "work-orders", label: "Work orders" },
        ]}
      />
      {profile === undefined ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">Loading…</p>
      ) : tab === "overview" ? (
        <OverviewTab userId={userId} profile={profile} startInEdit={params.get("edit") === "1"} onOpen={openWorkOrders} />
      ) : (
        <WorkOrdersTab key={initialStatus} userId={userId} technicianName={profile.name} initialStatus={initialStatus} />
      )}
    </div>
  );
}

// --- Overview (TC4 / TC5) ----------------------------------------------------------

function KpiLink({
  icon,
  tone,
  title,
  value,
  sub,
  onClick,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  value: number;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 rounded-[18px] border border-border bg-card px-5 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden className={cx("inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5", tone)}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-muted-foreground">{title}</span>
        <span className="block text-[24px] font-bold leading-tight tabular-nums">{value}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
      <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function OverviewTab({
  userId,
  profile,
  startInEdit,
  onOpen,
}: {
  userId: Id<"users">;
  profile: Profile;
  startInEdit: boolean;
  onOpen: (s: WoStatusGroup) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiLink icon={<Eye />} tone="bg-warning-soft text-warning-ink" title="Pending Work Orders" value={profile.counts.pending} sub="Assigned, not started yet" onClick={() => onOpen("pending")} />
        <KpiLink icon={<FileText />} tone="bg-accent text-primary" title="In Progress" value={profile.counts.inProgress} sub="Being worked on now" onClick={() => onOpen("in_progress")} />
        <KpiLink icon={<TriangleAlert />} tone="bg-success-soft text-success-ink" title="Awaiting Sign Off" value={profile.counts.awaitingSignOff} sub="Requires admin verification" onClick={() => onOpen("needs_sign_off")} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ProfileCard userId={userId} profile={profile} startInEdit={startInEdit} />
        <DangerZone userId={userId} profile={profile} />
      </div>
    </div>
  );
}

type Draft = { personalEmail: string; phone: string; internalNotes: string };

function ProfileCard({ userId, profile, startInEdit }: { userId: Id<"users">; profile: Profile; startInEdit: boolean }) {
  const updateProfile = useMutation(api.technicians.updateProfile);
  const sendReset = useAction(api.technicians.sendPasswordReset);
  const draftOf = (): Draft => ({ personalEmail: profile.personalEmail ?? "", phone: profile.phone ?? "", internalNotes: profile.internalNotes });
  const [draft, setDraft] = useState<Draft | null>(() => (startInEdit ? draftOf() : null));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function doReset() {
    setResetting(true);
    try {
      await sendReset({ userId });
      toast.success(`Reset email sent to ${profile.workEmail}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  }

  const phoneClean = draft ? draft.phone.replace(/[\s().-]/g, "") : "";
  const errors = {
    personalEmail:
      draft && draft.personalEmail.trim() !== "" && !EMAIL_RE.test(draft.personalEmail.trim()) ? "Enter a valid personal email address." : "",
    phone: draft && phoneClean !== "" && !E164_RE.test(phoneClean) ? "Enter the contact number in international format, e.g. +14165550187." : "",
  };

  async function save() {
    if (!draft || saving) return;
    setTouched(true);
    const first = errors.personalEmail || errors.phone;
    if (first) {
      toast.error(first);
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ userId, personalEmail: draft.personalEmail.trim(), phone: phoneClean, internalNotes: draft.internalNotes });
      toast.success("Profile saved");
      setDraft(null);
      setTouched(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <Card className="self-start">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[26px] font-bold tracking-[-0.01em]">{profile.name}</h2>
          <TechStatusBadge status={profile.status} />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <LabelValue label="Work Email">
            <span className="break-all text-[15px] font-normal">{profile.workEmail}</span>
          </LabelValue>
          <LabelValue label="Contact Number">
            <span className="text-[15px] font-normal">{profile.phone ?? "Not set"}</span>
          </LabelValue>
        </div>
        <div className="mt-5 rounded-xl bg-muted/50 px-4 py-3.5">
          <div className="text-[13px] font-semibold">Internal notes</div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-muted-foreground">{profile.internalNotes || "No notes yet."}</p>
        </div>
        <div className="mt-5">
          <Btn variant="pri" className="h-11 px-6" onClick={() => setDraft(draftOf())}>
            Edit profile
          </Btn>
        </div>
      </Card>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const row = "grid items-start gap-x-6 gap-y-1.5 sm:grid-cols-[170px_1fr]";
  const lbl = "pt-2.5 text-[14px] font-semibold";
  const showEmailErr = touched && errors.personalEmail;
  const showPhoneErr = touched && errors.phone;
  return (
    <Card className="self-start">
      <h2 className="mb-6 text-[20px] font-bold">Account Information</h2>
      <div className="space-y-4">
        <div className={row}>
          <label htmlFor="tech-full-name" className={lbl}>Full Name</label>
          <div>
            <Input id="tech-full-name" value={profile.name} disabled readOnly className="h-11" />
            <p className="mt-1 text-xs text-muted-foreground">Comes from sign-in</p>
          </div>
        </div>
        <div className={row}>
          <label htmlFor="tech-personal-email" className={lbl}>Personal Email</label>
          <div>
            <Input
              id="tech-personal-email"
              type="email"
              value={draft.personalEmail}
              maxLength={254}
              placeholder="name@gmail.com"
              onChange={(e) => set({ personalEmail: e.target.value })}
              className={cx("h-11", showEmailErr && INVALID)}
              aria-invalid={Boolean(showEmailErr)}
            />
            {showEmailErr ? <p className="mt-1 text-xs text-danger-ink">{errors.personalEmail}</p> : null}
          </div>
        </div>
        <div className={row}>
          <label htmlFor="tech-work-email" className={lbl}>Work Email</label>
          <div>
            <Input id="tech-work-email" value={profile.workEmail} disabled readOnly className="h-11" />
            <p className="mt-1 text-xs text-muted-foreground">Comes from sign-in</p>
          </div>
        </div>
        <div className={row}>
          <label htmlFor="tech-phone" className={lbl}>Contact Number</label>
          <div>
            <Input
              id="tech-phone"
              type="tel"
              value={draft.phone}
              maxLength={24}
              placeholder="+1 416 555 0187"
              onChange={(e) => set({ phone: e.target.value })}
              className={cx("h-11", showPhoneErr && INVALID)}
              aria-invalid={Boolean(showPhoneErr)}
            />
            {showPhoneErr ? <p className="mt-1 text-xs text-danger-ink">{errors.phone}</p> : null}
          </div>
        </div>
        <div className={row}>
          <label htmlFor="tech-password" className={lbl}>Password</label>
          <div className="flex gap-3">
            <Input id="tech-password" type="password" value="••••••••••••••••" disabled readOnly className="h-11" />
            <Btn onClick={() => setConfirmReset(true)} className="h-11 shrink-0 border-primary px-4 font-semibold text-primary hover:bg-accent">
              Reset Password
            </Btn>
          </div>
        </div>
        <div className={row}>
          <label htmlFor="tech-notes" className={lbl}>Internal notes</label>
          <Textarea id="tech-notes" value={draft.internalNotes} maxLength={2000} onChange={(e) => set({ internalNotes: e.target.value })} />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-3 border-t border-border pt-5">
        <Btn
          className="h-11 px-6"
          disabled={saving}
          onClick={() => {
            setDraft(null);
            setTouched(false);
          }}
        >
          Cancel
        </Btn>
        <Btn variant="pri" className="h-11 px-6" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save Changes"}
        </Btn>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={`Email ${profile.name} a password reset link?`}
        message="They will get an email pointing to the sign-in page, where Forgot password starts the reset. You can send up to 3 per person per day."
        confirmLabel="Send reset email"
        busy={resetting}
        onConfirm={() => void doReset()}
        onCancel={() => (resetting ? undefined : setConfirmReset(false))}
      />
    </Card>
  );
}

function DangerZone({ userId, profile }: { userId: Id<"users">; profile: Profile }) {
  const router = useRouter();
  const remove = useMutation(api.technicians.remove);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const openWork = profile.counts.pending + profile.counts.inProgress;

  async function doRemove() {
    setBusy(true);
    try {
      await remove({ userId });
      toast.success(`${profile.name} was removed from the team`);
      router.push("/technicians");
    } catch (e) {
      toast.error(e);
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <Card className="self-start border-danger-ink/30">
      <h2 className="text-[17px] font-semibold text-danger-ink">Danger Zone</h2>
      <p className="mt-2 text-[13.5px] text-muted-foreground">
        Deleting a user removes them from the team and revokes their access immediately. This cannot be undone.
      </p>
      <Btn
        variant="dng"
        className="mt-4 h-11 w-full"
        disabled={profile.isSelf || busy}
        onClick={() => {
          if (openWork > 0) {
            toast.error(`Reassign ${profile.name}'s ${openWork} open work order${openWork === 1 ? "" : "s"} to another technician before deleting them.`);
            return;
          }
          setConfirm(true);
        }}
      >
        <Trash2 className="h-4 w-4" />
        Delete User
      </Btn>
      {profile.isSelf ? <p className="mt-2 text-xs text-muted-foreground">You cannot remove yourself.</p> : null}
      {openWork > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Reassign their {openWork} open work order{openWork === 1 ? "" : "s"} first.
        </p>
      ) : null}
      <ConfirmDialog
        open={confirm}
        danger
        title={`Delete ${profile.name}?`}
        message="They lose access to the app right away. Completed work stays on record under their name."
        confirmLabel="Delete user"
        busy={busy}
        onConfirm={() => void doRemove()}
        onCancel={() => (busy ? undefined : setConfirm(false))}
      />
    </Card>
  );
}

// --- Work orders (TC6, TC6.1-6.3) --------------------------------------------------

const WO_PAGE = 10;

function LabeledSelect({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute -top-2 left-3 z-[1] bg-card px-1 text-[11px] font-semibold text-foreground">{label}</span>
      {children}
    </div>
  );
}

function WorkOrdersTab({ userId, technicianName, initialStatus }: { userId: Id<"users">; technicianName: string; initialStatus: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim());
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  // Selected rows, kept with their data so a selection survives paging.
  const [selected, setSelected] = useState<Map<string, WoRow>>(new Map());
  const [modalRows, setModalRows] = useState<WoRow[] | null>(null);
  const [banner, setBanner] = useState<ReassignResult | null>(null);

  const data = useQuery(api.technicians.workOrders, {
    userId,
    search: debounced || undefined,
    priority: priority || undefined,
    status: status || undefined,
    page,
    pageSize: WO_PAGE,
  });
  const rows = data?.rows ?? [];
  const selectable = rows.filter((r) => r.reassignable);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Map(s);
      if (allSelected) for (const r of selectable) n.delete(r.id);
      else for (const r of selectable) n.set(r.id, r);
      return n;
    });
  const toggleOne = (r: WoRow) =>
    setSelected((s) => {
      const n = new Map(s);
      if (n.has(r.id)) n.delete(r.id);
      else n.set(r.id, r);
      return n;
    });

  const th = "px-3 py-3.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground";
  return (
    <div className="space-y-5">
      <Card className="!px-0">
        <div className="grid gap-3 px-5 md:grid-cols-[1fr_220px_220px]">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search work orders"
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by id, property…"
              className="h-11 pl-9"
            />
          </div>
          <LabeledSelect label="Priorities">
            <Select
              aria-label="Filter by priority"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value ?? "");
                setPage(1);
              }}
              className="h-11"
            >
              <option value="">All</option>
              <option value="emergency">Emergency</option>
              <option value="urgent">Urgent</option>
              <option value="routine">Routine</option>
            </Select>
          </LabeledSelect>
          <LabeledSelect label="Statuses">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value ?? "");
                setPage(1);
              }}
              className="h-11"
            >
              <option value="">All</option>
              {WO_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </LabeledSelect>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-[13px]">
            <caption className="sr-only">Work orders assigned to {technicianName}</caption>
            <thead>
              <tr className="border-t border-border text-left">
                <th scope="col" className="w-12 py-3.5 pl-5">
                  <input type="checkbox" aria-label="Select all reassignable work orders" checked={allSelected} disabled={selectable.length === 0} onChange={toggleAll} className="h-4 w-4 rounded accent-primary" />
                </th>
                <th scope="col" className={th}>#ID</th>
                <th scope="col" className={th}>Unit</th>
                <th scope="col" className={th}>Property</th>
                <th scope="col" className={th}>Issue</th>
                <th scope="col" className={th}>Priority</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>Asset Manager</th>
                <th scope="col" className={th}>Created</th>
                <th scope="col" className="w-12 pr-5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data === undefined ? (
                <tr><td colSpan={10} className="border-t border-border px-5 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="border-t border-border px-5 py-8 text-center text-muted-foreground">
                    {debounced || priority || status ? "No work orders match those filters." : `No work orders for ${technicianName}.`}
                  </td>
                </tr>
              ) : (
                rows.map((w) => (
                  <tr key={w.id} className={cx("border-t border-border", selected.has(w.id) && "bg-accent/50")}>
                    <td className="py-3.5 pl-5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${w.number}`}
                        title={w.reassignable ? undefined : "Only pending or in-progress work orders can be reassigned"}
                        checked={selected.has(w.id)}
                        disabled={!w.reassignable}
                        onChange={() => toggleOne(w)}
                        className="h-4 w-4 rounded accent-primary disabled:opacity-40"
                      />
                    </td>
                    <td className="px-3 py-3.5 font-medium">{w.number}</td>
                    <td className="px-3 py-3.5">{w.unitNumber ?? "–"}</td>
                    <td className="px-3 py-3.5">{w.propertyName ?? "–"}</td>
                    <td className="px-3 py-3.5 font-medium">{w.issue}</td>
                    <td className="px-3 py-3.5"><PriorityChip level={w.priority} /></td>
                    <td className="px-3 py-3.5"><WoStatusPill group={w.statusGroup} label={w.statusLabel} /></td>
                    <td className="px-3 py-3.5">{w.assetManager?.name ?? <span className="text-faint">None</span>}</td>
                    <td className="px-3 py-3.5 text-muted-foreground">
                      {new Date(w.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </td>
                    <td className="pr-5 text-right">
                      <ActionMenu
                        label={`Actions for ${w.number}`}
                        items={[
                          { label: "Open work order", onSelect: () => router.push(`/work-orders?open=work_order:${w.id}`) },
                          ...(w.reassignable ? [{ label: "Reassign", onSelect: () => setModalRows([w]) }] : []),
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-5 pb-1">
          <Pager page={data?.page ?? 1} pageCount={data?.pageCount ?? 1} total={data?.total ?? 0} pageSize={WO_PAGE} noun="work orders" onPage={setPage} />
        </div>
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <Btn variant="pri" className="h-11 px-5" onClick={() => setModalRows([...selected.values()])}>
            Manage assignment
          </Btn>
          {selected.size > 0 ? (
            <span className="text-[12.5px] text-muted-foreground">
              {selected.size} selected ·{" "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelected(new Map())}>
                Clear
              </button>
            </span>
          ) : null}
        </div>
      </Card>

      {banner ? (
        <div role="status" className="rounded-xl bg-success-soft px-4 py-3 text-success-ink">
          <div className="text-[13.5px] font-semibold">Assigned Work Order updated</div>
          <p className="mt-0.5 text-[13px]">
            {banner.workOrders.map((w) => w.number).join(", ")} {banner.workOrders.length === 1 ? "is" : "are"} no longer assigned to {technicianName}. The
            remaining work orders retain their existing assignment.
          </p>
        </div>
      ) : null}

      {modalRows ? (
        <ReassignModal
          userId={userId}
          technicianName={technicianName}
          preselected={modalRows}
          onClose={() => setModalRows(null)}
          onDone={(result) => {
            setBanner(result);
            setSelected(new Map());
          }}
        />
      ) : null}
    </div>
  );
}

function InfoBox({ title, children, tone = "muted" }: { title: string; children: ReactNode; tone?: "muted" | "blue" }) {
  return (
    <div className={cx("rounded-xl px-3.5 py-3", tone === "blue" ? "bg-accent text-primary" : "bg-muted/50")}>
      <div className="text-[13px] font-semibold">{title}</div>
      <p className={cx("mt-0.5 text-[13px]", tone === "blue" ? "" : "text-muted-foreground")}>{children}</p>
    </div>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const woLabel = (w: WoRow) => [w.number, w.propertyName, w.unitNumber ? `Unit ${w.unitNumber}` : null].filter(Boolean).join(" · ");

function ReassignModal({
  userId,
  technicianName,
  preselected,
  onClose,
  onDone,
}: {
  userId: Id<"users">;
  technicianName: string;
  preselected: WoRow[];
  onClose: () => void;
  onDone: (r: ReassignResult) => void;
}) {
  const reassign = useMutation(api.workOrders.reassignMany);
  const techs = useQuery(api.technicians.options, {});
  // Only needed when nothing was ticked: the admin picks the work order here instead.
  const pool = useQuery(api.technicians.workOrders, preselected.length === 0 ? { userId, pageSize: 100 } : "skip");
  const reassignablePool = (pool?.rows ?? []).filter((r) => r.reassignable);

  const [pickedWo, setPickedWo] = useState("");
  const [newTech, setNewTech] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReassignResult | null>(null);

  const targets: WoRow[] = preselected.length > 0 ? preselected : reassignablePool.filter((r) => r.id === pickedWo);
  const others = (techs ?? []).filter((t) => t.userId !== userId);
  const managers = [...new Set(targets.map((t) => t.assetManager?.name ?? "None"))];

  const errors = {
    wo: targets.length === 0 ? "Select the work order to reassign." : "",
    tech: !newTech ? "Select the technician to reassign these work orders to." : "",
    reason: !reason.trim() ? "Enter a reason for the reassignment." : reason.trim().length > 500 ? "The reason is too long (at most 500 characters)." : "",
  };

  async function confirm() {
    if (busy) return;
    setTouched(true);
    const first = errors.wo || errors.tech || errors.reason;
    if (first) {
      toast.error(first);
      return;
    }
    setBusy(true);
    try {
      const res = await reassign({ workOrderIds: targets.map((t) => t.id), toTechnicianUserId: newTech || null, reason: reason.trim() });
      toast.success("Assignment updated");
      setResult(res);
      onDone(res);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const numbers = result.workOrders.map((w) => w.number);
    const prev = result.previousTechnician?.name ?? (result.previousTechnicians.map((p) => p.name).join(", ") || technicianName);
    return (
      <Modal title="Assignment Updated" onClose={onClose} size="md" footer={<Btn variant="pri" className="h-11 px-10" onClick={onClose}>Done</Btn>}>
        <div className="space-y-4">
          <div className="flex gap-2.5 rounded-xl bg-success-soft px-3.5 py-3 text-success-ink">
            <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="text-[13.5px] font-semibold">{result.newTechnician.name} is now assigned</div>
              <div className="mt-0.5 text-[13px]">{fmtStamp(result.at)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <LabelValue label="Previous technician">{prev}</LabelValue>
            <LabelValue label="Current technician">{result.newTechnician.name}</LabelValue>
          </div>
          <InfoBox title="Handoff completed">
            {numbers.join(", ")} {numbers.length === 1 ? "is" : "are"} now visible to {firstName(result.newTechnician.name)}. Existing notes and review actions are
            preserved, and both technicians were notified.
          </InfoBox>
        </div>
      </Modal>
    );
  }

  const showWo = touched && errors.wo;
  const showTech = touched && errors.tech;
  const showReason = touched && errors.reason;
  return (
    <Modal
      title="Manage Work Order Assignments"
      onClose={() => (busy ? undefined : onClose())}
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <Btn className="h-11 px-8" disabled={busy} onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="pri" className="h-11 px-6" disabled={busy} onClick={() => void confirm()}>
            {busy ? "Reassigning…" : "Confirm Reassignment"}
          </Btn>
        </div>
      }
    >
      <div className="space-y-4">
        <UnderlineTabs label="Assignment actions" value="reassign" onChange={() => undefined} options={[{ value: "reassign", label: "Reassign work order" }]} />
        <div className="grid grid-cols-2 gap-4">
          <LabelValue label="Current Technician">{technicianName}</LabelValue>
          <LabelValue label="Asset Manager">{targets.length === 0 ? "–" : managers.length === 1 ? managers[0] : "Several"}</LabelValue>
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="reassign-wo-label" className="text-xs text-muted-foreground">
            {preselected.length > 1 ? `Work orders to reassign (${preselected.length})` : "Work order to reassign"}
          </span>
          {preselected.length > 0 ? (
            <ul aria-labelledby="reassign-wo-label" className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-[13px]">
              {preselected.map((w) => (
                <li key={w.id}>{woLabel(w)}</li>
              ))}
            </ul>
          ) : (
            <>
              <Select
                aria-labelledby="reassign-wo-label"
                value={pickedWo}
                placeholder={pool === undefined ? "Loading…" : reassignablePool.length === 0 ? "No work orders can be reassigned" : "Select a work order"}
                onChange={(e) => setPickedWo(e.target.value ?? "")}
                className={cx("h-11", showWo && INVALID)}
                disabled={pool === undefined || reassignablePool.length === 0}
              >
                {reassignablePool.map((w) => (
                  <option key={w.id} value={w.id}>
                    {`${woLabel(w)} — ${w.issue}`}
                  </option>
                ))}
              </Select>
              {showWo ? <p className="text-xs text-danger-ink">{errors.wo}</p> : null}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="reassign-tech-label" className="text-xs text-muted-foreground">
            Select new technician
          </span>
          <Select
            aria-labelledby="reassign-tech-label"
            value={newTech}
            placeholder={techs === undefined ? "Loading…" : others.length === 0 ? "No other technicians on the team" : "Select a technician"}
            onChange={(e) => setNewTech(e.target.value ?? "")}
            className={cx("h-11", showTech && INVALID)}
            disabled={techs === undefined || others.length === 0}
          >
            {others.map((t) => (
              <option key={t.userId} value={t.userId}>
                {t.onLeave ? `${t.name} (out of office)` : t.name}
              </option>
            ))}
          </Select>
          {showTech ? <p className="text-xs text-danger-ink">{errors.tech}</p> : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reassign-reason" className="text-xs text-muted-foreground">
            Reason for reassignment
          </label>
          <Input
            id="reassign-reason"
            value={reason}
            maxLength={500}
            placeholder="e.g., James is going on leave so Mike is available"
            onChange={(e) => setReason(e.target.value)}
            className={cx("h-11", showReason && INVALID)}
            aria-invalid={Boolean(showReason)}
          />
          {showReason ? <p className="text-xs text-danger-ink">{errors.reason}</p> : null}
        </div>

        <InfoBox title="A work order must keep one technician" tone="blue">
          Choose a replacement; removing an active work order&apos;s technician without a replacement is unavailable.
        </InfoBox>
      </div>
    </Modal>
  );
}
