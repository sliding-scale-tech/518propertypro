"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  Clock3,
  Filter,
  Globe2,
  Loader2,
  MoreVertical,
  Phone,
  PhoneCall,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dropdown } from "@/components/ui/dropdown";
import { RequireView } from "@/components/require-view";
import { ConversationTranscript } from "@/components/transcript";
import { Btn, Card, CardHead, Kpi, KpiRow, PageHeader, Pill, type Tone } from "@/components/ui";

function formatDuration(seconds?: number) {
  if (seconds === undefined) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const INTENT_LABELS: Record<string, string> = {
  leasing: "Leasing",
  maintenance: "Maintenance",
  escalation: "Escalation",
  unclear: "Unclear",
};

const INTENT_FILTER_OPTIONS = Object.entries(INTENT_LABELS).filter(
  ([value]) => value !== "maintenance",
);

const INTENT_DROPDOWN_OPTIONS = [
  { value: "all", label: "All intents" },
  ...INTENT_FILTER_OPTIONS.map(([value, label]) => ({ value, label })),
];

const OUTCOME_TONES: Record<string, Tone> = {
  tour_booked: "ok",
  disqualified: "warn",
  escalated: "bad",
  logged_only: "acc",
};

const OUTCOME_LABELS: Record<string, string> = {
  tour_booked: "Tour booked",
  disqualified: "Review needed",
  escalated: "Escalated",
  logged_only: "Logged only",
};

const OUTCOME_DROPDOWN_OPTIONS = [
  { value: "all", label: "All outcomes" },
  ...Object.entries(OUTCOME_LABELS).map(([value, label]) => ({ value, label })),
];

type CallRow = {
  _id: Id<"conversations">;
  startedAt: number;
  channel: "browser" | "phone";
  callerNumber?: string;
  intent?: string;
  outcome?: string;
  escalatedTo?: string;
  summary?: string;
  durationSec?: number;
  status: string;
  messageCount: number;
  leadScore: number;
};

type Qualification = {
  bedrooms?: string;
  moveInDate?: string;
  budget?: number;
  petsWanted?: boolean;
  petType?: string;
  callerName?: string;
  callerPhone?: string;
  qualifies?: boolean;
  disqualifyReason?: string;
  nearMiss?: boolean;
  tourSlot?: string;
  ownerProspect?: {
    name?: string;
    phone?: string;
    email?: string;
    propertyAddress?: string;
    propertyDetails?: string;
    notes?: string;
  };
  screeningAnswers?: Array<{
    key: string;
    question: string;
    value: string | number | boolean;
  }>;
} | null;

function LeadsPageInner() {
  // TODO(★ leads scoping): all AMs currently see all leads; revisit.
  const {
    results: history,
    status: historyStatus,
    loadMore,
  } = usePaginatedQuery(api.conversations.history, {}, { initialNumItems: 15 });
  const usage = useQuery(api.conversations.usage);
  const funnel = useQuery(api.conversations.funnel);
  const [selected, setSelected] = useState<Id<"conversations"> | null>(null);
  const [intentFilter, setIntentFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [ownerOnly, setOwnerOnly] = useState(false);

  const filtered = useMemo(() => {
    if (!history) return history;
    const term = search.trim().toLowerCase();
    return history.filter((call) => {
      if (intentFilter !== "all" && call.intent !== intentFilter) return false;
      if (outcomeFilter !== "all" && call.outcome !== outcomeFilter) return false;
      if (!term) return true;
      return [
        call.callerNumber,
        call.channel,
        call.intent && INTENT_LABELS[call.intent],
        call.outcome && OUTCOME_LABELS[call.outcome],
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term));
    });
  }, [history, intentFilter, outcomeFilter, search]);

  return (
    <div className="space-y-5 pb-10">
      <PageHeader title="Leads" subtitle="Every Lead, with its full transcript." />

      {usage ? (
        <KpiRow>
          <Kpi icon={<PhoneCall />} label="Leads this month" value={String(usage.callCount)} sub="Current month" />
          <Kpi
            icon={<Clock3 />}
            label="Avg lead duration"
            value={formatDuration(usage.avgDurationSec)}
            sub="Current month"
          />
        </KpiRow>
      ) : null}

      {funnel ? <FunnelChart funnel={funnel} /> : null}

      <section className="overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex flex-wrap gap-3">
            <Dropdown
              value={intentFilter}
              onChange={setIntentFilter}
              options={INTENT_DROPDOWN_OPTIONS}
              buttonClassName="h-10 min-w-32"
            />
            <button
              type="button"
              onClick={() => setOwnerOnly((v) => !v)}
              aria-pressed={ownerOnly}
              className={`h-10 rounded-xl border px-3 text-[13px] ${
                ownerOnly
                  ? "border-violet bg-violet-soft text-violet"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              Owner prospects
            </button>
            <Dropdown
              value={outcomeFilter}
              onChange={setOutcomeFilter}
              options={OUTCOME_DROPDOWN_OPTIONS}
              buttonClassName="h-10 min-w-36"
            />
          </div>
          <div className="flex gap-2">
            <label className="relative block min-w-0 flex-1 sm:w-60">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search calls..."
                className="h-10 w-full rounded-xl border border-input bg-card pr-3 pl-9 text-[13.5px] outline-none placeholder:text-faint focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </label>
            <button
              type="button"
              aria-label="More filters"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>

        {filtered?.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No calls match this filter.
          </div>
        ) : null}

        <div className="space-y-3 p-4 sm:hidden">
          {filtered?.map((call, index) => (
            <CallCard
              key={call._id}
              call={call}
              index={index}
              expanded={selected === call._id}
              onToggle={() => setSelected(selected === call._id ? null : call._id)}
              ownerOnly={ownerOnly}
            />
          ))}
        </div>

        <div className="hidden sm:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                <th className="w-10 px-5 py-3 font-medium" />
                <th className="px-2 py-3 font-medium">Timestamp</th>
                <th className="px-3 py-3 font-medium">Channel</th>
                <th className="px-3 py-3 font-medium">Caller</th>
                <th className="px-3 py-3 font-medium">Outcome</th>
                <th className="px-3 py-3 font-medium">Duration</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered?.map((call, index) => (
                <CallTableRow
                  key={call._id}
                  call={call}
                  index={index}
                  expanded={selected === call._id}
                  onToggle={() => setSelected(selected === call._id ? null : call._id)}
                  ownerOnly={ownerOnly}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {historyStatus !== "Exhausted" ? (
        <div className="flex justify-center">
          <Btn onClick={() => loadMore(15)} disabled={historyStatus !== "CanLoadMore"}>
            {historyStatus === "LoadingMore" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronsDown className="h-3.5 w-3.5" />
            )}
            {historyStatus === "LoadingMore" ? "Loading…" : "Show more"}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

function FunnelChart({
  funnel,
}: {
  funnel: { callsAnswered: number; leadsQualified: number; toursBooked: number };
}) {
  const max = Math.max(funnel.callsAnswered, 1);
  const leadsPercent = Math.round((funnel.leadsQualified / max) * 100);
  const toursPercent = Math.round((funnel.toursBooked / max) * 100);

  return (
    <Card>
      <CardHead title="Conversion funnel" icon={<Filter />} />
      <div className="grid gap-7 md:grid-cols-[140px_1fr_1fr] md:items-end">
        <div>
          <p className="text-3xl font-semibold tabular-nums">
            {String(funnel.callsAnswered).padStart(2, "0")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Leads</p>
        </div>
        <FunnelStep
          value={funnel.leadsQualified}
          label="Matches criteria"
          percent={leadsPercent}
          color="bg-primary"
        />
        <FunnelStep
          value={funnel.toursBooked}
          label="Tours booked"
          percent={toursPercent}
          color="bg-success-ink"
        />
      </div>
    </Card>
  );
}

function FunnelStep({
  value,
  label,
  percent,
  color,
}: {
  value: number;
  label: string;
  percent: number;
  color: string;
}) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(percent, value > 0 ? 4 : 0)}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className={`h-full rounded-full ${color}`}
          />
        </div>
        <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
          {percent}%
        </span>
      </div>
    </div>
  );
}

function OutcomeBadge({
  call,
  qualification,
}: {
  call: CallRow;
  qualification?: Qualification;
}) {
  const owner = qualification?.ownerProspect ? <Pill tone="vio">Owner prospect → Alex</Pill> : null;
  // Capture only: the pill reports whether the answers match the criteria, never a verdict on the lead.
  const match =
    qualification?.qualifies === true ? (
      <Pill tone="ok">Matches criteria</Pill>
    ) : qualification?.qualifies === false && call.outcome !== "disqualified" ? (
      <Pill tone="warn">Review needed</Pill>
    ) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <OutcomeBase call={call} />
      {match}
      {owner}
    </span>
  );
}

function OutcomeBase({ call }: { call: CallRow }) {
  if (call.outcome) {
    return <Pill tone={OUTCOME_TONES[call.outcome] ?? "neutral"}>{OUTCOME_LABELS[call.outcome] ?? call.outcome}</Pill>;
  }
  if (call.status === "active") {
    return (
      <Pill tone="ok" dot>
        Live
      </Pill>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function CallTableRow({
  call,
  index,
  expanded,
  onToggle,
  ownerOnly,
}: {
  call: CallRow;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  ownerOnly: boolean;
}) {
  const qualification = useQuery(api.qualifications.forConversation, { conversationId: call._id }) as
    | Qualification
    | undefined;
  if (ownerOnly && !qualification?.ownerProspect) return null;
  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: Math.min(index, 8) * 0.03 }}
        onClick={onToggle}
        className="cursor-pointer border-b border-border last:border-0 hover:bg-muted"
      >
        <td className="px-5 py-3.5">
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            className="block text-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </motion.span>
        </td>
        <td className="px-2 py-3.5 font-medium">{new Date(call.startedAt).toLocaleString()}</td>
        <td className="px-3 py-3.5">
          <span className="inline-flex items-center gap-2 capitalize text-muted-foreground">
            {call.channel === "phone" ? (
              <Phone className="h-3.5 w-3.5" />
            ) : (
              <Globe2 className="h-3.5 w-3.5" />
            )}
            {call.channel}
          </span>
        </td>
        <td className="px-3 py-3.5">{call.callerNumber ?? "—"}</td>
        <td className="px-3 py-3.5">
          <OutcomeBadge call={call} qualification={qualification} />
        </td>
        <td className="px-3 py-3.5 tabular-nums">{formatDuration(call.durationSec)}</td>
        <td className="px-3 py-3.5 text-muted-foreground">
          <MoreVertical className="h-4 w-4" />
        </td>
      </motion.tr>
      <AnimatePresence initial={false}>
        {expanded ? (
          <tr>
            <td colSpan={7} className="border-b border-border bg-muted p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-5">
                  <ExpandedDetail
                    conversationId={call._id}
                    qualification={qualification}
                    summary={call.summary}
                  />
                </div>
              </motion.div>
            </td>
          </tr>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function CallCard({
  call,
  index,
  expanded,
  onToggle,
  ownerOnly,
}: {
  call: CallRow;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  ownerOnly: boolean;
}) {
  const qualification = useQuery(api.qualifications.forConversation, { conversationId: call._id }) as
    | Qualification
    | undefined;
  if (ownerOnly && !qualification?.ownerProspect) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{new Date(call.startedAt).toLocaleString()}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm font-medium">{call.callerNumber ?? "Browser call"}</span>
            <OutcomeBadge call={call} qualification={qualification} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {formatDuration(call.durationSec)}
          <motion.span animate={{ rotate: expanded ? 180 : 0 }}>
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border"
          >
            <div className="p-4">
              <ExpandedDetail
                conversationId={call._id}
                qualification={qualification}
                summary={call.summary}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function ExpandedDetail({
  conversationId,
  qualification,
  summary,
}: {
  conversationId: Id<"conversations">;
  qualification?: Qualification;
  summary?: string;
}) {
  return (
    <div className="space-y-4">
      {summary ? <p className="text-sm italic text-muted-foreground">{summary}</p> : null}
      {qualification ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
          <Field label="Bedrooms" value={qualification.bedrooms} />
          <Field label="Move-in" value={qualification.moveInDate} />
          <Field label="Budget" value={qualification.budget ? `$${qualification.budget}` : undefined} />
          <Field
            label="Pets"
            value={
              qualification.petsWanted === undefined
                ? undefined
                : qualification.petsWanted
                  ? qualification.petType ?? "Yes"
                  : "No"
            }
          />
          <Field label="Name" value={qualification.callerName} />
          <Field label="Phone" value={qualification.callerPhone} />
          <Field label="Tour slot" value={qualification.tourSlot} />
        </div>
      ) : null}
      {qualification?.qualifies === false && qualification.disqualifyReason ? (
        <div
          className={`rounded-2xl border p-3 text-sm ${
            qualification.nearMiss ? "border-border bg-warning-soft" : "border-border bg-muted"
          }`}
        >
          {qualification.nearMiss ? (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-warning-ink uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-warning-ink" />
              Close — worth a follow-up
            </p>
          ) : (
            <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Staff note: criteria not met
            </p>
          )}
          <p className={qualification.nearMiss ? "text-warning-ink" : "text-foreground"}>
            {qualification.disqualifyReason}
          </p>
        </div>
      ) : null}
      {qualification?.screeningAnswers?.length ? (
        <div className="rounded-2xl border border-border p-3">
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Screening answers
          </p>
          <div className="space-y-1.5 text-sm">
            {qualification.screeningAnswers.map((answer) => (
              <div key={answer.key}>
                <span className="text-muted-foreground">{answer.question} </span>
                <span className="font-medium">
                  {typeof answer.value === "boolean"
                    ? answer.value
                      ? "Yes"
                      : "No"
                    : String(answer.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {qualification?.ownerProspect ? (
        <div className="rounded-2xl bg-violet-soft p-3 text-sm">
          <p className="mb-1 text-xs font-semibold tracking-wide text-violet uppercase">
            Owner prospect → Alex
          </p>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Field label="Name" value={qualification.ownerProspect.name} />
            <Field label="Phone" value={qualification.ownerProspect.phone} />
            <Field label="Email" value={qualification.ownerProspect.email} />
            <Field label="Property" value={qualification.ownerProspect.propertyAddress} />
            <Field label="Details" value={qualification.ownerProspect.propertyDetails} />
            <Field label="Notes" value={qualification.ownerProspect.notes} />
          </div>
        </div>
      ) : null}
      <ConversationTranscript conversationId={conversationId} />
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

export default function LeadsPage() {
  return (
    <RequireView views={["admin", "asset_manager"]}>
      <LeadsPageInner />
    </RequireView>
  );
}
