"use client";

import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send, MessageCircle, Bot, User, Undo2, Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RequireView } from "@/components/require-view";
import { Pagination } from "@/components/ui";
import { useCursorPaging } from "@/lib/use-cursor-paging";

type ThreadFilter = "all" | "escalated" | "sms" | "whatsapp";

const FILTERS: Array<{ value: ThreadFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "escalated", label: "Escalated" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
];

/** Messages shown when a conversation opens, and added by each "Load earlier messages". */
const CHAT_STEP = 50;
/** Most messages the server returns for one conversation (it clamps `limit` to this). */
const CHAT_MAX = 1000;

function MessagesPageInner() {
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const paging = useCursorPaging();
  const page = useQuery(api.threads.list, { filter, cursor: paging.cursor, pageSize: paging.pageSize });
  const [selected, setSelected] = useState<Id<"threads"> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A new page starts at the top of the list.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [paging.cursor]);

  const threads = page?.page;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">SMS and WhatsApp conversations.</p>
      </div>

      <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] gap-4 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Thread list — hidden on mobile once a thread is selected */}
        <div
          className={`w-full shrink-0 flex-col border-border sm:flex sm:w-72 sm:border-r ${
            selected ? "hidden sm:flex" : "flex"
          }`}
        >
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-border p-3">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => {
                  setFilter(f.value);
                  paging.reset();
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === f.value ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {threads === undefined && (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading conversations…
              </div>
            )}
            {threads?.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {filter === "all" && paging.page === 1 ? "No text conversations yet." : "No conversations match this filter."}
              </p>
            )}
            {threads?.map((t, i) => (
              <motion.button
                key={t._id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i, 8) * 0.03 }}
                onClick={() => setSelected(t._id)}
                className={`block w-full border-b border-border px-4 py-3 text-left text-sm transition-colors last:border-0 ${
                  selected === t._id ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.customerPhone}</span>
                  <div className="flex shrink-0 gap-1">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {t.channel === "whatsapp" ? "WhatsApp" : "SMS"}
                    </span>
                    {t.status === "escalated" && (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                        escalated
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(t.lastMessageAt).toLocaleString()}
                </div>
              </motion.button>
            ))}
          </div>
          {page ? (
            <div className="shrink-0 border-t border-border px-2 pb-3">
              <Pagination
                label="Conversation pages"
                page={paging.page}
                pageSize={paging.pageSize}
                rowsOnPage={page.page.length}
                rowsBefore={paging.rowsBefore}
                hasNext={!page.isDone}
                onPage={(p) =>
                  paging.goTo(p, {
                    rowsOnPage: page.page.length,
                    hasNext: !page.isDone,
                    continueCursor: page.continueCursor,
                  })
                }
                onPageSize={paging.setPageSize}
              />
            </div>
          ) : null}
        </div>

        {/* Conversation pane */}
        <div className={`min-w-0 flex-1 ${selected ? "block" : "hidden sm:block"}`}>
          {selected ? (
            <Thread key={selected} threadId={selected} onBack={() => setSelected(null)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Thread({ threadId, onBack }: { threadId: Id<"threads">; onBack: () => void }) {
  const [limit, setLimit] = useState(CHAT_STEP);
  const data = useQuery(api.threads.messages, { threadId, limit });
  // Keep the messages on screen while a larger window loads, so "Load earlier" does not blank the chat.
  const [held, setHeld] = useState(data);
  if (data && data !== held) setHeld(data);
  const messages = held?.messages;
  const hasMore = held?.hasMore ?? false;
  const thread = useQuery(api.threads.byId, { threadId });
  const resumeBot = useMutation(api.threads.resumeBot);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Scroll position taken when earlier messages are requested, so they land above without a jump.
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const newestId = messages?.[messages.length - 1]?._id;

  // The newest message in view when the chat opens and when a new one arrives (not on "Load earlier").
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [newestId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    el.scrollTop = a.top + (el.scrollHeight - a.height);
    anchor.current = null;
  }, [messages?.length]);

  const loadEarlier = () => {
    const el = scrollRef.current;
    if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    setLimit((n) => n + CHAT_STEP);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded-lg p-1.5 hover:bg-accent sm:hidden" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 font-medium">
              {thread?.customerPhone}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                {thread?.channel === "whatsapp" ? "WhatsApp" : "SMS"}
              </span>
            </div>
            {thread?.status === "escalated" && thread.escalationReason && (
              <div className="text-xs text-destructive">{thread.escalationReason}</div>
            )}
          </div>
        </div>
        {thread?.status === "escalated" && (
          <button
            onClick={() => void resumeBot({ threadId })}
            className="flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs hover:bg-accent"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Hand back to bot
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {hasMore && messages && messages.length >= CHAT_MAX && (
          <p role="status" className="text-center text-xs text-muted-foreground">
            Showing the latest {CHAT_MAX.toLocaleString("en-US")} messages
          </p>
        )}
        {hasMore && !(messages && messages.length >= CHAT_MAX) && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={loadEarlier}
              disabled={data === undefined}
              className="flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {data === undefined && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Load earlier messages
            </button>
          </div>
        )}
        {messages === undefined && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading messages…
          </div>
        )}
        {messages?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No messages in this conversation yet.</p>
        )}
        <AnimatePresence initial={false}>
          {messages?.map((m) => (
            <motion.div
              key={m._id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={m.sender === "customer" ? "text-left" : "text-right"}
            >
              <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.sender !== "customer" &&
                  (m.sender === "staff" ? <User className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />)}
                {m.sender}
              </div>
              <span
                className={`inline-block max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                  m.sender === "customer"
                    ? "bg-secondary text-secondary-foreground"
                    : m.sender === "staff"
                      ? "bg-success/15 text-foreground"
                      : "bg-accent text-accent-foreground"
                }`}
              >
                {m.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2" title="Texting is off for now">
          <input
            disabled
            placeholder="Texting is off for now"
            className="flex-1 cursor-not-allowed rounded-lg border border-input bg-background px-3 py-2 text-sm opacity-50 outline-none"
          />
          <button
            disabled
            className="flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Texting is off for now. Texts are sent only for emergencies, to admins, so replies from here are paused.
        </p>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <RequireView views={["admin"]}>
      <MessagesPageInner />
    </RequireView>
  );
}
