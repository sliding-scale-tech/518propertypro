"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Send,
  MessageCircle,
  Bot,
  User,
  Undo2,
  Hand,
  QrCode,
  Loader2,
  Power,
  Unlink,
  AlertTriangle,
  CheckCircle2,
  X,
  Inbox as InboxIcon,
  Check,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";
import { severityBand, type SeverityBand } from "@/convex/severity";

const SEVERITY_STYLES: Record<SeverityBand, string> = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning-foreground",
  low: "bg-muted text-muted-foreground",
};

/** Left-edge colour per thread state, so the queue is scannable without reading it. */
const THREAD_BORDER: Record<string, string> = {
  bot: "border-l-success",
  escalated: "border-l-warning",
  closed: "border-l-muted-foreground/40",
};

const THREAD_BADGE: Record<string, string> = {
  bot: "bg-success/15 text-success",
  escalated: "bg-warning/15 text-warning-foreground",
  closed: "bg-muted text-muted-foreground",
};

const THREAD_LABEL: Record<string, string> = {
  bot: "Sarah",
  escalated: "Needs you",
  closed: "Closed",
};

type StatusFilter = "all" | "bot" | "escalated" | "closed";

/** "5m ago" reads faster than a timestamp when you are triaging a queue. */
function formatRelative(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** WAHA's raw session states, mapped to something a human can act on. */
const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  WORKING: { label: "Connected", tone: "bg-success/15 text-success" },
  SCAN_QR_CODE: { label: "Waiting for scan", tone: "bg-warning/15 text-warning-foreground" },
  STARTING: { label: "Starting…", tone: "bg-muted text-muted-foreground" },
  STOPPED: { label: "Disconnected", tone: "bg-muted text-muted-foreground" },
  FAILED: { label: "Failed", tone: "bg-destructive/15 text-destructive" },
  not_configured: { label: "Not configured", tone: "bg-destructive/15 text-destructive" },
};

export default function WhatsAppPage() {
  const toast = useToast();
  const threads = useQuery(api.whatsapp.threads);
  const stats = useQuery(api.whatsapp.stats);

  const connect = useAction(api.whatsapp.connect);
  const statusAndQr = useAction(api.whatsapp.statusAndQr);
  const disconnect = useAction(api.whatsapp.disconnect);
  const unlink = useAction(api.whatsapp.unlink);

  const [selected, setSelected] = useState<Id<"waThreads"> | null>(null);
  const [status, setStatus] = useState<string>("STOPPED");
  const [qr, setQr] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await statusAndQr();
      setStatus(r.status);
      setQr(r.qr);
      setConfigured(r.configured);
      if (r.status === "WORKING") setShowQr(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach WhatsApp.");
    }
  }, [statusAndQr]);

  // Fetching the live WAHA session state on mount. The rule below is aimed at derived state
  // computed from props; here the state genuinely lives in an external system the browser has
  // no other way to read, and setState happens after the await, not synchronously.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // WAHA rotates the QR roughly every 20 seconds; a stale one simply won't scan, so poll
  // while the dialog is open. Polling stops as soon as the session reports WORKING.
  useEffect(() => {
    if (!showQr || status === "WORKING") return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [showQr, status, refresh]);

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect();
      setShowQr(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the session.");
    } finally {
      setBusy(false);
    }
  };

  const statusInfo = STATUS_COPY[status] ?? {
    label: status,
    tone: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">WhatsApp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sarah answers WhatsApp on its own number, captures leases and maintenance issues, and
          hands over to you when it can&apos;t help. Completely separate from calls and SMS.
        </p>
      </div>

      {/* Connection */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Connection</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.tone}`}
                >
                  {statusInfo.label}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {status === "WORKING"
                  ? "Messages to this number are answered automatically."
                  : "Scan the QR code from the phone whose number the bot should use."}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {status !== "WORKING" && (
              <button
                onClick={handleConnect}
                disabled={busy || !configured}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <QrCode className="h-3.5 w-3.5" />
                )}
                Connect
              </button>
            )}
            {status === "SCAN_QR_CODE" && (
              <button
                onClick={() => setShowQr(true)}
                className="rounded-lg border border-input px-3.5 py-2 text-sm hover:bg-accent"
              >
                Show QR
              </button>
            )}
            {status === "WORKING" && (
              <button
                onClick={async () => {
                  await disconnect();
                  await refresh();
                  toast("WhatsApp disconnected");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-input px-3.5 py-2 text-sm hover:bg-accent"
              >
                <Power className="h-3.5 w-3.5" />
                Disconnect
              </button>
            )}
            <button
              onClick={async () => {
                await unlink();
                await refresh();
                toast("Number unlinked — next connect needs a new scan");
              }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <Unlink className="h-3.5 w-3.5" />
              Unlink
            </button>
          </div>
        </div>

        {!configured && (
          <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            WAHA isn&apos;t configured on this deployment. Set{" "}
            <code className="font-mono">WAHA_BASE_URL</code> and{" "}
            <code className="font-mono">WAHA_API_KEY</code> — see{" "}
            <code className="font-mono">infra/waha/README.md</code>.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={MessageCircle} label="Chats" value={String(stats.threads)} />
          <StatCard icon={CheckCircle2} label="Qualified" value={String(stats.qualifiedLeads)} />
          <StatCard icon={AlertTriangle} label="Open issues" value={String(stats.openIssues)} />
          <StatCard icon={Hand} label="Needs you" value={String(stats.escalated)} />
        </div>
      )}

      <Inbox threads={threads} selected={selected} onSelect={setSelected} />

      <AnimatePresence>
        {showQr && (
          <QrDialog
            qr={qr}
            status={status}
            onClose={() => setShowQr(false)}
            onRefresh={() => void refresh()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function QrDialog({
  qr,
  status,
  onClose,
  onRefresh,
}: {
  qr: string | null;
  status: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Link WhatsApp</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ol className="space-y-1 text-sm text-muted-foreground">
          <li>1. Open WhatsApp on the bot&apos;s phone</li>
          <li>2. Settings → Linked devices → Link a device</li>
          <li>3. Scan this code</li>
        </ol>

        <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-border bg-white p-4">
          {qr ? (
            <QRCode value={qr} size={200} />
          ) : status === "WORKING" ? (
            <div className="flex flex-col items-center gap-2 text-success">
              <CheckCircle2 className="h-8 w-8" />
              <span className="text-sm font-medium">Connected</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Waiting for WhatsApp…</span>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          The code refreshes every few seconds. If scanning fails, wait for a new one.
        </p>

        <button
          onClick={onRefresh}
          className="w-full rounded-lg border border-input px-4 py-2 text-sm hover:bg-accent"
        >
          Refresh now
        </button>
      </motion.div>
    </motion.div>
  );
}

type ThreadRow = NonNullable<ReturnType<typeof useQuery<typeof api.whatsapp.threads>>>[number];

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "bot", label: "Sarah" },
  { value: "escalated", label: "Needs you" },
  { value: "closed", label: "Closed" },
];

function Inbox({
  threads,
  selected,
  onSelect,
}: {
  threads: ThreadRow[] | undefined;
  selected: Id<"waThreads"> | null;
  onSelect: (id: Id<"waThreads"> | null) => void;
}) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  const visible = threads?.filter((t) => (filter === "all" ? true : t.status === filter));
  const needsYou = threads?.filter((t) => t.status === "escalated").length ?? 0;
  const thread = threads?.find((t) => t._id === selected) ?? null;

  return (
    <div className="flex h-[calc(100dvh-24rem)] min-h-[460px] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Thread list */}
      <div
        className={`flex w-full shrink-0 flex-col border-border sm:flex sm:w-80 sm:border-r ${
          selected ? "hidden sm:flex" : "flex"
        }`}
      >
        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">Inbox</h2>
            {needsYou > 0 && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                {needsYou} need you
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === f.value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {visible?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <InboxIcon className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {threads?.length === 0 ? "No conversations yet." : "Nothing in this filter."}
              </p>
            </div>
          )}
          {visible?.map((t, i) => {
            const isSelected = t._id === selected;
            const name = t.lead?.callerName ?? t.issue?.callerName ?? t.displayName;
            return (
              <motion.button
                key={t._id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i, 8) * 0.03 }}
                onClick={() => onSelect(t._id)}
                className={`flex w-full gap-3 border-b border-l-2 border-border/60 p-3.5 text-left transition-colors ${
                  THREAD_BORDER[t.status] ?? "border-l-muted"
                } ${isSelected ? "bg-accent" : "hover:bg-accent/50"}`}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-muted-foreground">
                  {(name || "?").replace("+", "").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-sm ${
                        isSelected || t.unreadCount > 0 ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground/60">
                      {formatRelative(t.lastMessageAt)}
                    </span>
                  </div>

                  {(t.issue || t.lead?.qualifies !== undefined) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {t.issue && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                            SEVERITY_STYLES[severityBand(t.issue.severity)]
                          }`}
                        >
                          {t.issue.severity}/10
                        </span>
                      )}
                      {t.lead?.qualifies !== undefined && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            t.lead.qualifies
                              ? "bg-success/15 text-success"
                              : "bg-warning/15 text-warning-foreground"
                          }`}
                        >
                          {t.lead.qualifies ? "Qualified" : "Not qualified"}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-0.5 flex items-center gap-1.5">
                    <p className="flex-1 truncate text-xs text-muted-foreground">
                      {t.lastMessagePreview ?? "No messages yet"}
                    </p>
                    {t.unreadCount > 0 && (
                      <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 py-0.5 text-[10px] font-bold text-primary-foreground">
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Detail */}
      <div className={`min-w-0 flex-1 ${selected ? "block" : "hidden sm:block"}`}>
        {thread ? (
          <ChatPane thread={thread} onBack={() => onSelect(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <MessageCircle className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Select a conversation to view</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatPane({ thread, onBack }: { thread: ThreadRow; onBack: () => void }) {
  const toast = useToast();
  const messages = useQuery(api.whatsapp.messages, { threadId: thread._id });
  const staffReply = useAction(api.whatsapp.staffReply);
  const resumeBot = useMutation(api.whatsapp.resumeBot);
  const takeOver = useMutation(api.whatsapp.takeOver);
  const markRead = useMutation(api.whatsapp.markRead);
  const closeThread = useMutation(api.whatsapp.closeThread);
  const reopenThread = useMutation(api.whatsapp.reopenThread);
  const renameThread = useMutation(api.whatsapp.renameThread);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const isClosed = thread.status === "closed";

  useEffect(() => {
    if (thread.unreadCount > 0) void markRead({ threadId: thread._id });
  }, [thread._id, thread.unreadCount, markRead]);

  // Jump to the newest message whenever the thread or its length changes, so a live reply
  // does not land below the fold.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await staffReply({ threadId: thread._id, text });
      setDraft("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not send", "error");
    } finally {
      setSending(false);
    }
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (name) await renameThread({ threadId: thread._id, displayName: name });
    setEditingName(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
        <button onClick={onBack} className="rounded-lg p-1.5 hover:bg-accent sm:hidden">
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editingName ? (
              <>
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
                />
                <button onClick={saveName} className="rounded p-1 hover:bg-accent">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="rounded p-1 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="truncate text-sm font-semibold">{thread.displayName}</span>
                <button
                  onClick={() => {
                    setNameDraft(thread.displayName);
                    setEditingName(true);
                  }}
                  aria-label="Rename"
                  className="text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </>
            )}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${THREAD_BADGE[thread.status]}`}
            >
              {THREAD_LABEL[thread.status]}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              WhatsApp
            </span>
            {thread.escalationReason && (
              <span className="text-xs text-muted-foreground">{thread.escalationReason}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {!isClosed &&
            (thread.status === "bot" ? (
              <button
                onClick={() => takeOver({ threadId: thread._id })}
                className="flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs hover:bg-accent"
              >
                <Hand className="h-3.5 w-3.5" />
                Take over
              </button>
            ) : (
              <button
                onClick={() => resumeBot({ threadId: thread._id })}
                className="flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs hover:bg-accent"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Back to Sarah
              </button>
            ))}
          {isClosed ? (
            <button
              onClick={() => reopenThread({ threadId: thread._id })}
              className="flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs hover:bg-accent"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reopen
            </button>
          ) : (
            <button
              onClick={() => closeThread({ threadId: thread._id })}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Close
            </button>
          )}
        </div>
      </div>

      <CapturedPanel thread={thread} />

      {thread.status === "escalated" && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Sarah has stopped replying on this chat. Your messages go out as staff.
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages?.map((m) => (
          <div key={m._id} className={m.sender === "customer" ? "text-left" : "text-right"}>
            <span
              className={`inline-block max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.sender === "customer"
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {m.text}
            </span>
            <div
              className={`mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground ${
                m.sender === "customer" ? "justify-start" : "justify-end"
              }`}
            >
              {m.sender !== "customer" && (
                <>
                  {m.sender === "bot" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                  {m.sender === "bot" ? "Sarah" : "You"}
                </>
              )}
              <span>{formatRelative(m.at)}</span>
              {m.deliveryStatus === "failed" && (
                <span className="text-destructive">not delivered</span>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      {isClosed ? (
        <div className="shrink-0 border-t border-border p-3 text-center text-xs text-muted-foreground">
          This conversation is closed. Reopen it to reply.
        </div>
      ) : (
        <div className="flex shrink-0 gap-2 border-t border-border p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={
              thread.status === "escalated"
                ? "Reply to customer..."
                : "Reply - this takes over from Sarah..."
            }
            disabled={sending}
            className="max-h-28 min-h-[52px] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

/** What the bot pulled out of this conversation, shown above the chat so staff see it first. */
function CapturedPanel({ thread }: { thread: ThreadRow }) {
  const { lead, issue } = thread;
  if (!lead && !issue) return null;

  return (
    <div className="border-b border-border bg-muted/30 px-4 py-3 text-xs">
      {issue && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span
            className={`rounded-full px-2 py-0.5 font-medium tabular-nums ${
              SEVERITY_STYLES[severityBand(issue.severity)]
            }`}
          >
            {issue.severity}/10
          </span>
          {issue.unit && <Fact label="Unit" value={issue.unit} />}
          {issue.callbackNumber && <Fact label="Callback" value={issue.callbackNumber} />}
          {issue.category && <Fact label="Category" value={issue.category} />}
        </div>
      )}
      {lead && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {lead.qualifies !== undefined && (
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                lead.qualifies ? "bg-success/15 text-success" : "bg-warning/15 text-warning-foreground"
              }`}
            >
              {lead.qualifies ? "Qualified" : "Not qualified"}
            </span>
          )}
          {lead.bedrooms && <Fact label="Unit" value={lead.bedrooms} />}
          {lead.budget !== undefined && <Fact label="Budget" value={`$${lead.budget}`} />}
          {lead.moveInDate && <Fact label="Move-in" value={lead.moveInDate} />}
          {lead.petsWanted !== undefined && (
            <Fact label="Pets" value={lead.petsWanted ? (lead.petType ?? "yes") : "no"} />
          )}
          {lead.callerPhone && <Fact label="Phone" value={lead.callerPhone} />}
          {lead.tourSlot && <Fact label="Tour" value={lead.tourSlot} />}
        </div>
      )}
      {lead?.disqualifyReason && (
        <div className="mt-1 text-muted-foreground">{lead.disqualifyReason}</div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-muted-foreground">
      {label}: <span className="text-foreground">{value}</span>
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MessageCircle;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
