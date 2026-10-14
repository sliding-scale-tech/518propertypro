"use client";

import { useConversation } from "@elevenlabs/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * The landing page's "Try yourself" call. A port of app/call/page.tsx, on purpose: same
 * token mint, same conversation row, same transcript query, so a call from the landing page
 * behaves exactly like one from the dashboard and shows up there the same way.
 *
 * Must be used inside a ConversationProvider.
 *
 * @param onCallEnded - Fired once per completed call, with the conversation it belonged to.
 *   Read through a ref internally, so an inline arrow function is fine here — a new identity
 *   on every render of the caller won't retrigger `finish`/`stop` below.
 */
export function useLiveCall(onCallEnded?: (conversationId: Id<"conversations">) => void) {
  const onCallEndedRef = useRef(onCallEnded);
  useEffect(() => {
    onCallEndedRef.current = onCallEnded;
  }, [onCallEnded]);

  const agent = useQuery(api.agents.current);
  const mintToken = useAction(api.agents.mintToken);
  const startConversation = useMutation(api.conversations.start);
  const appendMessage = useMutation(api.conversations.appendMessage);
  const endConversation = useMutation(api.conversations.end);
  const attachElevenLabsId = useMutation(api.conversations.attachElevenLabsId);

  const [conversationId, setConversationId] = useState<Id<"conversations"> | null>(null);
  const [starting, setStarting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The SDK callbacks below need the id without waiting for a re-render.
  const conversationIdRef = useRef<Id<"conversations"> | null>(null);

  // Left in place after the call ends so the full transcript stays on screen.
  const transcript = useQuery(
    api.conversations.transcript,
    conversationId ? { conversationId } : "skip",
  );

  // Closes the row. Idempotent: it runs both when we hang up and when the session drops.
  const finish = useCallback(() => {
    const id = conversationIdRef.current;
    if (!id) return;
    conversationIdRef.current = null;
    void endConversation({ conversationId: id, status: "ended" });
    setEnded(true);
    // Only fires when a conversation actually existed — a call that failed before one was
    // created (denied mic, mint failure) never reaches here, so it can't count as a "try".
    onCallEndedRef.current?.(id);
  }, [endConversation]);

  const { startSession, endSession, status, isSpeaking, isMuted, setMuted, getId } =
    useConversation({
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
      onError: (message: unknown) => {
        setError(typeof message === "string" ? message : "The conversation hit an error.");
      },
      // The agent ends its own calls once it's done (end_call), so this is the one signal
      // that reliably means the call is over — not just our own hang-up button.
      onDisconnect: () => {
        finish();
      },
    });

  const connected = status === "connected";
  const connecting = status === "connecting";

  useEffect(() => {
    if (!connected) return;
    const id = conversationIdRef.current;
    const elevenLabsId = getId();
    if (id && elevenLabsId) {
      void attachElevenLabsId({ conversationId: id, elevenLabsConversationId: elevenLabsId });
    }
  }, [connected, getId, attachElevenLabsId]);

  useEffect(() => {
    if (!connected) return;
    const interval = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [connected]);

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    setEnded(false);
    setSeconds(0);
    setConversationId(null);
    conversationIdRef.current = null;
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
      conversationIdRef.current = null;
    } finally {
      setStarting(false);
    }
  }, [agent, mintToken, startConversation, startSession]);

  const stop = useCallback(() => {
    endSession();
    finish();
  }, [endSession, finish]);

  useEffect(() => {
    const onUnload = () => {
      const id = conversationIdRef.current;
      if (id) void endConversation({ conversationId: id, status: "ended" });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [endConversation]);

  return {
    agent,
    transcript: transcript ?? [],
    hasConversation: conversationId !== null,
    connected,
    connecting,
    starting,
    ended,
    error,
    seconds,
    isSpeaking,
    isMuted,
    setMuted,
    start,
    stop,
  };
}
