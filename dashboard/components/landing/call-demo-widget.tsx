"use client";

import { ConversationProvider } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveWaveform } from "@/components/ui/live-waveform";
import type { Id } from "@/convex/_generated/dataModel";
import { AUDIO_BASE_PATH, CHECKLIST_ITEMS, SCRIPT, type DemoLine } from "./call-script";
import { RatingModal, SignupNudgeModal } from "./feedback-modals";
import {
  landingPopupAlreadyShown,
  markLandingPopupShown,
  recordLandingCallCompleted,
} from "./landing-session";
import { useLiveCall } from "./use-live-call";

const BAR_COUNT = 24;

type TranscriptLine = DemoLine & { id: number; show: boolean };
type DemoStatus = "ready" | "live" | "paused" | "ended";

function formatTimer(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function estimateDurationMs(text: string) {
  const words = text.split(/\s+/).length;
  return Math.max(900, (words / 2.7) * 1000);
}

export function useCallDemo() {
  const [status, setStatus] = useState<DemoStatus>("ready");
  const [seconds, setSeconds] = useState(0);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [doneChecks, setDoneChecks] = useState<string[]>([]);
  const [barHeights, setBarHeights] = useState<number[]>(() => Array.from({ length: BAR_COUNT }, () => 6));
  const [barsActive, setBarsActive] = useState(false);
  const [startDisabled, setStartDisabled] = useState(false);
  const [pauseDisabled, setPauseDisabled] = useState(true);
  const [replay, setReplay] = useState(false);

  const pausedRef = useRef(false);
  const startingRef = useRef(false);
  const statusRef = useRef<DemoStatus>("ready");
  const generationRef = useRef(0);
  const lineIdRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const resumeLineRef = useRef<(() => void) | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const fallbackRemainingRef = useRef(0);
  const fallbackStartedRef = useRef(0);
  const fallbackAdvanceRef = useRef<(() => void) | null>(null);
  const waveIntervalRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const playLineRef = useRef<(index: number) => void>(() => {});

  const setDemoStatus = useCallback((next: DemoStatus) => {
    statusRef.current = next;
    pausedRef.current = next === "paused";
    setStatus(next);
  }, []);

  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const stopWave = useCallback(() => {
    if (waveIntervalRef.current !== null) {
      window.clearInterval(waveIntervalRef.current);
      waveIntervalRef.current = null;
    }
    setBarsActive(false);
    setBarHeights(Array.from({ length: BAR_COUNT }, () => 6));
  }, []);

  const startWave = useCallback(() => {
    if (waveIntervalRef.current !== null) window.clearInterval(waveIntervalRef.current);
    setBarsActive(true);
    waveIntervalRef.current = window.setInterval(() => {
      setBarHeights(Array.from({ length: BAR_COUNT }, () => 6 + Math.random() * 36));
    }, 120);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerIntervalRef.current = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
  }, [stopTimer]);

  const stopAudio = useCallback(() => {
    const audio = activeAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    activeAudioRef.current = null;
  }, []);

  const scheduleFallback = useCallback(() => {
    if (pausedRef.current || !fallbackAdvanceRef.current) return;
    fallbackStartedRef.current = performance.now();
    fallbackTimerRef.current = window.setTimeout(fallbackAdvanceRef.current, fallbackRemainingRef.current);
  }, []);

  const finishCall = useCallback(
    (generation: number) => {
      if (generation !== generationRef.current) return;
      stopAudio();
      resumeLineRef.current = null;
      fallbackAdvanceRef.current = null;
      clearFallback();
      setPauseDisabled(true);
      stopWave();
      stopTimer();
      startingRef.current = false;
      setDemoStatus("ended");
      setStartDisabled(false);
      setReplay(true);
    },
    [clearFallback, setDemoStatus, stopAudio, stopTimer, stopWave],
  );

  playLineRef.current = (index: number) => {
    const generation = generationRef.current;
    if (index >= SCRIPT.length) {
      finishCall(generation);
      return;
    }

    const line = SCRIPT[index];
    const id = ++lineIdRef.current;
    setLines((prev) => [...prev, { ...line, id, show: false }]);
    requestAnimationFrame(() => {
      if (generation !== generationRef.current) return;
      setLines((prev) => prev.map((item) => (item.id === id ? { ...item, show: true } : item)));
    });

    window.setTimeout(() => {
      const el = transcriptRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 30);

    if (line.check) {
      setDoneChecks((prev) => (prev.includes(line.check!) ? prev : [...prev, line.check!]));
    }

    startWave();

    const audio = new Audio(AUDIO_BASE_PATH + line.file);
    activeAudioRef.current = audio;
    let advanced = false;

    const advance = () => {
      if (advanced || pausedRef.current || generation !== generationRef.current) return;
      advanced = true;
      clearFallback();
      fallbackAdvanceRef.current = null;
      stopWave();
      playLineRef.current(index + 1);
    };

    const useFallback = (error?: Event | Error) => {
      if (error && "name" in error && error.name === "AbortError") return;
      if (advanced || activeAudioRef.current !== audio || fallbackAdvanceRef.current) return;
      audio.pause();
      fallbackRemainingRef.current = estimateDurationMs(line.text);
      fallbackAdvanceRef.current = advance;
      scheduleFallback();
    };

    resumeLineRef.current = () => {
      if (audio.ended) advance();
      else void audio.play().catch(useFallback);
    };

    audio.addEventListener("ended", advance);
    audio.addEventListener("error", useFallback);
    resumeLineRef.current();
  };

  const resetEngine = useCallback(() => {
    generationRef.current += 1;
    stopAudio();
    resumeLineRef.current = null;
    fallbackAdvanceRef.current = null;
    clearFallback();
    stopWave();
    stopTimer();
  }, [clearFallback, stopAudio, stopTimer, stopWave]);

  const start = useCallback(() => {
    if (startDisabled || startingRef.current) return;
    startingRef.current = true;
    resetEngine();
    pausedRef.current = false;
    setPauseDisabled(false);
    setLines([]);
    setDoneChecks([]);
    setSeconds(0);
    setStartDisabled(true);
    setReplay(false);
    setDemoStatus("live");
    startTimer();
    playLineRef.current(0);
  }, [resetEngine, setDemoStatus, startDisabled, startTimer]);

  const togglePause = useCallback(() => {
    if (pauseDisabled) return;
    if (statusRef.current !== "live" && statusRef.current !== "paused") return;

    if (!pausedRef.current) {
      pausedRef.current = true;
      setDemoStatus("paused");
      activeAudioRef.current?.pause();
      stopWave();
      stopTimer();
      if (fallbackTimerRef.current !== null) {
        clearFallback();
        fallbackRemainingRef.current = Math.max(
          0,
          fallbackRemainingRef.current - (performance.now() - fallbackStartedRef.current),
        );
      }
      return;
    }

    pausedRef.current = false;
    setDemoStatus("live");
    startWave();
    startTimer();
    if (fallbackAdvanceRef.current) scheduleFallback();
    else resumeLineRef.current?.();
  }, [clearFallback, pauseDisabled, scheduleFallback, setDemoStatus, startTimer, startWave, stopTimer, stopWave]);

  /** Hard-stops playback and returns the controls to their idle state. */
  const stop = useCallback(() => {
    resetEngine();
    startingRef.current = false;
    setPauseDisabled(true);
    setStartDisabled(false);
    setDemoStatus("ready");
  }, [resetEngine, setDemoStatus]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      stopAudio();
      clearFallback();
      stopWave();
      stopTimer();
    };
  }, [clearFallback, stopAudio, stopTimer, stopWave]);

  return {
    status,
    timerLabel: formatTimer(seconds),
    lines,
    doneChecks,
    barHeights,
    barsActive,
    startDisabled,
    pauseDisabled,
    replay,
    transcriptRef,
    start,
    stop,
    togglePause,
  };
}

function formatSeconds(seconds: number) {
  return formatTimer(seconds);
}

export function CallDemoWidget() {
  return (
    <ConversationProvider>
      <CallDemoInner />
    </ConversationProvider>
  );
}

type LandingPopup = { kind: "rating"; conversationId: Id<"conversations"> } | { kind: "signupNudge" };

function CallDemoInner() {
  const demo = useCallDemo();
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [popup, setPopup] = useState<LandingPopup | null>(null);

  // Fires once per completed live call — never for the scripted "Watch it answer a call"
  // demo, which never reaches useLiveCall at all. The rating popup is once-per-visit
  // (landing-session.ts gates it); the signup nudge is the opposite on purpose — it comes
  // back on every call from the 3rd one onward, since someone who keeps coming back is
  // exactly who the nudge is for.
  const handleCallEnded = useCallback((conversationId: Id<"conversations">) => {
    const count = recordLandingCallCompleted();
    if (count === 1 && !landingPopupAlreadyShown("rating")) {
      markLandingPopupShown("rating");
      setPopup({ kind: "rating", conversationId });
    } else if (count >= 3) {
      setPopup({ kind: "signupNudge" });
    }
  }, []);

  const live = useLiveCall(handleCallEnded);

  const liveBusy = live.starting || live.connecting || live.connected;

  const tryYourself = useCallback(() => {
    demo.stop();
    setMode("live");
    void live.start();
  }, [demo, live]);

  const watchDemo = useCallback(() => {
    setMode("demo");
    demo.start();
  }, [demo]);

  // Keep the live transcript pinned to the newest line, the way the demo does for its own.
  // Its own ref rather than the demo hook's: reaching into a hook-owned ref from here is
  // exactly what the compiler lint forbids.
  const liveTranscriptRef = useRef<HTMLDivElement | null>(null);
  const liveLineCount = live.transcript.length;
  useEffect(() => {
    const el = liveTranscriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLineCount]);

  const isLive = mode === "live";

  const statusLabel = isLive
    ? live.connected
      ? "Live"
      : live.starting || live.connecting
        ? "Connecting"
        : live.ended
          ? "Call ended"
          : "Ready"
    : demo.status === "live"
      ? "Live"
      : demo.status === "paused"
        ? "Paused"
        : demo.status === "ended"
          ? "Call ended"
          : "Ready";

  const subtitle = isLive
    ? live.connected
      ? live.isSpeaking
        ? "Agent is speaking…"
        : "Listening — go ahead and talk"
      : live.starting || live.connecting
        ? "Connecting…"
        : live.ended
          ? "Call ended"
          : "Live call in your browser"
    : "Incoming call · 2:13 AM";

  return (
    <>
      <div className="cdw-controls hero-controls">
        <button
          className="cdw-start-btn"
          type="button"
          onClick={isLive ? watchDemo : demo.start}
          disabled={liveBusy || (!isLive && demo.startDisabled)}
        >
          ▶{" "}
          {isLive
            ? "Watch it answer a call"
            : demo.replay
              ? "Watch it again"
              : demo.startDisabled
                ? "Playing…"
                : "Watch it answer a call"}
        </button>
        <button
          className={`cdw-start-btn try-yourself${liveBusy ? " end-call" : ""}`}
          type="button"
          onClick={liveBusy ? live.stop : tryYourself}
          disabled={live.agent === undefined}
        >
          {liveBusy ? "End call" : isLive ? "Call again" : "Try yourself"}
        </button>
      </div>

      <div className="demo-stage">
        <div className="call-demo-widget">
          <div className="cdw-header">
            <div className="cdw-header-left">
              <div className="cdw-phone-icon">📞</div>
              <div>
                <div className="cdw-title">
                  {isLive ? live.agent?.name ?? "Leasing receptionist" : "Parkview Apartments"}
                </div>
                <div className="cdw-subtitle">{subtitle}</div>
              </div>
            </div>
            <div className="cdw-playback">
              <div className="cdw-status">
                <span className={`cdw-dot${statusLabel === "Live" ? " live" : ""}`} />
                <span>{statusLabel}</span>
              </div>
              <div className="cdw-timer">{isLive ? formatSeconds(live.seconds) : demo.timerLabel}</div>
              {isLive ? (
                <button
                  className="cdw-pause"
                  type="button"
                  aria-label={live.isMuted ? "Unmute microphone" : "Mute microphone"}
                  title={live.isMuted ? "Unmute microphone" : "Mute microphone"}
                  disabled={!live.connected}
                  onClick={() => live.setMuted(!live.isMuted)}
                >
                  <span aria-hidden="true">{live.isMuted ? "🔇" : "🎙"}</span>
                </button>
              ) : (
                <button
                  className="cdw-pause"
                  type="button"
                  aria-label={demo.status === "paused" ? "Resume conversation" : "Pause conversation"}
                  title={demo.status === "paused" ? "Resume conversation" : "Pause conversation"}
                  disabled={demo.pauseDisabled}
                  onClick={demo.togglePause}
                >
                  <span aria-hidden="true">{demo.status === "paused" ? "▶" : "⏸"}</span>
                </button>
              )}
            </div>
          </div>

          <div className="cdw-waveform">
            {isLive ? (
              <div className="cdw-live-wave">
                <LiveWaveform
                  active={live.connected}
                  processing={live.starting || live.connecting}
                  barColor="#2563eb"
                  height={48}
                />
              </div>
            ) : (
              demo.barHeights.map((height, index) => (
                <div
                  key={index}
                  className={`cdw-bar${demo.barsActive ? " active" : ""}`}
                  style={{ height: `${height}px` }}
                />
              ))
            )}
          </div>

          <div className={`cdw-body${isLive ? " cdw-body--solo" : ""}`}>
            <div className="cdw-transcript" ref={isLive ? liveTranscriptRef : demo.transcriptRef}>
              {isLive ? (
                live.transcript.length > 0 ? (
                  live.transcript.map((line) => (
                    <div key={line._id} className={`cdw-line ${line.role === "user" ? "caller" : "ai"} show`}>
                      <div className="cdw-speaker">{line.role === "user" ? "You" : "AI receptionist"}</div>
                      {line.text}
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <strong>
                      {live.error
                        ? "Couldn't start the call"
                        : live.ended
                          ? "Call ended"
                          : live.connected
                            ? "You're connected"
                            : "Getting the assistant on the line"}
                    </strong>
                    {live.error
                      ? live.error
                      : live.ended
                        ? "Press Call again to start another one."
                        : live.connected
                          ? "Say hello — everything either of you says will appear here."
                          : "Allow the microphone when your browser asks."}
                  </div>
                )
              ) : demo.lines.length === 0 ? (
                <div className="empty-state">
                  <strong>Ready to answer the next call</strong>
                  Press play to hear Simplr qualify the renter, capture the details, and book the tour.
                </div>
              ) : (
                demo.lines.map((line) => (
                  <div key={line.id} className={`cdw-line ${line.speaker}${line.show ? " show" : ""}`}>
                    <div className="cdw-speaker">{line.speaker === "ai" ? "AI receptionist" : "Caller"}</div>
                    {line.text}
                  </div>
                ))
              )}
            </div>
            {!isLive && (
              <div className="cdw-checklist">
                <h4>Qualification</h4>
                {CHECKLIST_ITEMS.map((item) => (
                  <div key={item.key} className={`cdw-check-item${demo.doneChecks.includes(item.key) ? " done" : ""}`}>
                    <span className="cdw-check-circle">✓</span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {popup?.kind === "rating" && (
        <RatingModal conversationId={popup.conversationId} onClose={() => setPopup(null)} />
      )}
      {popup?.kind === "signupNudge" && <SignupNudgeModal onClose={() => setPopup(null)} />}
    </>
  );
}
