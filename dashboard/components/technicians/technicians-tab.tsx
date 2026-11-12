"use client";

import { useAction, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, ClipboardList, Mail, Phone, Search, Send, Users, Wrench, Coffee } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Btn, Card, ConfirmDialog, Drawer, Input, Select, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { ActionMenu, PersonAvatar, useDebounced } from "@/components/asset-managers/shared";
import { Pagination } from "@/components/ui";
import { EMAIL_RE, INVALID, TechStatusBadge } from "./shared";

const PAGE_SIZE = 10;

type Status = "all" | "busy" | "idle";
type Overview = NonNullable<ReturnType<typeof useOverview>>;
type Row = Overview["rows"][number];

function useOverview(args: { search?: string; propertyId?: string; status?: Status; page?: number; pageSize?: number }) {
  return useQuery(api.technicians.overview, args);
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  delta,
}: {
  icon: ReactNode;
  label: string;
  value: number | undefined;
  sub?: string;
  delta?: number | null;
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
        ) : sub ? (
          <div className="text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </div>
    </div>
  );
}

function InviteCard() {
  const invite = useAction(api.technicians.invite);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const nameError = !fullName.trim()
    ? "Enter the technician's full name."
    : fullName.trim().length > 80
      ? "Full name is too long (max 80 characters)."
      : "";
  const emailError = !email.trim() ? "Enter the technician's email address." : !EMAIL_RE.test(email.trim()) ? "Enter a valid email address." : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    if (nameError || emailError) {
      toast.error(nameError || emailError);
      return;
    }
    setBusy(true);
    try {
      const res = await invite({ fullName: fullName.trim(), email: email.trim() });
      toast.success(res.status === "resent" ? `Invite re-sent to ${res.email}` : `Invite sent to ${res.email}`);
      setFullName("");
      setEmail("");
      setTouched(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const showName = touched && nameError;
  const showEmail = touched && emailError;
  return (
    <Card>
      <h2 className="text-[17px] font-semibold">Invite New Technicians</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">Create a technician account and send them an email invite.</p>
      <form onSubmit={(e) => void submit(e)} noValidate className="mt-5 grid items-start gap-3 md:grid-cols-[1fr_1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tech-invite-name" className="text-[13px] font-semibold">
            Full Name
          </label>
          <Input
            id="tech-invite-name"
            value={fullName}
            maxLength={80}
            placeholder="e.g., John Smith"
            onChange={(e) => setFullName(e.target.value)}
            className={cx("h-11", showName && INVALID)}
            aria-invalid={Boolean(showName)}
            aria-describedby={showName ? "tech-invite-name-err" : undefined}
          />
          {showName ? <p id="tech-invite-name-err" className="text-xs text-danger-ink">{nameError}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tech-invite-email" className="text-[13px] font-semibold">
            Email
          </label>
          <Input
            id="tech-invite-email"
            type="email"
            value={email}
            maxLength={254}
            placeholder="e.g., john.smith@518property.com"
            onChange={(e) => setEmail(e.target.value)}
            className={cx("h-11", showEmail && INVALID)}
            aria-invalid={Boolean(showEmail)}
            aria-describedby={showEmail ? "tech-invite-email-err" : undefined}
          />
          {showEmail ? <p id="tech-invite-email-err" className="text-xs text-danger-ink">{emailError}</p> : null}
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

export function TechniciansTab() {
  const router = useRouter();
  const base = useOverview({ pageSize: 1 });
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim());
  const [propertyId, setPropertyId] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openUser, setOpenUser] = useState<Id<"users"> | null>(null);
  const [resetFor, setResetFor] = useState<Row | null>(null);
  const [resetting, setResetting] = useState(false);
  const sendReset = useAction(api.technicians.sendPasswordReset);

  const list = useOverview({
    search: debounced || undefined,
    propertyId: propertyId || undefined,
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
    } catch (e) {
      toast.error(e);
    } finally {
      setResetting(false);
      setResetFor(null);
    }
  }

  const k = base?.kpis;
  const openRow = openUser ? (rows.find((r) => r.userId === openUser) ?? null) : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <KpiCard icon={<Users />} label="Total Technicians" value={k?.totalTechnicians} delta={k?.deltas.totalTechnicians} />
        <KpiCard icon={<Wrench />} label="Busy Technicians" value={k?.busyTechnicians} sub="Working on work orders" />
        <KpiCard icon={<Coffee />} label="Idle Technicians" value={k?.idleTechnicians} sub="No work in progress" />
      </div>

      <InviteCard />

      <Card className="!px-5">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search technicians"
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
                setPropertyId(e.target.value ?? "");
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
                const v = e.target.value;
                setStatus(v === "busy" || v === "idle" ? v : "all");
                setPage(1);
              }}
              className="h-11"
            >
              <option value="all">All</option>
              <option value="busy">Busy</option>
              <option value="idle">Idle</option>
            </Select>
          </LabeledSelect>
        </div>

        <div className="-mx-5 mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <caption className="sr-only">Technicians</caption>
            <thead>
              <tr className="bg-muted/60 text-left text-[12.5px] font-semibold text-muted-foreground">
                <th scope="col" className="w-12 py-3.5 pl-5">
                  <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded accent-primary" />
                </th>
                <th scope="col" className="px-3 py-3.5">Name</th>
                <th scope="col" className="px-3 py-3.5">Pending Work Orders</th>
                <th scope="col" className="px-3 py-3.5">Active Work Orders</th>
                <th scope="col" className="px-3 py-3.5">Needs Sign Off</th>
                <th scope="col" className="px-3 py-3.5">Status</th>
                <th scope="col" className="px-3 py-3.5 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list === undefined ? (
                <tr>
                  <td colSpan={7} className="border-t border-border px-5 py-8 text-center text-muted-foreground">Loading…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border-t border-border px-5 py-8 text-center text-muted-foreground">
                    {base && base.total === 0 ? "No technicians yet. Send an invite above." : "No technicians match those filters."}
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
                    <td className="px-3 py-3.5 font-medium text-primary tabular-nums">{r.pending}</td>
                    <td className="px-3 py-3.5 font-medium text-primary tabular-nums">{r.active}</td>
                    <td className="px-3 py-3.5 font-medium text-danger-ink tabular-nums">{r.needsSignOff}</td>
                    <td className="px-3 py-3.5">
                      <TechStatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-3.5 pr-5 text-right">
                      <ActionMenu
                        label={`Actions for ${r.name}`}
                        items={[
                          { label: "View profile", onSelect: () => router.push(`/technicians/${r.userId}`) },
                          { label: "Edit profile", onSelect: () => router.push(`/technicians/${r.userId}?edit=1`) },
                          { label: "Work orders", onSelect: () => router.push(`/technicians/${r.userId}?tab=work-orders`) },
                          { label: "Reset password", onSelect: () => setResetFor(r) },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination label="Technicians pages" page={list?.page ?? 1} pageSize={PAGE_SIZE} total={list?.total ?? 0} onPage={setPage} />
      </Card>

      <TechnicianDrawer userId={openUser} row={openRow} onClose={() => setOpenUser(null)} />

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

/** TC3: the side card opened from a row. */
function TechnicianDrawer({ userId, row, onClose }: { userId: Id<"users"> | null; row: Row | null; onClose: () => void }) {
  const router = useRouter();
  const profile = useQuery(api.technicians.profile, userId ? { userId } : "skip");
  const name = profile?.name ?? row?.name ?? "Technician";
  const assigned = profile?.counts.assigned ?? (row ? row.pending + row.active : undefined);
  const signOff = profile?.counts.awaitingSignOff ?? row?.needsSignOff;
  const cur = profile?.currentWorkOrder;

  return (
    <Drawer open={userId !== null} onClose={onClose} title={name} width={460} hideHeader>
      <div className="flex min-h-full flex-1 flex-col">
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <PersonAvatar initials={profile?.initials ?? row?.initials ?? "?"} imageUrl={profile?.imageUrl ?? row?.imageUrl} name={name} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-bold">{name}</h2>
              <TechStatusBadge status={profile?.status ?? row?.status ?? "idle"} />
            </div>
            <div className="truncate text-[12.5px] text-muted-foreground">{profile?.workEmail ?? row?.email}</div>
            <div className="text-[11.5px] text-muted-foreground">Technician</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <span aria-hidden className="block text-lg leading-none">×</span>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 border-t border-border px-5 pb-5 pt-5">
          <section>
            <h3 className="text-[15px] font-semibold">Contact Information</h3>
            <div className="mt-2 space-y-2 text-[13.5px]">
              <div className="flex items-center gap-2.5">
                <Phone aria-hidden className="h-4 w-4 text-muted-foreground" />
                {profile ? (profile.phone ?? <span className="text-muted-foreground">No phone on file</span>) : (row?.phone ?? "…")}
              </div>
              <div className="flex items-center gap-2.5">
                <Mail aria-hidden className="h-4 w-4 text-muted-foreground" />
                <span className="break-all">{profile?.workEmail ?? row?.email}</span>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-4 border-t border-border pt-4">
            <div>
              <div className="text-xs text-muted-foreground">Assigned work</div>
              <div className="mt-1 text-[13.5px] font-medium">
                {assigned === undefined ? "–" : `${assigned} work order${assigned === 1 ? "" : "s"}`}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Needs sign off</div>
              <div className="mt-1 text-[13.5px] font-medium">
                {signOff === undefined ? "–" : `${signOff} completion${signOff === 1 ? "" : "s"}`}
              </div>
            </div>
          </section>

          <section className="rounded-xl bg-muted/50 px-4 py-3.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <ClipboardList aria-hidden className="h-4 w-4 text-muted-foreground" />
              Current work order
            </div>
            {profile === undefined ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">Loading…</p>
            ) : cur ? (
              <div className="mt-1 text-[12.5px] text-muted-foreground">
                <div>
                  {cur.number} · {cur.title}
                </div>
                <div>{[cur.propertyName, cur.unitNumber, cur.window].filter(Boolean).join(" · ")}</div>
                <div className="mt-0.5">{cur.statusLabel}</div>
              </div>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted-foreground">No work order assigned right now.</p>
            )}
          </section>
        </div>

        <div className="border-t border-border p-5">
          <Btn
            variant="pri"
            className="h-11 w-full"
            disabled={!userId}
            onClick={() => {
              if (!userId) return;
              onClose();
              router.push(`/technicians/${userId}`);
            }}
          >
            View Profile
          </Btn>
        </div>
      </div>
    </Drawer>
  );
}
