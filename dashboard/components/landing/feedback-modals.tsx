"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getLandingSessionId } from "./landing-session";

const STARS = [1, 2, 3, 4, 5] as const;

function StarPicker({
  value,
  disabled,
  onSelect,
}: {
  value: number;
  disabled: boolean;
  onSelect: (n: number) => void;
}) {
  const [hover, setHover] = useState(0);
  // Hover previews the fill so a visitor sees what a click will commit to before committing —
  // once picked, the rating itself takes over as the filled count.
  const shown = hover || value;

  return (
    <div className="ll-stars" role="radiogroup" aria-label="Rate this call">
      {STARS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className={`ll-star${n <= shown ? " ll-star--filled" : ""}`}
          disabled={disabled}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => onSelect(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ModalShell({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="ll-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ll-modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="ll-modal-close" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

/**
 * Shown once, after the visitor's first completed "Try yourself" call. Two steps in one
 * modal: picking a star writes the rating immediately (so it's captured even if they close
 * the modal right after), then an optional email step sends a copy of the transcript — see
 * convex/transcriptEmail.ts.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function RatingModal({
  conversationId,
  onClose,
}: {
  conversationId: Id<"conversations"> | null;
  onClose: () => void;
}) {
  const submitRating = useMutation(api.ratings.submit);
  const attachEmail = useMutation(api.ratings.attachEmail);

  const [step, setStep] = useState<"stars" | "email" | "done">("stars");
  const [rating, setRating] = useState(0);
  const [ratingId, setRatingId] = useState<Id<"callRatings"> | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectRating = async (n: number) => {
    if (saving) return;
    setRating(n);
    setSaving(true);
    try {
      const id = await submitRating({
        sessionId: getLandingSessionId(),
        conversationId: conversationId ?? undefined,
        rating: n,
      });
      setRatingId(id);
      setStep("email");
    } catch {
      // The rating didn't save — let them try another star rather than stranding them on a
      // step that looks answered but wasn't.
      setRating(0);
    } finally {
      setSaving(false);
    }
  };

  const finishWithEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setStep("done");
      window.setTimeout(onClose, 400);
      return;
    }
    // Caught here rather than left to the server: a typo'd address should get a chance to be
    // fixed, not silently vanish into a rejected Resend call the visitor never sees.
    if (!EMAIL_PATTERN.test(trimmed)) {
      setEmailError("That doesn't look like a full email address.");
      return;
    }
    if (ratingId) {
      try {
        await attachEmail({ ratingId, email: trimmed });
      } catch {
        // The rating is already saved either way — a failed email attach isn't worth
        // blocking the thank-you on.
      }
    }
    setStep("done");
    window.setTimeout(onClose, 1400);
  };

  return (
    <ModalShell label="Rate this call" onClose={onClose}>
      {step === "stars" && (
        <>
          <h3>How was that call?</h3>
          <p>One tap tells us how the assistant did.</p>
          <StarPicker value={rating} disabled={saving} onSelect={selectRating} />
        </>
      )}

      {step === "email" && (
        <>
          <h3>Thanks for the feedback!</h3>
          <p>Want a copy of the transcript? Leave your email — totally optional.</p>
          <input
            className="ll-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError(null);
            }}
          />
          {emailError && <p className="ll-input-error">{emailError}</p>}
          <div className="ll-modal-actions">
            <button
              className="ll-btn-ghost"
              type="button"
              onClick={() => {
                setStep("done");
                window.setTimeout(onClose, 400);
              }}
            >
              Skip
            </button>
            <button className="ll-btn-primary" type="button" onClick={() => void finishWithEmail()}>
              Send it to me
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <>
          <h3>Got it — thank you!</h3>
          <p>Appreciate you trying Simplr.</p>
        </>
      )}
    </ModalShell>
  );
}

/**
 * Shown once, after the visitor's third completed "Try yourself" call — someone who has come
 * back twice is engaged enough to be worth a nudge toward an account.
 */
export function SignupNudgeModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell label="Create an account" onClose={onClose}>
      <h3>Liking what you see?</h3>
      <p>
        Log in for full access — your own agent, every call recorded, and a complete transcript
        history you can search any time.
      </p>
      <div className="ll-modal-actions">
        <button className="ll-btn-ghost" type="button" onClick={onClose}>
          Maybe later
        </button>
        <Link className="ll-btn-primary" href="/sign-up">
          Create free account
        </Link>
      </div>
    </ModalShell>
  );
}
