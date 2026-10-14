"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, PhoneOff, Loader2, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LiveWaveform } from "@/components/ui/live-waveform";

export default function CallPage() {
  return (
    <ConversationProvider>
      <CallScreen />
    </ConversationProvider>
  );
}

/**
 * Solid handset, not lucide's outlined `Phone` — the design's call button carries a filled
 * glyph, and an outlined one reads noticeably lighter at this size against the blue disc.
 * (lucide ships no filled variant, hence the inline path.)
 */
function PhoneFilledIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
    </svg>
  );
}

/**
 * Fixed decorative pattern for the idle (not connecting/connected) state, flanking the call
 * button. Swapped out for the real, audio-reactive LiveWaveform the moment a call starts —
 * this only exists to match the at-rest look precisely without waiting on a microphone.
 *
 * Heights are the design's exact bar pattern, read left-to-right; the group to the right of
 * the button mirrors it.
 */
const IDLE_BAR_HEIGHTS = [28, 21, 4, 17, 10, 4, 4, 28, 10, 17, 28, 21];

/** 12 bars at 4px wide on a 3px gap — the width the design's waveform group occupies. */
const BAR_GROUP_WIDTH = "81px";

function IdleBars({ mirrored = false }: { mirrored?: boolean }) {
  const heights = mirrored ? [...IDLE_BAR_HEIGHTS].reverse() : IDLE_BAR_HEIGHTS;
  return (
    <div className="flex items-center gap-[3px]" aria-hidden="true">
      {heights.map((h, i) => (
        <span key={i} className="w-1 rounded-full bg-border" style={{ height: `${h}px` }} />
      ))}
    </div>
  );
}

/** Two overlapping speech-bubble shapes standing in for "no transcript yet". */
function EmptyTranscriptGraphic() {
  return (
    <div className="relative h-[60px] w-[97px]" aria-hidden="true">
      <div className="absolute top-0 left-0 flex h-[35px] w-[58px] flex-col justify-center gap-1.5 rounded-xl rounded-bl-none bg-muted px-2.5">
        <span className="h-1 w-[35px] rounded-full bg-border" />
        <span className="h-1 w-[21px] rounded-full bg-border" />
      </div>
      <div className="bg-primary/10 absolute top-[25px] left-[41px] flex h-[35px] w-[57px] items-center rounded-xl rounded-br-none px-2.5">
        <span className="bg-primary/20 h-1 w-[35px] rounded-full" />
      </div>
    </div>
  );
}

function CallScreen() {
  const agent = useQuery(api.agents.current);
  const mintToken = useAction(api.agents.mintToken);
  const startConversation = useMutation(api.conversations.start);
  const appendMessage = useMutation(api.conversations.appendMessage);
  const endConversation = useMutation(api.conversations.end);
  const attachElevenLabsId = useMutation(api.conversations.attachElevenLabsId);

  const [conversationId, setConversationId] = useState<Id<"conversations"> | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cosmetic-only: hides the transcript panel until the next call starts. Nothing server-side
  // is deleted — Clear just gives the caller a clean slate to look at, the same way skimming
  // past old messages in a chat app doesn't erase them.
  const [transcriptCleared, setTranscriptCleared] = useState(false);

  const conversationIdRef = useRef<Id<"conversations"> | null>(null);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const transcript = useQuery(
    api.conversations.transcript,
    conversationId ? { conversationId } : "skip",
  );

  const { startSession, endSession, status, isSpeaking, isMuted, setMuted, getId } = useConversation({
    onMessage: ({ message, source }) => {
      const id = conversationIdRef.current;
      if (!id || !message) return;
      void appendMessage({
        conversationId: id,
        role: source === "user" ? "user" : "agent",
        text: message,
        isFinal: true,
      });
    },
    // The only reliable end-of-call signal: fires for every disconnection path (the user
    // hanging up, the agent ending the call, a dropped network, a WebRTC failure) — not just
    // the explicit stop button. Without this, a call that doesn't end cleanly through handleStop
    // stays "active" with no duration forever, since production has no post-call webhook to
    // reconcile it after the fact. `end` is idempotent (a no-op once already ended), so this
    // running alongside handleStop's own call is harmless.
    onDisconnect: () => {
      const id = conversationIdRef.current;
      if (id) void endConversation({ conversationId: id, status: "ended" });
    },
    onError: (message: unknown) => {
      setError(typeof message === "string" ? message : "The conversation hit an error.");
    },
  });

  const connected = status === "connected";
  const connecting = status === "connecting";
  const live = connecting || connected;

  useEffect(() => {
    if (!connected) return;
    const id = conversationIdRef.current;
    const elevenLabsId = getId();
    if (id && elevenLabsId) {
      void attachElevenLabsId({ conversationId: id, elevenLabsConversationId: elevenLabsId });
    }
  }, [connected, getId, attachElevenLabsId]);

  // The agent's own display name is per-user (each account has its own agent, possibly its own
  // name) — "Sarah - Leasing receptionist" becomes just "Sarah" for the conversational line,
  // rather than hardcoding a name that would be wrong for anyone who renamed their agent.
  const firstName = agent?.name?.split(/[-–—]/)[0]?.trim() || "your agent";

  const handleStart = useCallback(async () => {
    setError(null);
    setStarting(true);
    setTranscriptCleared(false);
    try {
      const { token } = await mintToken();
      if (!agent) throw new Error("Agent is still being created — try again in a moment.");

      const id = await startConversation({ agentId: agent._id });
      setConversationId(id);
      conversationIdRef.current = id;

      startSession({ conversationToken: token, connectionType: "webrtc" });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not start the call. Check the microphone permission.",
      );
      setConversationId(null);
    } finally {
      setStarting(false);
    }
  }, [agent, mintToken, startConversation, startSession]);

  const handleStop = useCallback(() => {
    endSession();
    const id = conversationIdRef.current;
    if (id) void endConversation({ conversationId: id, status: "ended" });
    setConversationId(null);
  }, [endSession, endConversation]);

  useEffect(() => {
    const onUnload = () => {
      const id = conversationIdRef.current;
      if (id) void endConversation({ conversationId: id, status: "ended" });
    };
    // beforeunload alone misses mobile Safari (tab close/backgrounding rarely fires it) and any
    // async work it starts can be torn down mid-flight; pagehide fires in both of those cases
    // too, so both are wired to the same best-effort call.
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, [endConversation]);

  const heroSubtitle = connected
    ? isSpeaking
      ? `${firstName} is speaking…`
      : "Listening — go ahead and talk."
    : connecting
      ? "Connecting you now…"
      : starting
        ? "Starting…"
        : "Click the icon to start a call, and you will connect within few seconds";

  const visibleTranscript = transcriptCleared ? [] : (transcript ?? []);

  return (
    <div className="relative isolate space-y-8 pb-16 sm:pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {agent?.name ?? "Support agent"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a browser call to test the voice agent.
        </p>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 overflow-hidden rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Call control card. Borderless by design — it reads as a raised surface off a soft
          shadow alone, so a hairline would only muddy the edge against the wash. */}
      <div className="overflow-hidden rounded-[32px] bg-card shadow-[0_10px_30px_-12px_rgb(15_23_42_/_0.18)]">
        <div className="flex flex-col items-center gap-7 px-6 pt-20 pb-16 text-center sm:px-10 sm:pt-24 sm:pb-20">
          {/* Waveform-flanked call button. Idle bars are a fixed decorative pattern; once a
              call is starting or live, the real audio-reactive waveform takes over. */}
          <div className="flex items-center justify-center gap-3">
            <div className="hidden justify-end sm:flex" style={{ width: BAR_GROUP_WIDTH }}>
              {live ? (
                <LiveWaveform
                  active={connected}
                  processing={connecting}
                  className="h-8 w-full text-primary"
                />
              ) : (
                <IdleBars mirrored />
              )}
            </div>

            <div className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center">
              {connected && (
                <>
                  <span className="absolute inset-0 rounded-full bg-primary/40 animate-pulse-ring" />
                  <span
                    className="absolute inset-0 rounded-full bg-primary/40 animate-pulse-ring"
                    style={{ animationDelay: "0.6s" }}
                  />
                </>
              )}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={connected ? handleStop : handleStart}
                disabled={starting || agent === undefined}
                className={`relative z-10 flex h-[84px] w-[84px] items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  connected
                    ? "bg-destructive text-destructive-foreground shadow-[0_10px_24px_-6px_rgb(220_38_38_/_0.5)] hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground shadow-[0_10px_24px_-6px_rgb(37_99_235_/_0.45)] hover:bg-primary/90"
                }`}
                aria-label={connected ? "End call" : "Start call"}
              >
                {starting || connecting ? (
                  <Loader2 className="h-[26px] w-[26px] animate-spin" />
                ) : connected ? (
                  <PhoneOff className="h-[26px] w-[26px]" />
                ) : (
                  <PhoneFilledIcon className="h-[26px] w-[26px]" />
                )}
              </motion.button>
            </div>

            <div className="hidden sm:flex" style={{ width: BAR_GROUP_WIDTH }}>
              {live ? (
                <LiveWaveform
                  active={connected}
                  processing={connecting}
                  className="h-8 w-full text-primary"
                />
              ) : (
                <IdleBars />
              )}
            </div>
          </div>

          <div>
            <p className="text-lg font-bold text-secondary-foreground">
              Hi, I’m {firstName}, your AI agent
            </p>
            <p className="mt-2 text-base text-muted-foreground">{heroSubtitle}</p>
          </div>

          <AnimatePresence>
            {connected && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => setMuted(!isMuted)}
                className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-accent"
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isMuted ? "Unmute" : "Mute"}
              </motion.button>
            )}
          </AnimatePresence>

          <p className="mt-3.5 text-[11px] leading-4 font-medium tracking-wider text-muted-foreground-subtle uppercase">
            Recorded &bull; Transcripted &bull; Access information anytime
          </p>
        </div>

        <div className="border-t border-border bg-card px-6 pt-6 pb-5 sm:px-7 sm:pt-7 sm:pb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${connected ? "bg-success animate-pulse" : "bg-muted-foreground/30"}`}
              />
              <span className="text-sm font-semibold text-secondary-foreground">Live transcript</span>
            </div>
            <button
              type="button"
              onClick={() => setTranscriptCleared(true)}
              disabled={visibleTranscript.length === 0}
              className="flex h-[30px] items-center rounded-full border border-border bg-card px-4 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            The transcript will appear here as you speak.
          </p>

          <div className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto">
            {visibleTranscript.length > 0 ? (
              visibleTranscript.map((line, i) => (
                <motion.div
                  key={line._id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 5) * 0.03, duration: 0.2 }}
                  className={line.role === "user" ? "text-right" : "text-left"}
                >
                  <span
                    className={`inline-block max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      line.role === "user"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-accent text-accent-foreground"
                    } ${line.isFinal ? "" : "opacity-50"}`}
                  >
                    {line.text}
                  </span>
                </motion.div>
              ))
            ) : (
              <div className="flex flex-col items-center gap-6 py-7 text-center">
                <EmptyTranscriptGraphic />
                <p className="text-sm text-muted-foreground">Start a call to see the conversation here.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
