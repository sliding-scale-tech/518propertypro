"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import {
  CALL_TYPES,
  defaultBehavior,
  FLOW_DEFS,
  FLOW_KEYS,
  flowOf,
  flowsOf,
  isApprovalRequired,
  isFlowKey,
  tenantMessagesOf,
  type FlowKey,
  type MissingItem,
  type TenantMessageKey,
} from "@/convex/sarahConfigLib";
import type { SarahConfig } from "@/convex/sarahConfigLib";
import { RequireView } from "@/components/require-view";
import { BuiltInQuestions, ScreeningQuestions } from "@/components/screening-questions";
import { Modal, btnDanger, btnOutline, btnPrimary, formatWhen, inputClass } from "@/components/maintenance/shared";
import { Btn, Card, CardHead, ConfirmDialog, Field, PageHeader, Pill, Seg } from "@/components/ui";
import { errorMessage, useToast } from "@/components/toast";
import { ItemModal } from "@/components/sarah/item-modal";
import { PilotPanel } from "@/components/sarah/pilot-panel";
import { SarahPushStatus } from "@/components/sarah/push-status";
import { QuestionFlowEditor } from "@/components/sarah/question-flow";
import { routingDraftProblems, toRoutingDraft } from "@/components/sarah/routing-editor";
import {
  PHONE_ROUTING_HREF,
  initialSarahView,
  isBasicTab,
  readStoredAdvanced,
  storeAdvanced,
  visibleSarahTabs,
  type SarahTabId,
} from "@/components/sarah/sarah-tabs";

/**
 * Sarah configuration (build plan P17). One Save (B43): an admin's save goes live for new calls on its
 * own (new version + automatic push; the status line under Save shows how it went). There is no Publish
 * step. The server enforces every rule the buttons show (who may edit, phone formats). Admins have full
 * power: switching a call type on or saving an edit approves the wording in the same step (audited).
 * Only a non-admin view keeps the approval gates: their edit goes live when an admin approves it.
 * Version history, the setup checklist and "Approve all drafts" are behind the Advanced switch.
 */

// The tabs and the default "basic" set (BASIC_TABS) live in components/sarah/sarah-tabs.ts. Phone line and
// Routing directory are on the Team page (/team?tab=phone).
type TabId = SarahTabId;

const INCIDENT_LABEL: Record<SarahConfig["emergencyScripts"][number]["incident"], string> = {
  fire: "Fire or smoke",
  flooding: "Flooding",
  gas_hissing: "Gas smell with hissing",
  gas_slight: "Slight gas smell, no hissing",
  other: "Anything else life-threatening",
};

const TENANT_MESSAGE_FIELDS: ReadonlyArray<{ key: TenantMessageKey; label: string; hint: string }> = [
  {
    key: "photoRequest",
    label: "Photo request",
    hint: "Sent when the team asks for photos. The secure upload link is added after this text.",
  },
  { key: "outOfScope", label: "Out-of-scope notice", hint: "Sent when a request is closed and the team chooses to notify the tenant." },
  { key: "received", label: "Received confirmation", hint: "Sent to confirm we received the maintenance request." },
];

const AREA_TAB: Record<MissingItem["area"], TabId | "routing"> = {
  "call-types": "call-types",
  maintenance: "maintenance",
  emergency: "emergency",
  escalation: "escalation",
  routing: "routing",
  "other-calls": "other-calls",
  "tenant-messages": "tenant-messages",
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
    <Card className="space-y-3">
      <CardHead title={title} hint={hint} />
      {children}
    </Card>
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
        checked ? "bg-primary" : "bg-border-strong"
      }`}
    >
      <span
        className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
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
  onApprove,
  busy,
}: {
  by?: string;
  at?: number;
  canApprove: boolean;
  onApprove: () => void;
  busy: boolean;
}) {
  if (by) {
    return (
      <Pill tone="ok">
        <CheckCircle2 className="h-3.5 w-3.5" /> Approved by {by}
        {at ? ` on ${new Date(at).toLocaleDateString()}` : ""}
      </Pill>
    );
  }
  if (!canApprove) return <span className="text-xs text-muted-foreground">Waiting for an admin to approve</span>;
  return (
    <Btn sm variant="ok" disabled={busy} onClick={onApprove}>
      Approve
    </Btn>
  );
}

// --- Page --------------------------------------------------------------------------------------

function SarahPageInner() {
  const data = useQuery(api.sarahConfig.get);
  const saveDraft = useMutation(api.sarahConfig.saveDraft);
  const approve = useMutation(api.sarahConfig.approve);
  const approveAllDrafts = useMutation(api.sarahConfig.approveAllDrafts);
  const previewAction = useAction(api.sarahConfig.preview);
  const rollbackMutation = useMutation(api.sarahConfig.rollback);
  const regenerateKb = useAction(api.sarahKb.regenerateNow);
  const toast = useToast();
  const router = useRouter();

  // ?tab=leasing deep link (the old /screening redirects here). Read from window, like the
  // calendar page does, to avoid a Suspense boundary around the whole page. A deep link to a hidden
  // tab switches Advanced on; an old ?tab=routing / ?tab=phone-line goes to the Team page.
  const [initial] = useState(() =>
    typeof window === "undefined"
      ? { tab: "emergency" as TabId, advanced: false, redirectTo: null as string | null }
      : initialSarahView(new URLSearchParams(window.location.search).get("tab"), readStoredAdvanced()),
  );
  const [tab, setTab] = useState<TabId>(initial.tab);
  // "Advanced (Simplr only)": shows every tab, not just BASIC_TABS. Remembered per browser.
  const [advanced, setAdvanced] = useState(initial.advanced);
  const goToTab = (next: TabId) => {
    if (!isBasicTab(next)) setAdvanced(true);
    setTab(next);
  };
  const toggleAdvanced = (on: boolean) => {
    setAdvanced(on);
    storeAdvanced(on);
    if (!on && !isBasicTab(tab)) setTab(visibleSarahTabs(false)[0].id);
  };
  useEffect(() => {
    if (initial.redirectTo) router.replace(initial.redirectTo);
  }, [initial.redirectTo, router]);
  // null = no local edits: the page shows the server's draft directly.
  const [edits, setEdits] = useState<SarahConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState<number | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [confirmApproveAll, setConfirmApproveAll] = useState(false);

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
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const onSave = () =>
    run("save", async () => {
      if (Object.values(local.leasing).some((x) => typeof x === "number" && !Number.isFinite(x))) {
        toast("Fill in every number on the Leasing tab.", "error");
        return;
      }
      // Same rules as the server; the field itself is marked on the Team page's Phone & routing tab.
      const routingProblem = routingDraftProblems(toRoutingDraft(local.routingDirectory), data.ownLine)[0];
      if (routingProblem) {
        toast(`${routingProblem.message} Fix it on the Team page, Phone & routing tab.`, "error");
        router.push(PHONE_ROUTING_HREF);
        return;
      }
      // JSON round-trip drops undefined fields, which Convex arguments do not accept.
      const clean: SarahConfig = JSON.parse(JSON.stringify(local));
      await saveDraft({ config: clean });
      // Not unsaved any more; the server's copy (approvals may have been stripped) syncs in.
      setEdits(null);
      toast("Saved. Sarah updates for new calls in a few seconds.", "success");
    });

  const onApprove = (kind: "callType" | "emergencyScript" | "tenantResponsibility" | "tenantMessage" | "flow", key: string) =>
    run("approve", async () => {
      await approve({ kind, key });
      toast("Approved. Sarah updates for new calls in a few seconds.", "success");
    });

  const onApproveAll = () =>
    run("approveAll", async () => {
      const r = await approveAllDrafts({});
      setConfirmApproveAll(false);
      toast(r.approved > 0 ? `Approved ${r.approved} draft${r.approved === 1 ? "" : "s"}. Sarah updates for new calls in a few seconds.` : "Nothing to approve. Everything is already approved.", "success");
    });

  const onRegenerateKb = () =>
    run("kb", async () => {
      const r = await regenerateKb({});
      toast(r.changed ? "Policy document rebuilt from the published setup. It will be indexed shortly." : "Policy document is already up to date.", "success");
    });

  const onPreview = () =>
    run("preview", async () => {
      setPreviewText(await previewAction({}));
    });

  const onRollback = (version: number) =>
    run("rollback", async () => {
      const { version: v } = await rollbackMutation({ version });
      setConfirmRollback(null);
      setEdits(null);
      toast(`Rolled back. Live as version ${v}; Sarah updates for new calls in a few seconds.`, "success");
    });

  const canEdit = data.canEdit;
  const canApprove = data.canApprove;
  const approving = busy === "approve";

  return (
    <div className="space-y-5 pb-44 lg:pb-28">
      <PageHeader
        title="Sarah config"
        subtitle={
          <>
            Change what Sarah asks and says without a developer. Saving updates Sarah for new calls within a few
            seconds; a call already in progress keeps its setup.{" "}
            {data.version > 0
              ? `Live: version ${data.version}, saved ${when(data.publishedAt ?? undefined)}.`
              : "Nothing has been saved from here yet, so Sarah is still running her built-in setup."}
            {!canEdit ? " You can view this page but not change it." : ""}
            <span className="mt-1 block">
              Texting: texts are sent only for emergencies, to admins. Technician texts are coming later.
            </span>
          </>
        }
      />

      {advanced ? <PilotPanel items={data.items} progress={data.progress} onOpen={setOpenItem} /> : null}

      {/* With Save going live, this only matters for edits still waiting for an admin's approval. */}
      {advanced && canApprove ? (
        <div className="flex justify-end">
          <button className={btnOutline} disabled={busy !== null} onClick={() => setConfirmApproveAll(true)}>
            Approve all drafts
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-full overflow-x-auto pb-1">
          <Seg label="Sarah config sections" value={tab} onChange={setTab} options={visibleSarahTabs(advanced).map((t) => ({ value: t.id, label: t.label }))} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Toggle checked={advanced} onChange={toggleAdvanced} label="Advanced (Simplr only)" />
          Advanced (Simplr only)
        </label>
      </div>
      <p className="text-[13px] text-muted-foreground">
        The phone line and the routing directory are on the{" "}
        <Link href={PHONE_ROUTING_HREF} className="font-medium text-primary hover:underline">
          Team page, Phone &amp; routing tab
        </Link>
        .
      </p>

      {/* Disabled for anyone who cannot edit: the server rejects their writes anyway. */}
      <fieldset disabled={!canEdit || busy === "save"} className="space-y-4 border-0 p-0">
        {tab === "call-types" ? (
          <Section
            title="Which calls Sarah handles"
            hint="Anything switched off is not discussed: Sarah takes a name and number and logs it for staff. Switch any call type on or off. Turning one on approves its current wording."
          >
            <div className="divide-y divide-border">
              {CALL_TYPES.map((def) => {
                const t = local.callTypes.find((x) => x.key === def.key)!;
                const needs = isApprovalRequired(def.key);
                const flowKey = isFlowKey(def.key) ? def.key : null;
                const flow = flowKey ? flowOf(local, flowKey) : null;
                const flowLocked = flow !== null && !flow.approved && !canApprove;
                return (
                  <div key={def.key} className="flex flex-wrap items-center gap-3 py-3">
                    <Toggle
                      label={def.label}
                      checked={t.enabled}
                      lockedReason={
                        needs && !t.approvedBy && !canApprove
                          ? "An admin must approve this first"
                          : flowLocked
                            ? "An admin must approve the wording first"
                            : undefined
                      }
                      onChange={(enabled) =>
                        set((c) => ({ ...c, callTypes: c.callTypes.map((x) => (x.key === def.key ? { ...x, enabled } : x)) }))
                      }
                    />
                    <div className="min-w-48 flex-1">
                      <div className="text-sm font-medium">{def.label}</div>
                      {needs && (t.approvedBy || !canApprove) ? (
                        <ApprovalLine
                          by={t.approvedBy}
                          at={t.approvedAt}
                          canApprove={canApprove}
                          busy={approving}
                          onApprove={() => onApprove("callType", def.key)}
                        />
                      ) : null}
                      {flowLocked ? (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline"
                          onClick={() => goToTab("other-calls")}
                        >
                          Wording waiting for an admin to approve
                        </button>
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
            <Section
              title="Maintenance question flow"
              hint="The questions Sarah asks on a maintenance call, in order, with follow-ups that only appear when they apply. Saving updates Sarah. Reword freely: nothing here needs approval."
            >
              <QuestionFlowEditor
                group="maintenance"
                flows={flowsOf(local)}
                onChange={(questionFlows) => set((c) => ({ ...c, questionFlows }))}
              />
            </Section>
            <Section
              title="Tenant-responsibility items"
              hint="Light bulbs, blinds and the like. Saving as an admin approves the wording."
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
                busy={approving}
                onApprove={() => onApprove("tenantResponsibility", "tenant_responsibility")}
              />
              <p className="text-xs text-muted-foreground">
                Also switch on &quot;Maintenance: tenant-responsibility items&quot; under Call types.
              </p>
            </Section>
          </>
        ) : null}

        {tab === "other-calls" ? (
          <Section
            title="Other call types"
            hint="Sarah uses only these facts, in her own short sentences. Switching a call type on, or saving an edit, approves the wording as it stands."
          >
            <div className="space-y-4">
              {FLOW_DEFS.map((def) => {
                const flow = flowOf(local, def.key);
                const t = local.callTypes.find((x) => x.key === def.key);
                const setWording = (wording: string) =>
                  set((c) => ({
                    ...c,
                    flows: FLOW_KEYS.map((k: FlowKey) => (k === def.key ? { key: k, wording, approved: false } : flowOf(c, k))),
                    callTypes: canApprove ? c.callTypes : c.callTypes.map((x) => (x.key === def.key ? { ...x, enabled: false } : x)),
                  }));
                return (
                  <div key={def.key} className="space-y-2 rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Toggle
                        label={`${def.label} enabled`}
                        checked={!!t?.enabled}
                        lockedReason={flow.approved || canApprove ? undefined : "An admin must approve the wording first"}
                        onChange={(enabled) =>
                          set((c) => ({ ...c, callTypes: c.callTypes.map((x) => (x.key === def.key ? { ...x, enabled } : x)) }))
                        }
                      />
                      <div className="min-w-48 flex-1">
                        <div className="text-sm font-semibold">{def.label}</div>
                        <div className="text-xs text-muted-foreground">Sarah Configuration section {def.section}</div>
                      </div>
                      <ApprovalLine
                        by={flow.approved ? flow.approvedBy : undefined}
                        at={flow.approvedAt}
                        canApprove={canApprove}
                        busy={approving}
                        onApprove={() => onApprove("flow", def.key)}
                      />
                    </div>
                    <Field label="Approved wording">
                      <textarea
                        className={`${inputClass} min-h-24`}
                        maxLength={2000}
                        value={flow.wording}
                        onChange={(e) => setWording(e.target.value)}
                      />
                    </Field>
                    {!canApprove ? <p className="text-xs text-amber-700 dark:text-amber-400">Needs Pat: {def.confirm}</p> : null}
                  </div>
                );
              })}
            </div>
          </Section>
        ) : null}

        {tab === "severity" ? (
          <Section
            title="Severity levels"
            hint="Sarah picks one of these for each maintenance request. Pre-filled from the current rubric. Saving as an admin approves your edit."
          >
            <p className="rounded-xl bg-accent px-3 py-2 text-[12.5px] text-accent-foreground">
              Sarah also gives each request a 1–10 severity score using these levels. The named level stays the
              source of truth; the score only shows as the &quot;n/10&quot; chip.
            </p>
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
            hint="Sarah reads an approved script word for word and gives phone numbers only from here. Saving as an admin approves your edit. While the Emergency call type is off, she says: leave the area and call 911."
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
                      busy={approving}
                      onApprove={() => onApprove("emergencyScript", s.incident)}
                    />
                    {!s.approvedBy && !canApprove ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Until an admin approves it, Sarah says only &quot;leave the area and call 911&quot;.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Section>
        ) : null}

        {tab === "escalation" ? (
          <Section
            title="Escalation contacts"
            hint="Texted when a request is Emergency, in addition to all admins. Urgent requests are not texted for now."
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

        {tab === "leasing" ? (
          <Section
            title="Leasing question flow"
            hint="What Sarah asks a renter, in order, and the tour request. Optional questions come after the required ones. Which core questions are switched on for a property is set further down and saves on its own."
          >
            <QuestionFlowEditor
              group="leasing"
              flows={flowsOf(local)}
              onChange={(questionFlows) => set((c) => ({ ...c, questionFlows }))}
            />
          </Section>
        ) : null}

        {tab === "leasing" ? (
          <Section title="Tours and capture" hint="Used when Sarah offers and books tour times. Takes effect on new calls after you save.">
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

        {tab === "tenant-messages" ? (
          <Section
            title="Tenant messages"
            hint="Wording for texts to a tenant about their maintenance request. Saving as an admin approves your edit."
          >
            <p className="rounded-xl border border-border bg-muted px-3 py-2 text-sm">
              Texts to tenants are off for now. Nothing here is sent, even when approved.
            </p>
            <div className="space-y-4">
              {TENANT_MESSAGE_FIELDS.map(({ key, label, hint }) => {
                const m = tenantMessagesOf(local)[key];
                return (
                  <div key={key} className="space-y-2 rounded-2xl border border-border p-3">
                    <div className="text-sm font-semibold">{label}</div>
                    <Field label="Wording" hint={hint}>
                      <textarea
                        className={`${inputClass} min-h-20`}
                        maxLength={600}
                        value={m.wording}
                        onChange={(e) =>
                          set((c) => ({
                            ...c,
                            tenantMessages: {
                              ...tenantMessagesOf(c),
                              [key]: { wording: e.target.value, approved: false },
                            },
                          }))
                        }
                      />
                    </Field>
                    <ApprovalLine
                      by={m.approved ? m.approvedBy : undefined}
                      at={m.approvedAt}
                      canApprove={canApprove}
                      busy={approving}
                      onApprove={() => onApprove("tenantMessage", key)}
                    />
                  </div>
                );
              })}
            </div>
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
            <Field label="When information is missing" hint="What Sarah does if the caller cannot or will not give something.">
              <textarea
                className={`${inputClass} min-h-16`}
                maxLength={2000}
                value={(local.behavior ?? defaultBehavior()).missingInfo}
                onChange={(e) =>
                  set((c) => ({ ...c, behavior: { ...(c.behavior ?? defaultBehavior()), missingInfo: e.target.value } }))
                }
              />
            </Field>
            <Field label="When a lookup fails" hint="What Sarah does if a tool errors or finds nothing.">
              <textarea
                className={`${inputClass} min-h-16`}
                maxLength={2000}
                value={(local.behavior ?? defaultBehavior()).lookupFailure}
                onChange={(e) =>
                  set((c) => ({ ...c, behavior: { ...(c.behavior ?? defaultBehavior()), lookupFailure: e.target.value } }))
                }
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

      {/* The leasing screening questions save on their own, separately from the Save button. */}
      {tab === "leasing" ? (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            The questions below save immediately and update Sarah on their own; they do not wait for the Save button.
          </p>
          <BuiltInQuestions />
          <ScreeningQuestions />
        </div>
      ) : null}

      {tab === "identity" ? (
        <Section
          title="Knowledge base: policies document"
          hint="The document Sarah can search for policy facts. It is rebuilt automatically after every save that updates Sarah, from approved, switched-on wording only. Use this to rebuild it from the live setup."
        >
          <div>
            <button className={btnOutline} disabled={!canEdit || busy !== null} onClick={onRegenerateKb}>
              {busy === "kb" ? "Rebuilding…" : "Rebuild policies document"}
            </button>
          </div>
        </Section>
      ) : null}

      {/* Behind Advanced: every save that changes Sarah is a version; rolling back also updates Sarah. */}
      {advanced && tab === "identity" ? (
        <Section title="Version history" hint="Every save that changes Sarah is kept. Rolling back makes that older setup live again as a new version and updates Sarah.">
          {data.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing saved yet.</p>
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
            {unsaved ? "Unsaved changes" : <SarahPushStatus />}
          </span>
          <button
            className={btnOutline}
            disabled={unsaved || busy !== null}
            title={unsaved ? "Save first" : undefined}
            onClick={onPreview}
          >
            {busy === "preview" ? "Building…" : "Preview prompt"}
          </button>
          <button
            className={btnPrimary}
            disabled={!canEdit || !unsaved || busy !== null}
            title={!canEdit ? "You do not have permission to change Sarah" : undefined}
            onClick={onSave}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {openItem !== null ? (
        <ItemModal
          key={openItem}
          itemId={openItem}
          onClose={() => setOpenItem(null)}
          onGoToTab={(area) => {
            const target = AREA_TAB[area];
            if (target === "routing") router.push(PHONE_ROUTING_HREF);
            else goToTab(target);
          }}
          onOpenItem={setOpenItem}
        />
      ) : null}

      <ConfirmDialog
        open={confirmApproveAll}
        title="Approve all drafts?"
        message="This approves the emergency scripts, severity levels, tenant-responsibility wording and the resident call-type wording as they stand, and updates Sarah with them. Nothing is switched on."
        confirmLabel="Approve all"
        busy={busy === "approveAll"}
        onCancel={() => setConfirmApproveAll(false)}
        onConfirm={onApproveAll}
      />

      {previewText !== null ? (
        <Modal title="Prompt preview (from the saved setup)" onClose={() => setPreviewText(null)}>
          <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs leading-5">{previewText}</pre>
        </Modal>
      ) : null}

      {confirmRollback !== null ? (
        <Modal title={`Roll back to version ${confirmRollback}?`} onClose={() => setConfirmRollback(null)}>
          <p className="text-sm">This makes that older setup live again for new calls, and replaces the current setup here.</p>
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
