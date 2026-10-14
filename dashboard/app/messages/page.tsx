"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send, MessageCircle, Bot, User, Undo2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function MessagesPage() {
  const threads = useQuery(api.threads.list);
  const [selected, setSelected] = useState<Id<"threads"> | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">SMS and WhatsApp conversations.</p>
      </div>

      <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] gap-4 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Thread list — hidden on mobile once a thread is selected */}
        <div
          className={`w-full shrink-0 overflow-y-auto border-border sm:block sm:w-72 sm:border-r ${
            selected ? "hidden sm:block" : "block"
          }`}
        >
          {threads?.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No text conversations yet.</p>
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

        {/* Conversation pane */}
        <div className={`min-w-0 flex-1 ${selected ? "block" : "hidden sm:block"}`}>
          {selected ? (
            <Thread threadId={selected} onBack={() => setSelected(null)} />
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
  const messages = useQuery(api.threads.messages, { threadId });
  const threads = useQuery(api.threads.list);
  const thread = threads?.find((t) => t._id === threadId);
  const staffReply = useAction(api.threads.staffReply);
  const resumeBot = useMutation(api.threads.resumeBot);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await staffReply({ threadId, text: text.trim() });
      setText("");
    } finally {
      setSending(false);
    }
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

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
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
      </div>

      <div className="flex gap-2 border-t border-border p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSend()}
          placeholder={`Reply as staff via ${thread?.channel === "whatsapp" ? "WhatsApp" : "SMS"}`}
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
        />
        <button
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Send</span>
        </button>
      </div>
    </div>
  );
}
