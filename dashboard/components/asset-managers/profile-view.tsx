"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PHOTO_EMAIL_INVALID, speakablePhotoEmail } from "@/convex/sarahReplies";
import { PriorityChip, StatusPill } from "@/components/board/chips";
import { browserTimeZone } from "@/components/dashboard/format";
import { toast } from "@/components/toast";
import { Btn, Card, ConfirmDialog, Input, PageHeader, Textarea, cx } from "@/components/ui";
import { ManagerAvailabilityModal } from "./manager-availability";
import { ManageUnitsModal } from "./manage-units-modal";
import { ActionMenu, LabelValue, Pager, StatusBadge, UnderlineTabs } from "./shared";

type Tab = "overview" | "work-orders" | "units";
type Profile = NonNullable<FunctionReturnType<typeof api.assetManagers.profile>>;

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

const outlineBtn =
  "inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-primary bg-card text-[13px] font-semibold text-primary transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function ProfileView({ userId }: { userId: Id<"users"> }) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "work-orders" || raw === "units" ? raw : "overview";
  const profile = useQuery(api.assetManagers.profile, { userId, fallbackTimeZone: browserTimeZone() });
  const base = `/asset-managers/${userId}`;
  const setTab = (t: Tab) => router.replace(t === "overview" ? base : `${base}?tab=${t}`, { scroll: false });

  return (
    <div className="space-y-5 pb-10">
      <div>
        <Link href="/asset-managers" className="mb-2 inline-block text-[13px] font-medium text-primary hover:underline">
          ← Asset Managers
        </Link>
        <PageHeader title="Asset Manager" subtitle="Manage Asset Manager profile" />
      </div>
      <UnderlineTabs
        label="Asset manager sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview" },
          { value: "work-orders", label: "Work orders" },
          { value: "units", label: "Assigned units" },
        ]}
      />
      {profile === undefined ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">Loading…</p>
      ) : tab === "overview" ? (
        <OverviewTab userId={userId} profile={profile} setTab={setTab} startInEdit={params.get("edit") === "1"} />
      ) : tab === "work-orders" ? (
        <WorkOrdersTab userId={userId} />
      ) : (
        <UnitsTab userId={userId} profile={profile} />
      )}
    </div>
  );
}

function OverviewTab({ userId, profile, setTab, startInEdit }: { userId: Id<"users">; profile: Profile; setTab: (t: Tab) => void; startInEdit: boolean }) {
  const cards: Array<{ title: string; value: number; to: Tab }> = [
    { title: "Assigned units", value: profile.counts.assignedUnits, to: "units" },
    { title: "Open requests", value: profile.counts.openRequests, to: "work-orders" },
    { title: "Active work orders", value: profile.counts.activeWorkOrders, to: "work-orders" },
    { title: "Properties", value: profile.counts.properties, to: "units" },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title} className="flex flex-col gap-4">
            <h2 className="text-[15px] font-semibold">{c.title}</h2>
            <div className="text-[28px] font-bold tabular-nums">{c.value}</div>
            <button type="button" onClick={() => setTab(c.to)} className={outlineBtn}>
              View details →
            </button>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ProfileCard userId={userId} profile={profile} startInEdit={startInEdit} />
        <ScheduleCard userId={userId} profile={profile} />
      </div>
    </div>
  );
}

function ScheduleCard({ userId, profile }: { userId: Id<"users">; profile: Profile }) {
  const cal = `/asset-managers/${userId}/calendar`;
  return (
    <Card className="self-start">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Today&apos;s Schedule</h2>
        <Link href={cal} className="text-[12.5px] font-medium text-primary hover:underline">
          View Calendar →
        </Link>
      </div>
      {profile.todaySchedule.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-muted-foreground">No tours booked today.</p>
      ) : (
        <ul>
          {profile.todaySchedule.map((t, i) => (
            <li key={t.id} className={cx("border-border", i > 0 && "border-t")}>
              <Link href={cal} className="flex items-center gap-3 py-3 hover:bg-muted/50">
                <span className="w-[62px] shrink-0 text-[12.5px] text-muted-foreground">{t.time}</span>
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{t.title}</span>
                  {t.sub ? <span className="block text-xs text-muted-foreground">{t.sub}</span> : null}
                </span>
                <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Draft = { personalEmail: string; photoEmail: string; phone: string; internalNotes: string };

function ProfileCard({ userId, profile, startInEdit }: { userId: Id<"users">; profile: Profile; startInEdit: boolean }) {
  const updateProfile = useMutation(api.assetManagers.updateProfile);
  const sendReset = useAction(api.assetManagers.sendPasswordReset);
  const draftOf = (): Draft => ({
    personalEmail: profile.personalEmail ?? "",
    photoEmail: profile.photoEmail ?? "",
    phone: profile.phone ?? "",
    internalNotes: profile.internalNotes,
  });
  const [draft, setDraft] = useState<Draft | null>(() => (startInEdit ? draftOf() : null));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);

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
    personalEmail: draft && draft.personalEmail.trim() !== "" && !EMAIL_RE.test(draft.personalEmail.trim()) ? "Enter a valid email address." : "",
    photoEmail: draft && draft.photoEmail.trim() !== "" && !speakablePhotoEmail(draft.photoEmail) ? PHOTO_EMAIL_INVALID : "",
    phone: draft && phoneClean !== "" && !E164_RE.test(phoneClean) ? "Use international format, e.g. +14165550187." : "",
  };

  async function save() {
    if (!draft) return;
    setTouched(true);
    const first = errors.personalEmail || errors.photoEmail || errors.phone;
    if (first) {
      toast.error(first);
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        userId,
        personalEmail: draft.personalEmail.trim(),
        photoEmail: draft.photoEmail.trim(),
        phone: phoneClean,
        internalNotes: draft.internalNotes,
      });
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
          <StatusBadge status={profile.status} />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <LabelValue label="Work Email">
            <span className="break-all text-[15px] font-normal">{profile.workEmail}</span>
          </LabelValue>
          <LabelValue label="Contact Number">
            <span className="text-[15px] font-normal">{profile.phone ?? "Not set"}</span>
          </LabelValue>
          <LabelValue label="Photo Email">
            <span className="break-all text-[15px] font-normal">{profile.photoEmail ?? "Not set"}</span>
          </LabelValue>
        </div>
        <div className="mt-4">
          <LabelValue label="Availability">
            <span className="text-[13.5px] font-medium">{profile.availabilitySummary}</span>
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
  return (
    <Card className="self-start">
      <h2 className="mb-6 text-[20px] font-bold">Account Information</h2>
      <div className="space-y-4">
        <div className={row}>
          <label htmlFor="am-full-name" className={lbl}>Full Name</label>
          <div>
            <Input id="am-full-name" value={profile.name} disabled readOnly className="h-11" />
            <p className="mt-1 text-xs text-muted-foreground">Comes from sign-in</p>
          </div>
        </div>
        <div className={row}>
          <label htmlFor="am-personal-email" className={lbl}>Personal Email</label>
          <div>
            <Input id="am-personal-email" type="email" value={draft.personalEmail} maxLength={254} placeholder="name@gmail.com" onChange={(e) => set({ personalEmail: e.target.value })} className="h-11" aria-invalid={touched && Boolean(errors.personalEmail)} />
            {errors.personalEmail ? <p className="mt-1 text-xs text-danger-ink">{errors.personalEmail}</p> : null}
          </div>
        </div>
        <div className={row}>
          <label htmlFor="am-work-email" className={lbl}>Work Email</label>
          <div>
            <Input id="am-work-email" value={profile.workEmail} disabled readOnly className="h-11" />
            <p className="mt-1 text-xs text-muted-foreground">Comes from sign-in</p>
          </div>
        </div>
        <div className={row}>
          <label htmlFor="am-photo-email" className={lbl}>Photo Email</label>
          <div>
            <Input id="am-photo-email" type="email" value={draft.photoEmail} maxLength={254} placeholder="goldteam@518propertypro.com" onChange={(e) => set({ photoEmail: e.target.value })} className="h-11 aria-invalid:border-danger-ink" aria-invalid={touched && Boolean(errors.photoEmail)} aria-describedby="am-photo-email-help" />
            {touched && errors.photoEmail ? (
              <p className="mt-1 text-xs text-danger-ink">{errors.photoEmail}</p>
            ) : (
              <p id="am-photo-email-help" className="mt-1 text-xs text-muted-foreground">
                Sarah tells tenants in this person&apos;s units to email repair photos here. Leave empty and she says the asset manager will follow up.
              </p>
            )}
          </div>
        </div>
        <div className={row}>
          <label htmlFor="am-phone" className={lbl}>Contact Number</label>
          <div>
            <Input id="am-phone" type="tel" value={draft.phone} maxLength={24} placeholder="+1 416 555 0187" onChange={(e) => set({ phone: e.target.value })} className="h-11" aria-invalid={touched && Boolean(errors.phone)} />
            {errors.phone ? <p className="mt-1 text-xs text-danger-ink">{errors.phone}</p> : null}
          </div>
        </div>
        <div className={row}>
          <label htmlFor="am-password" className={lbl}>Password</label>
          <div className="flex gap-3">
            <Input id="am-password" type="password" value="••••••••••••••••" disabled readOnly className="h-11" />
            <Btn onClick={() => setConfirmReset(true)} className="h-11 shrink-0 border-primary px-4 font-semibold text-primary hover:bg-accent">
              Reset Password
            </Btn>
          </div>
        </div>
        <div className={row}>
          <label htmlFor="am-availability" className={lbl}>Availability</label>
          <div className="flex gap-3">
            <Input id="am-availability" value={profile.availabilitySummary} readOnly className="h-11" />
            <Btn variant="pri" onClick={() => setAvailOpen(true)} className="h-11 shrink-0 px-4 font-semibold">
              Edit Availability
            </Btn>
          </div>
        </div>
        <div className={row}>
          <label htmlFor="am-notes" className={lbl}>Internal notes</label>
          <Textarea id="am-notes" value={draft.internalNotes} maxLength={2000} onChange={(e) => set({ internalNotes: e.target.value })} />
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
      {availOpen ? <ManagerAvailabilityModal userId={userId} onClose={() => setAvailOpen(false)} /> : null}
    </Card>
  );
}

const WO_PAGE = 10;

function WorkOrdersTab({ userId }: { userId: Id<"users"> }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const data = useQuery(api.assetManagers.workOrders, { userId, page, pageSize: WO_PAGE });
  const th = "px-3 py-3.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground";
  return (
    <Card className="!px-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <caption className="sr-only">Work orders</caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="w-12 py-3.5 pl-5"><input type="checkbox" aria-label="Select all" className="h-4 w-4 rounded accent-primary" /></th>
              <th scope="col" className={th}>#ID</th>
              <th scope="col" className={th}>Unit</th>
              <th scope="col" className={th}>Property</th>
              <th scope="col" className={th}>Issue</th>
              <th scope="col" className={th}>Priority</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>Asset Manager</th>
              <th scope="col" className={th}>Technician</th>
              <th scope="col" className={th}>Created</th>
              <th scope="col" className="w-12 pr-5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data === undefined ? (
              <tr><td colSpan={11} className="border-t border-border px-5 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan={11} className="border-t border-border px-5 py-8 text-center text-muted-foreground">No work orders for this asset manager.</td></tr>
            ) : (
              data.rows.map((w) => (
                <tr key={w.id} className="border-t border-border">
                  <td className="py-3.5 pl-5"><input type="checkbox" aria-label={`Select ${w.number}`} className="h-4 w-4 rounded accent-primary" /></td>
                  <td className="px-3 py-3.5 font-medium">{w.number}</td>
                  <td className="px-3 py-3.5">{w.unitNumber ?? "–"}</td>
                  <td className="px-3 py-3.5">{w.propertyName ?? "–"}</td>
                  <td className="px-3 py-3.5 font-medium">{w.issue}</td>
                  <td className="px-3 py-3.5"><PriorityChip level={w.priorityLevel} /></td>
                  <td className="px-3 py-3.5"><StatusPill statusKey={w.statusKey} label={w.statusLabel} /></td>
                  <td className="px-3 py-3.5">{w.assetManager.name}</td>
                  <td className="px-3 py-3.5">{w.technician?.name ?? <span className="text-faint">Unassigned</span>}</td>
                  <td className="px-3 py-3.5 text-muted-foreground">
                    {new Date(w.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td className="pr-5 text-right">
                    <ActionMenu label={`Actions for ${w.number}`} items={[{ label: "Open", onSelect: () => router.push(`/work-orders?open=work_order:${w.id}`) }]} />
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
    </Card>
  );
}

function UnitsTab({ userId, profile }: { userId: Id<"users">; profile: Profile }) {
  const units = useQuery(api.assetManagers.assignedUnits, { userId });
  const [manage, setManage] = useState<{ unitId?: Id<"units"> } | null>(null);
  const firstUnit = units?.[0];
  const th = "px-3 py-3 text-left text-[12px] font-medium text-muted-foreground";
  return (
    <Card>
      <h2 className="mb-4 text-[15px] font-semibold">Unit ownership</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <caption className="sr-only">Unit ownership</caption>
          <thead>
            <tr className="bg-muted/60">
              <th scope="col" className={th}>Property / unit</th>
              <th scope="col" className={th}>Beds / baths</th>
              <th scope="col" className={th}>Availability</th>
              <th scope="col" className={th}>Open requests</th>
              <th scope="col" className={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {units === undefined ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : units.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No units assigned yet.</td></tr>
            ) : (
              units.map((u) => (
                <tr key={u.unitId} className="border-t border-border">
                  <td className="px-3 py-6 font-medium">{u.propertyName} · {u.unitNumber}</td>
                  <td className="px-3 py-6">{u.bedsBaths}</td>
                  <td className="px-3 py-6">{u.availability}</td>
                  <td className="px-3 py-6">{u.openRequests}</td>
                  <td className="px-3 py-6">
                    <div className="flex items-center gap-4">
                      <Link href={`/properties?property=${u.propertyId}`} className="font-medium text-primary hover:underline">View unit →</Link>
                      <button type="button" onClick={() => setManage({ unitId: u.unitId })} className="text-muted-foreground hover:text-foreground hover:underline">Reassign</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4">
        {firstUnit ? (
          <Link
            href={`/properties?property=${firstUnit.propertyId}`}
            className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            View {firstUnit.propertyName} {firstUnit.unitNumber}
          </Link>
        ) : null}
        <button type="button" onClick={() => setManage({ unitId: firstUnit?.unitId })} className={cx(outlineBtn, "w-auto px-5")}>
          Manage assignment
        </button>
      </div>
      {manage && units ? (
        <ManageUnitsModal
          userId={userId}
          managerName={profile.name}
          portfolioCount={profile.counts.assignedUnits}
          units={units}
          preselectUnitId={manage.unitId}
          onClose={() => setManage(null)}
        />
      ) : null}
    </Card>
  );
}
