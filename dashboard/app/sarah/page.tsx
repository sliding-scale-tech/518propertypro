"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, CheckCircle2, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { CALL_TYPES, isApprovalRequired } from "@/convex/sarahConfigLib";
import type { SarahConfig } from "@/convex/sarahConfigLib";
import { RequireView } from "@/components/require-view";
import { BuiltInQuestions, ScreeningQuestions } from "@/components/screening-questions";
import { Field, Modal, btnDanger, btnOutline, btnPrimary, cleanError, formatWhen, inputClass } from "@/components/maintenance/shared";
import { useToast } from "@/components/toast";

/**
 * Sarah configuration (build plan P17). Everything here edits a DRAFT; nothing changes on live
 * calls until Publish. The server enforces every rule the buttons show (who may edit, approval
 * locks, phone formats); the disabled states here are explanation, not the boundary.
 */

const TABS = [
  { id: "call-types", label: "Call types" },
  { id: "maintenance", label: "Maintenance questions" },
  { id: "severity", label: "Severity" },
  { id: "emergency", label: "Emergency scripts" },
  { id: "escalation", label: "Escalation contacts" },
  { id: "routing", label: "Routing directory" },
  { id: "leasing", label: "Leasing" },
  { id: "identity", label: "Identity" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const INCIDENT_LABEL: Record<SarahConfig["emergencyScripts"][number]["incident"], string> = {
  fire: "Fire or smoke",
  flooding: "Flooding",
  gas_hissing: "Gas smell with hissing",
  gas_slight: "Slight gas smell, no hissing",
  other: "Anything else life-threatening",
};

const LEVEL_LABEL = { emergency: "Emergency", urgent: "Urgent", routine: "Routine", informational: "Informational" } as const;

function json(c: SarahConfig | null) {
  return JSON.stringify(c);
}

function when(ms?: number) {
  return ms ? formatWhen(ms) : "";
}

// --- Small building blocks -------------------------------------------------------------------

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  lockedReason,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  lockedReason?: string;
}) {
  const locked = !!lockedReason && !checked;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={locked ? lockedReason : undefined}
      disabled={locked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      >
        {locked ? <Lock className="h-3 w-3 text-muted-foreground" /> : null}
      </span>
    </button>
  );
}

/** An ordered list of short strings: edit, add, remove, move up/down. */
function ListEditor({
  items,
  onChange,
  placeholder,
  addLabel = "Add",
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="mt-2 w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
          <textarea
            rows={1}
            className={`${inputClass} min-h-9 flex-1 resize-y`}
            value={item}
            maxLength={400}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
          />
          <button type="button" aria-label="Move up" className="rounded-lg p-2 hover:bg-accent disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Move down" className="rounded-lg p-2 hover:bg-accent disabled:opacity-30" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Remove" className="rounded-lg p-2 text-destructive hover:bg-destructive/10" onClick={() => onChange(items.filter((_, k) => k !== i))}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button type="button" className={btnOutline} onClick={() => onChange([...items, ""])}>
        <Plus className="h-4 w-4" /> {addLabel}
      </button>
    </div>
  );
}

function ApprovalLine({
  by,
  at,
  canApprove,
  unsaved,
  onApprove,
  busy,
}: {
  by?: string;
  at?: number;
  canApprove: boolean;
  unsaved: boolean;
  onApprove: () => void;
  busy: boolean;
}) {
  if (by) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Approved by {by}
        {at ? ` on ${new Date(at).toLocaleDateString()}` : ""}
      </span>
    );
  }
  if (!canApprove) return <span className="text-xs text-muted-foreground">Needs approval from the maintenance lead</span>;
  return (
    <button
      type="button"
      className={btnOutline}
      disabled={unsaved || busy}
      title={unsaved ? "Save the draft first, so you approve exactly what is saved." : undefined}
      onClick={onApprove}
    >
      Approve
    </button>
  );
}

// --- Page --------------------------------------------------------------------------------------

function SarahPageInner() {
  const data = useQuery(api.sarahConfig.get);
  const saveDraft = useMutation(api.sarahConfig.saveDraft);
  const approve = useMutation(api.sarahConfig.approve);
  const previewAction = useAction(api.sarahConfig.preview);
  const publishAction = useAction(api.sarahConfig.publish);
  const rollbackAction = useAction(api.sarahConfig.rollback);
  const toast = useToast();

  // ?tab=leasing deep link (the old /screening redirects here). Read from window, like the
  // calendar page does, to avoid a Suspense boundary around the whole page.
  const [tab, setTab] = useState<TabId>(() => {
    if (typeof window === "undefined") return "call-types";
    const t = new URLSearchParams(window.location.search).get("tab");
    return TABS.find((x) => x.id === t)?.id ?? "call-types";
  });
  // null = no local edits: the page shows the server's draft directly.
  const [edits, setEdits] = useState<SarahConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState<number | null>(null);

  const serverDraft = data?.draft ?? null;
  const local = edits ?? serverDraft;
  const unsaved = edits !== null && serverDraft !== null && json(edits) !== json(serverDraft);

  const set = (fn: (c: SarahConfig) => SarahConfig) => {
    const base = edits ?? serverDraft;
    if (base) setEdits(fn(base));
  };

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  if (data === undefined || local === null) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(cleanError(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const onSave = () =>
    run("save", async () => {
      if (Object.values(local.leasing).some((x) => typeof x === "number" && !Number.isFinite(x))) {
        throw new Error("Fill in every number on the Leasing tab.");
      }
      // JSON round-trip drops undefined fields, which Convex arguments do not accept.
      const clean: SarahConfig = JSON.parse(JSON.stringify(local));
      await saveDraft({ config: clean });
      // Not unsaved any more; the server's copy (approvals may have been stripped) syncs in.
      setEdits(null);
      toast("Draft saved", "success");
    });

  const onApprove = (kind: "callType" | "emergencyScript" | "tenantResponsibility", key: string) =>
    run("approve", async () => {
      await approve({ kind, key });
      toast("Approved", "success");
    });

  const onPreview = () =>
    run("preview", async () => {
      setPreviewText(await previewAction({}));
    });

  const onPublish = () =>
    run("publish", async () => {
      const version = await publishAction({});
      setConfirmPublish(false);
      toast(`Published version ${version}. Sarah is updated.`, "success");
    });

  const onRollback = (version: number) =>
    run("rollback", async () => {
      const v = await rollbackAction({ version });
      setConfirmRollback(null);
      toast(`Rolled back. Published as version ${v}.`, "success");
    });

  const canEdit = data.canEdit;
  const canApprove = data.canApprove;
  const approving = busy === "approve";

  return (
    <div className="space-y-5 pb-44 lg:pb-28">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Sarah configuration</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
          Change what Sarah asks and says without a developer. You edit a draft; nothing changes on
          live calls until you publish.{" "}
          {data.version > 0
            ? `Live: version ${data.version}, published ${when(data.publishedAt ?? undefined)}.`
            : "Nothing has been published from here yet, so Sarah is still running her built-in setup."}
          {!canEdit ? " You can view this page but not change it." : ""}
        </p>
      </header>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Disabled for anyone who cannot edit: the server rejects their writes anyway. */}
      <fieldset disabled={!canEdit || busy === "save"} className="space-y-4 border-0 p-0">
        {tab === "call-types" ? (
          <Section
            title="Which calls Sarah handles"
            hint="Anything switched off is not discussed: Sarah takes a name and number and logs it for staff. Emergency, eviction, neighbor dispute and owner routing stay locked until the maintenance lead approves them."
          >
            <div className="divide-y divide-border">
              {CALL_TYPES.map((def) => {
                const t = local.callTypes.find((x) => x.key === def.key)!;
                const needs = isApprovalRequired(def.key);
                return (
                  <div key={def.key} className="flex flex-wrap items-center gap-3 py-3">
                    <Toggle
                      label={def.label}
                      checked={t.enabled}
                      lockedReason={needs && !t.approvedBy ? "Needs approval first" : undefined}
                      onChange={(enabled) =>
                        set((c) => ({ ...c, callTypes: c.callTypes.map((x) => (x.key === def.key ? { ...x, enabled } : x)) }))
                      }
                    />
                    <div className="min-w-48 flex-1">
                      <div className="text-sm font-medium">{def.label}</div>
                      {needs ? (
                        <ApprovalLine
                          by={t.approvedBy}
                          at={t.approvedAt}
                          canApprove={canApprove}
                          unsaved={unsaved}
                          busy={approving}
                          onApprove={() => onApprove("callType", def.key)}
                        />
                      ) : null}
                    </div>
                    <input
                      className={`${inputClass} sm:w-72`}
                      placeholder="Notes (optional)"
                      maxLength={2000}
                      value={t.notes ?? ""}
                      onChange={(e) =>
                        set((c) => ({
                          ...c,
                          callTypes: c.callTypes.map((x) => (x.key === def.key ? { ...x, notes: e.target.value } : x)),
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          </Section>
        ) : null}

        {tab === "maintenance" ? (
          <>
            {(
              [
                ["basic", "Basic questions", "Asked on every maintenance call."],
                ["electrical", "Electrical", "Only asked when it is safe; Sarah never tells them how to do anything."],
                ["water_leak", "Water leak", ""],
                ["broken_item", "Broken item", ""],
              ] as const
            ).map(([key, title, hint]) => (
              <Section key={key} title={title} hint={hint}>
                <ListEditor
                  items={local.maintenanceQuestions[key]}
                  addLabel="Add question"
                  onChange={(next) => set((c) => ({ ...c, maintenanceQuestions: { ...c.maintenanceQuestions, [key]: next } }))}
                />
              </Section>
            ))}
            <Section
              title="Tenant-responsibility items"
              hint="Light bulbs, blinds and the like. Until this wording is approved, Sarah says only that the team will follow up."
            >
              <ListEditor
                items={local.tenantResponsibility.items}
                addLabel="Add item"
                onChange={(items) =>
                  set((c) => ({ ...c, tenantResponsibility: { items, wording: c.tenantResponsibility.wording, approved: false } }))
                }
              />
              <Field label="Wording Sarah says">
                <textarea
                  className={`${inputClass} min-h-20`}
                  maxLength={2000}
                  value={local.tenantResponsibility.wording}
                  onChange={(e) =>
                    set((c) => ({
                      ...c,
                      tenantResponsibility: { items: c.tenantResponsibility.items, wording: e.target.value, approved: false },
                    }))
                  }
                />
              </Field>
              <ApprovalLine
                by={local.tenantResponsibility.approved ? local.tenantResponsibility.approvedBy : undefined}
                at={local.tenantResponsibility.approvedAt}
                canApprove={canApprove}
                unsaved={unsaved}
                busy={approving}
                onApprove={() => onApprove("tenantResponsibility", "tenant_responsibility")}
              />
              <p className="text-xs text-muted-foreground">
                Also switch on &quot;Maintenance: tenant-responsibility items&quot; under Call types.
              </p>
            </Section>
          </>
        ) : null}

        {tab === "severity" ? (
          <Section
            title="Severity levels"
            hint="Sarah picks one of these for each maintenance request. Pre-filled from the current rubric: needs Pat's approval before you rely on it."
          >
            <div className="space-y-4">
              {local.severityLevels.map((s) => {
                const upd = (patch: Partial<typeof s>) =>
                  set((c) => ({ ...c, severityLevels: c.severityLevels.map((x) => (x.level === s.level ? { ...x, ...patch } : x)) }));
                return (
                  <div key={s.level} className="space-y-2 rounded-xl border border-border p-3">
                    <div className="text-sm font-semibold">{LEVEL_LABEL[s.level]}</div>
                    <Field label="Definition">
                      <textarea className={`${inputClass} min-h-16`} maxLength={2000} value={s.definition} onChange={(e) => upd({ definition: e.target.value })} />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Examples">
                        <input className={inputClass} maxLength={2000} value={s.examples} onChange={(e) => upd({ examples: e.target.value })} />
                      </Field>
                      <Field label="Response target">
                        <input className={inputClass} maxLength={200} value={s.responseTarget} onChange={(e) => upd({ responseTarget: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        ) : null}

        {tab === "emergency" ? (
          <Section
            title="Emergency scripts"
            hint="Sarah reads an approved script word for word and gives phone numbers only from here. A script that is not approved (or while the Emergency call type is off) falls back to: leave the building and call 911, and the team is escalated. Editing an approved script removes its approval."
          >
            <div className="space-y-4">
              {local.emergencyScripts.map((s) => {
                const upd = (patch: Partial<typeof s>) =>
                  set((c) => ({
                    ...c,
                    emergencyScripts: c.emergencyScripts.map((x) =>
                      x.incident === s.incident
                        ? { incident: x.incident, wording: x.wording, phone: x.phone, ...patch, approvedBy: undefined, approvedAt: undefined }
                        : x,
                    ),
                  }));
                return (
                  <div key={s.incident} className="space-y-2 rounded-xl border border-border p-3">
                    <div className="text-sm font-semibold">{INCIDENT_LABEL[s.incident]}</div>
                    <Field label="Exact wording">
                      <textarea className={`${inputClass} min-h-16`} maxLength={2000} value={s.wording} onChange={(e) => upd({ wording: e.target.value })} />
                    </Field>
                    <Field
                      label="Phone number Sarah may give"
                      hint={s.incident === "gas_slight" ? "Leave empty unless every property shares one utility number." : "911 or a full number like 518-365-0996."}
                    >
                      <input
                        className={`${inputClass} sm:w-64`}
                        inputMode="tel"
                        value={s.phone ?? ""}
                        onChange={(e) => upd({ phone: e.target.value })}
                      />
                    </Field>
                    <ApprovalLine
                      by={s.approvedBy}
                      at={s.approvedAt}
                      canApprove={canApprove}
                      unsaved={unsaved}
                      busy={approving}
                      onApprove={() => onApprove("emergencyScript", s.incident)}
                    />
                  </div>
                );
              })}
            </div>
          </Section>
        ) : null}

        {tab === "escalation" ? (
          <Section
            title="Escalation contacts"
            hint="Told by text when a request is Emergency or Urgent, in addition to the assigned asset manager and the maintenance lead."
          >
            <div className="space-y-4">
              {(["emergency", "urgent"] as const).map((level) => {
                const e = local.escalationContacts.find((x) => x.level === level)!;
                const upd = (patch: Partial<typeof e>) =>
                  set((c) => ({ ...c, escalationContacts: c.escalationContacts.map((x) => (x.level === level ? { ...x, ...patch } : x)) }));
                return (
                  <div key={level} className="space-y-2 rounded-xl border border-border p-3">
                    <div className="text-sm font-semibold">{LEVEL_LABEL[level]}</div>
                    <div className="flex flex-wrap gap-2">
                      {data.members.map((m) => {
                        const on = e.userIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              upd({ userIds: on ? e.userIds.filter((id) => id !== m.id) : [...e.userIds, m.id] })
                            }
                            className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary/10" : "border-input"}`}
                          >
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                    <Field label="Outside phone numbers">
                      <ListEditor items={e.externalPhones} addLabel="Add number" placeholder="518-555-0100" onChange={(externalPhones) => upd({ externalPhones })} />
                    </Field>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                Routine and informational requests are not texted. Team members need a mobile number on their profile to receive texts.
              </p>
            </div>
          </Section>
        ) : null}

        {tab === "routing" ? (
          <Section
            title="Routing directory"
            hint="For the owner call routing menu. It cannot be switched on while any entry has no phone number, and Sarah only gives numbers listed here."
          >
            {(() => {
              const missing = local.routingDirectory.entries.some((e) => !e.phone.trim());
              return (
                <div className="flex items-center gap-3">
                  <Toggle
                    label="Routing directory enabled"
                    checked={local.routingDirectory.enabled}
                    lockedReason={missing ? "Add a phone number to every entry first" : undefined}
                    onChange={(enabled) => set((c) => ({ ...c, routingDirectory: { ...c.routingDirectory, enabled } }))}
                  />
                  <span className="text-sm">{local.routingDirectory.enabled ? "On" : "Off"}</span>
                </div>
              );
            })()}
            <div className="space-y-2">
              {local.routingDirectory.entries.map((e, i) => {
                const upd = (patch: Partial<typeof e>) =>
                  set((c) => ({
                    ...c,
                    routingDirectory: {
                      ...c.routingDirectory,
                      entries: c.routingDirectory.entries.map((x, k) => (k === i ? { ...x, ...patch } : x)),
                    },
                  }));
                const move = (d: number) =>
                  set((c) => {
                    const j = i + d;
                    const list = [...c.routingDirectory.entries];
                    if (j < 0 || j >= list.length) return c;
                    [list[i], list[j]] = [list[j], list[i]];
                    return { ...c, routingDirectory: { ...c.routingDirectory, entries: list } };
                  });
                return (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <input className={`${inputClass} w-44`} placeholder="Name" maxLength={100} value={e.label} onChange={(ev) => upd({ label: ev.target.value })} />
                    <input className={`${inputClass} w-40`} placeholder="Phone" inputMode="tel" value={e.phone} onChange={(ev) => upd({ phone: ev.target.value })} />
                    <input className={`${inputClass} w-44`} placeholder="Hours (optional)" maxLength={200} value={e.hours ?? ""} onChange={(ev) => upd({ hours: ev.target.value })} />
                    <button type="button" aria-label="Move up" className="rounded-lg p-2 hover:bg-accent disabled:opacity-30" disabled={i === 0} onClick={() => move(-1)}>
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Move down" className="rounded-lg p-2 hover:bg-accent disabled:opacity-30" disabled={i === local.routingDirectory.entries.length - 1} onClick={() => move(1)}>
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove"
                      className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                      onClick={() =>
                        set((c) => ({
                          ...c,
                          routingDirectory: { ...c.routingDirectory, entries: c.routingDirectory.entries.filter((_, k) => k !== i) },
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className={btnOutline}
                onClick={() =>
                  set((c) => ({
                    ...c,
                    routingDirectory: { ...c.routingDirectory, entries: [...c.routingDirectory.entries, { label: "", phone: "" }] },
                  }))
                }
              >
                <Plus className="h-4 w-4" /> Add person
              </button>
            </div>
          </Section>
        ) : null}

        {tab === "leasing" ? (
          <Section title="Tours and capture" hint="Used when Sarah offers and books tour times. Takes effect when you publish.">
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["tourMinutes", "Tour length (minutes)"],
                  ["bufferMinutes", "Buffer before and after (minutes)"],
                  ["slotStepMinutes", "Offered times every (15, 20, 30 or 60 minutes)"],
                  ["minLeadMinutes", "Minimum notice (minutes)"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    className={inputClass}
                    value={Number.isFinite(local.leasing[key]) ? local.leasing[key] : ""}
                    onChange={(e) => set((c) => ({ ...c, leasing: { ...c.leasing, [key]: e.target.value === "" ? NaN : Number(e.target.value) } }))}
                  />
                </Field>
              ))}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={local.leasing.captureOnly}
                onChange={(e) => set((c) => ({ ...c, leasing: { ...c.leasing, captureOnly: e.target.checked } }))}
              />
              <span>
                Capture only: Sarah records every answer and never tells a caller whether they qualify. The team reviews every inquiry.
              </span>
            </label>
          </Section>
        ) : null}

        {tab === "identity" ? (
          <Section title="Greeting and identity">
            <Field label="Company name Sarah says">
              <input
                className={inputClass}
                maxLength={100}
                value={local.identity.companyName}
                onChange={(e) => set((c) => ({ ...c, identity: { ...c.identity, companyName: e.target.value } }))}
              />
            </Field>
            <Field label="First message" hint="The first thing the caller hears.">
              <textarea
                className={`${inputClass} min-h-24`}
                maxLength={2000}
                value={local.identity.firstMessage}
                onChange={(e) => set((c) => ({ ...c, identity: { ...c.identity, firstMessage: e.target.value } }))}
              />
            </Field>
          </Section>
        ) : null}
      </fieldset>

      {/* The leasing screening questions save on their own, outside the draft/publish flow. */}
      {tab === "leasing" ? (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            The questions below save immediately and update Sarah on their own; they do not wait for Publish.
          </p>
          <BuiltInQuestions />
          <ScreeningQuestions />
        </div>
      ) : null}

      {tab === "identity" ? (
        <Section title="Version history" hint="Every publish is kept. Rolling back publishes that older setup again as a new version.">
          {data.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing published yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.versions.map((ver) => (
                <li key={ver.version} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <strong>Version {ver.version}</strong>
                    {ver.version === data.version ? " (live)" : ""} · {when(ver.publishedAt)} · {ver.publishedBy}
                    {ver.note ? ` · ${ver.note}` : ""}
                  </span>
                  {canEdit && ver.version !== data.version ? (
                    <button className={btnOutline} disabled={busy !== null || unsaved} title={unsaved ? "Save or discard your edits first" : undefined} onClick={() => setConfirmRollback(ver.version)}>
                      Roll back
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <div className="fixed inset-x-0 bottom-[4.25rem] z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <span className="mr-auto text-sm text-muted-foreground">
            {unsaved ? "Unsaved changes" : data.dirty ? "Draft saved, not published" : "Draft matches what is live"}
          </span>
          <button className={btnOutline} disabled={!canEdit || !unsaved || busy !== null} onClick={onSave}>
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button
            className={btnOutline}
            disabled={unsaved || busy !== null}
            title={unsaved ? "Save the draft first" : undefined}
            onClick={onPreview}
          >
            {busy === "preview" ? "Building…" : "Preview prompt"}
          </button>
          <button
            className={btnPrimary}
            disabled={!canEdit || unsaved || busy !== null}
            title={unsaved ? "Save the draft first" : !canEdit ? "You do not have permission to publish" : undefined}
            onClick={() => setConfirmPublish(true)}
          >
            Publish
          </button>
        </div>
      </div>

      {previewText !== null ? (
        <Modal title="Prompt preview (from the saved draft)" onClose={() => setPreviewText(null)}>
          <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs leading-5">{previewText}</pre>
        </Modal>
      ) : null}

      {confirmPublish ? (
        <Modal title="Publish to Sarah?" onClose={() => setConfirmPublish(false)}>
          <p className="text-sm">This changes what Sarah says on live calls.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnOutline} onClick={() => setConfirmPublish(false)} disabled={busy === "publish"}>
              Cancel
            </button>
            <button className={btnPrimary} onClick={onPublish} disabled={busy === "publish"}>
              {busy === "publish" ? "Publishing…" : "Publish"}
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmRollback !== null ? (
        <Modal title={`Roll back to version ${confirmRollback}?`} onClose={() => setConfirmRollback(null)}>
          <p className="text-sm">This changes what Sarah says on live calls, and replaces your current draft.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnOutline} onClick={() => setConfirmRollback(null)} disabled={busy === "rollback"}>
              Cancel
            </button>
            <button className={btnDanger} onClick={() => onRollback(confirmRollback)} disabled={busy === "rollback"}>
              {busy === "rollback" ? "Rolling back…" : "Roll back"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default function SarahPage() {
  return (
    <RequireView views={["admin"]}>
      <SarahPageInner />
    </RequireView>
  );
}
