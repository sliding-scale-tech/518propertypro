"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Building2,
  CalendarCheck,
  FileText,
  Home,
  Mail,
  Pencil,
  Phone,
  Search,
  Send,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Btn, Card, ConfirmDialog, Drawer, DrawerSection, Input, Select, Textarea, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { ActionMenu, PersonAvatar, Pager, StatusBadge, useDebounced } from "./shared";

const PAGE_SIZE = 10;
const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;

type Row = NonNullable<ReturnType<typeof useOverview>>["rows"][number];
function useOverview(args: {
  search?: string;
  propertyId?: Id<"properties">;
  status?: "all" | "active" | "on_leave";
  page?: number;
  pageSize?: number;
}) {
  return useQuery(api.assetManagers.overview, args);
}

function KpiCard({
  icon,
  label,
  value,
  delta,
}: {
  icon: ReactNode;
  label: string;
  value: number | undefined;
  delta: number | null | undefined;
}) {
  return (
    <div className="flex items-center gap-4 rounded-[18px] border border-border bg-card px-5 py-4">
      <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] text-muted-foreground">{label}</div>
        <div className="text-[28px] font-bold leading-tight tabular-nums">{value ?? "–"}</div>
        {delta !== null && delta !== undefined ? (
          <div className={cx("flex items-center gap-1 text-xs font-medium", delta >= 0 ? "text-success-ink" : "text-danger-ink")}>
            {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {delta >= 0 ? "+" : ""}
            {delta}% <span className="font-normal text-muted-foreground">vs last month</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InviteCard() {
  const invite = useAction(api.assetManagers.invite);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const nameOk = fullName.trim().length > 0 && fullName.trim().length <= 80;
  const emailOk = EMAIL_RE.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!nameOk || !emailOk || busy) return;
    setBusy(true);
    try {
      const res = await invite({ fullName: fullName.trim(), email: email.trim() });
      toast.success(res.status === "resent" ? "Invite re-sent" : `Invite sent to ${res.email}`);
      setFullName("");
      setEmail("");
      setTouched(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-[17px] font-semibold">Invite New Asset Manager</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">Send an email invite to create their asset manager account.</p>
      <form onSubmit={(e) => void submit(e)} noValidate className="mt-5 grid items-start gap-3 md:grid-cols-[1fr_1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="am-invite-name" className="text-[13px] font-semibold">
            Full Name
          </label>
          <Input id="am-invite-name" value={fullName} maxLength={80} placeholder="e.g., John Smith" onChange={(e) => setFullName(e.target.value)} className="h-11" aria-invalid={touched && !nameOk} />
          {touched && !nameOk ? <p className="text-xs text-danger-ink">Enter their full name.</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="am-invite-email" className="text-[13px] font-semibold">
            Email
          </label>
          <Input id="am-invite-email" type="email" value={email} maxLength={254} placeholder="e.g., john.smith@518property.com" onChange={(e) => setEmail(e.target.value)} className="h-11" aria-invalid={touched && !emailOk} />
          {touched && !emailOk ? <p className="text-xs text-danger-ink">Enter a valid email address.</p> : null}
        </div>
        <div className="md:pt-[27px]">
          <Btn type="submit" variant="pri" disabled={busy} className="h-11 w-full px-5 md:w-auto">
            {busy ? "Sending…" : "Send Invite"}
            <Send className="h-4 w-4" />
          </Btn>
        </div>
      </form>
    </Card>
  );
}

function LabeledSelect({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute -top-2 left-3 z-[1] bg-card px-1 text-[11px] font-semibold text-foreground">{label}</span>
      {children}
    </div>
  );
}

export function ManagersTab() {
  const router = useRouter();
  const base = useOverview({ pageSize: 1 });
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim());
  const [propertyId, setPropertyId] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "on_leave">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openUser, setOpenUser] = useState<Id<"users"> | null>(null);
  const [resetFor, setResetFor] = useState<Row | null>(null);
  const [resetting, setResetting] = useState(false);
  const sendReset = useAction(api.assetManagers.sendPasswordReset);

  const list = useOverview({
    search: debounced || undefined,
    propertyId: propertyId ? (propertyId as Id<"properties">) : undefined,
    status,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = list?.rows ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.userId));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.userId)));
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function doReset() {
    if (!resetFor) return;
    setResetting(true);
    try {
      await sendReset({ userId: resetFor.userId });
      toast.success(`Reset email sent to ${resetFor.email}`);
      setResetFor(null);
    } catch (e) {
      toast.error(e);
      setResetFor(null);
    } finally {
      setResetting(false);
    }
  }

  const k = base?.kpis;
  const openRow = openUser ? (list?.rows.find((r) => r.userId === openUser) ?? base?.rows.find((r) => r.userId === openUser) ?? null) : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={<Users />} label="Total Asset Managers" value={k?.totalAssetManagers} delta={k?.deltas.totalAssetManagers} />
        <KpiCard icon={<Home />} label="Assigned Units" value={k?.assignedUnits} delta={k?.deltas.assignedUnits} />
        <KpiCard icon={<CalendarCheck />} label="Open Requests" value={k?.openRequests} delta={k?.deltas.openRequests} />
        <KpiCard icon={<Wrench />} label="Active Work Orders" value={k?.activeWorkOrders} delta={k?.deltas.activeWorkOrders} />
      </div>

      <InviteCard />

      <Card className="!px-5">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search asset managers"
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by name, email or property…"
              className="h-11 pl-9"
            />
          </div>
          <LabeledSelect label="All Properties">
            <Select
              aria-label="Filter by property"
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setPage(1);
              }}
              className="h-11"
            >
              <option value="">All</option>
              {(base?.propertyOptions ?? []).map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.name}
                </option>
              ))}
            </Select>
          </LabeledSelect>
          <LabeledSelect label="All Statuses">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "all" | "active" | "on_leave");
                setPage(1);
              }}
              className="h-11"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="on_leave">On Leave</option>
            </Select>
          </LabeledSelect>
        </div>

        <div className="-mx-5 mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <caption className="sr-only">Asset managers</caption>
            <thead>
              <tr className="bg-muted/60 text-left text-[12.5px] font-semibold text-muted-foreground">
                <th scope="col" className="w-12 py-3.5 pl-5">
                  <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded accent-primary" />
                </th>
                <th scope="col" className="px-3 py-3.5">Name</th>
                <th scope="col" className="px-3 py-3.5">Assigned Units</th>
                <th scope="col" className="px-3 py-3.5">Open Requests</th>
                <th scope="col" className="px-3 py-3.5">Active Work Orders</th>
                <th scope="col" className="px-3 py-3.5">Properties</th>
                <th scope="col" className="px-3 py-3.5">Status</th>
                <th scope="col" className="px-3 py-3.5 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list === undefined ? (
                <tr>
                  <td colSpan={8} className="border-t border-border px-5 py-8 text-center text-muted-foreground">Loading…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="border-t border-border px-5 py-8 text-center text-muted-foreground">
                    {base && base.total === 0 ? "No asset managers yet. Send an invite above." : "No asset managers match those filters."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.userId}
                    onClick={() => setOpenUser(r.userId)}
                    className={cx("cursor-pointer border-t border-border hover:bg-muted/50", selected.has(r.userId) && "bg-accent/50")}
                  >
                    <td className="py-3.5 pl-5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.userId)} onChange={() => toggleOne(r.userId)} className="h-4 w-4 rounded accent-primary" />
                    </td>
                    <td className="px-3 py-3.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenUser(r.userId);
                        }}
                        className="flex items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <PersonAvatar initials={r.initials} imageUrl={r.imageUrl} name={r.name} />
                        <span className="min-w-0">
                          <span className="block font-semibold">{r.name}</span>
                          <span className="block text-xs text-muted-foreground">{r.email}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-3.5 font-medium text-primary tabular-nums">{r.assignedUnits}</td>
                    <td className="px-3 py-3.5 font-medium text-danger-ink tabular-nums">{r.openRequests}</td>
                    <td className="px-3 py-3.5 font-medium text-primary tabular-nums">{r.activeWorkOrders}</td>
                    <td className="px-3 py-3.5">
                      {r.properties.length === 0 ? (
                        <span className="text-faint">None</span>
                      ) : (
                        <>
                          <div className="font-medium">{r.properties[0].name}</div>
                          {r.moreCount > 0 ? <div className="text-xs text-primary">+{r.moreCount} more</div> : null}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-3.5 pr-5 text-right">
                      <ActionMenu
                        label={`Actions for ${r.name}`}
                        items={[
                          { label: "View profile", onSelect: () => router.push(`/asset-managers/${r.userId}`) },
                          { label: "Edit profile", onSelect: () => router.push(`/asset-managers/${r.userId}?edit=1`) },
                          { label: "Reset password", onSelect: () => setResetFor(r) },
                          { label: "Open calendar", onSelect: () => router.push(`/asset-managers/${r.userId}/calendar`) },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager page={list?.page ?? 1} pageCount={list?.pageCount ?? 1} total={list?.total ?? 0} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>

      <ProfileDrawer userId={openUser} row={openRow} onClose={() => setOpenUser(null)} />

      <ConfirmDialog
        open={resetFor !== null}
        title={`Email ${resetFor?.name ?? ""} a password reset link?`}
        message="They will get an email pointing to the sign-in page, where Forgot password starts the reset. You can send up to 3 per person per day."
        confirmLabel="Send reset email"
        busy={resetting}
        onConfirm={() => void doReset()}
        onCancel={() => (resetting ? undefined : setResetFor(null))}
      />
    </div>
  );
}

function StatTile({ icon, label, value, onClick }: { icon: ReactNode; label: string; value: number | undefined; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-primary [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] text-muted-foreground">{label}</span>
        <span className="block text-[18px] font-bold tabular-nums">{value ?? "–"}</span>
      </span>
      <ArrowRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

function ProfileDrawer({ userId, row, onClose }: { userId: Id<"users"> | null; row: Row | null; onClose: () => void }) {
  const router = useRouter();
  const profile = useQuery(api.assetManagers.profile, userId ? { userId } : "skip");
  const updateProfile = useMutation(api.assetManagers.updateProfile);
  const [editingFor, setEditingFor] = useState<Id<"users"> | null>(null);
  const editing = userId !== null && editingFor === userId;
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const name = profile?.name ?? row?.name ?? "Asset manager";
  const go = (path: string) => {
    onClose();
    router.push(path);
  };
  const base = userId ? `/asset-managers/${userId}` : "";

  async function saveNotes() {
    if (!userId) return;
    setSaving(true);
    try {
      await updateProfile({ userId, internalNotes: notes });
      toast.success("Notes saved");
      setEditingFor(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={userId !== null} onClose={onClose} title={name} width={460} hideHeader>
      <div className="flex min-h-full flex-1 flex-col">
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <PersonAvatar initials={profile?.initials ?? row?.initials ?? "?"} imageUrl={profile?.imageUrl ?? row?.imageUrl} name={name} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-bold">{name}</h2>
              <StatusBadge status={profile?.status ?? row?.status ?? "active"} />
            </div>
            <div className="truncate text-[12.5px] text-muted-foreground">{profile?.workEmail ?? row?.email}</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <span aria-hidden className="block text-lg leading-none">×</span>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 px-5 pb-5">
          <div className="grid grid-cols-2 gap-3">
            <StatTile icon={<Users />} label="Assigned Units" value={profile?.counts.assignedUnits ?? row?.assignedUnits} onClick={() => go(`${base}?tab=units`)} />
            <StatTile icon={<CalendarCheck />} label="Open Requests" value={profile?.counts.openRequests ?? row?.openRequests} onClick={() => go(`/work-orders?am=${userId}`)} />
            <StatTile icon={<Wrench />} label="Open Work Orders" value={profile?.counts.activeWorkOrders ?? row?.activeWorkOrders} onClick={() => go(`${base}?tab=work-orders`)} />
            <StatTile icon={<Home />} label="Properties" value={profile?.counts.properties ?? row?.properties.length} onClick={() => go(`${base}?tab=units`)} />
          </div>

          <DrawerSection
            title={
              <span className="flex items-center justify-between normal-case tracking-normal">
                <span className="text-[15px] font-semibold text-foreground">Properties</span>
                <Link href={`${base}?tab=units`} onClick={onClose} className="text-[12.5px] font-medium text-primary hover:underline">
                  View all →
                </Link>
              </span>
            }
          >
            {profile === undefined ? (
              <p className="text-[13px] text-muted-foreground">Loading…</p>
            ) : profile.properties.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No units assigned yet.</p>
            ) : (
              <ul className="space-y-3">
                {profile.properties.map((p) => (
                  <li key={p.propertyId} className="flex items-center gap-3">
                    <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="text-[13.5px] font-semibold">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.unitCount} unit{p.unitCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>

          <DrawerSection title={<span className="text-[15px] font-semibold normal-case tracking-normal text-foreground">Contact Information</span>}>
            <div className="space-y-2 text-[13.5px]">
              <div className="flex items-center gap-2.5">
                <Phone aria-hidden className="h-4 w-4 text-muted-foreground" />
                {profile?.phone ?? <span className="text-muted-foreground">No phone on file</span>}
              </div>
              <div className="flex items-center gap-2.5">
                <Mail aria-hidden className="h-4 w-4 text-muted-foreground" />
                {profile?.workEmail ?? row?.email}
              </div>
            </div>
          </DrawerSection>

          <DrawerSection
            title={
              <span className="flex items-center justify-between normal-case tracking-normal">
                <span className="text-[15px] font-semibold text-foreground">Notes</span>
                {!editing && profile ? (
                  <button
                    type="button"
                    aria-label="Edit notes"
                    onClick={() => {
                      setNotes(profile.internalNotes);
                      setEditingFor(userId);
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
            }
          >
            {editing ? (
              <div className="space-y-2">
                <Textarea aria-label="Internal notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Btn sm onClick={() => setEditingFor(null)} disabled={saving}>
                    Cancel
                  </Btn>
                  <Btn sm variant="pri" onClick={() => void saveNotes()} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="flex gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[13px] text-muted-foreground">
                <FileText aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="whitespace-pre-wrap break-words">{profile ? profile.internalNotes || "No notes yet." : "Loading…"}</p>
              </div>
            )}
          </DrawerSection>
        </div>

        <div className="border-t border-border p-5">
          <Btn variant="pri" className="h-11 w-full" disabled={!userId} onClick={() => go(base)}>
            View Profile
          </Btn>
        </div>
      </div>
    </Drawer>
  );
}
