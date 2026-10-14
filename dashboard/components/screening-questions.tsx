"use client";

import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { HelpCircle, Lock, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";
import type { CoreKey } from "@/convex/coreQuestions";

type Question = Doc<"screeningQuestions">;
type AnswerKind = Question["answerKind"];
type Criterion = NonNullable<Question["criterion"]>;

const inputClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20";

const KIND_LABEL: Record<AnswerKind, string> = {
  yes_no: "Yes / No",
  number: "Number",
  choice: "One of a list",
  text: "Free text",
};

/**
 * Free text is listed last and described as recorded-only because it is the one kind that
 * cannot become a criterion — convex/qualifyRules.ts has nothing to compare prose against.
 */
const KIND_HINT: Record<AnswerKind, string> = {
  yes_no: "Sarah records a true or false.",
  number: "Sarah records a number, however the caller phrases it.",
  choice: "Sarah records whichever option the caller picks.",
  text: "Sarah records what they said. Cannot decide qualification.",
};

function criterionSummary(question: Question): string | null {
  const c = question.criterion;
  if (!c) return null;
  if (c.kind === "yes_no") return `Must answer ${c.mustBe ? "Yes" : "No"}`;
  if (c.kind === "number") {
    return c.op === "gte" ? `Must be at least ${c.value}` : `Must be no more than ${c.value}`;
  }
  return `Must be one of: ${c.allowed.join(", ")}`;
}

/**
 * The five questions Sarah has always asked. Shown alongside the manager's own so the page is
 * the complete picture of what happens on a call, rather than five invisible questions plus a
 * list of extras.
 */
export function BuiltInQuestions() {
  const builtins = useQuery(api.screening.builtins);
  const setBuiltin = useMutation(api.screening.setBuiltin);
  const toast = useToast();

  const toggle = async (key: CoreKey, enabled: boolean) => {
    try {
      await setBuiltin({ key, enabled });
      toast(enabled ? "Sarah will ask this again" : "Sarah will stop asking this");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change that.", "error");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-2">
        <Lock className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">Built-in questions</h2>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Sarah has always asked these. Two of them cannot be switched off because the
        qualification rules are built on them.
      </p>

      <div className="mt-5 space-y-2">
        {builtins === undefined ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : null}

        {builtins?.map((question) => (
          <div
            key={question.key}
            className="flex items-center gap-4 rounded-xl border border-border px-4 py-3.5"
          >
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-medium ${
                  question.enabled ? "" : "text-muted-foreground line-through"
                }`}
              >
                {question.label}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {question.canDisable ? question.asks : question.lockedReason}
              </p>
            </div>

            {question.affectsQualification ? (
              <span className="hidden shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 sm:inline">
                Affects qualification
              </span>
            ) : null}

            {question.canDisable ? (
              <button
                type="button"
                role="switch"
                aria-checked={question.enabled}
                aria-label={`Ask about ${question.label}`}
                onClick={() => void toggle(question.key as CoreKey, !question.enabled)}
                className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  question.enabled ? "bg-primary" : "bg-slate-300"
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    question.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            ) : (
              <span
                title="Required"
                className="flex h-6 w-11 shrink-0 items-center justify-center text-muted-foreground"
              >
                <Lock className="h-4 w-4" />
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ScreeningQuestions() {
  const questions = useQuery(api.screening.list);
  const remove = useMutation(api.screening.remove);
  const toast = useToast();
  const [editing, setEditing] = useState<Question | "new" | null>(null);

  const handleDelete = async (id: Id<"screeningQuestions">) => {
    await remove({ id });
    setEditing(null);
    toast("Question removed — Sarah stops asking it on the next call");
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Your questions</h2>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add question
        </button>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Saved one at a time — each change reaches Sarah before the next call.
      </p>

      <div className="mt-5 space-y-2">
        {questions === undefined ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : null}

        {questions?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No extra questions yet. Sarah asks the five built-in ones on every call.
          </p>
        ) : null}

        {questions?.map((question) => {
          const requirement = criterionSummary(question);
          return (
            <motion.button
              key={question._id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => setEditing(question)}
              className="flex w-full items-center gap-4 rounded-xl border border-border px-4 py-3.5 text-left hover:bg-blue-50/40"
            >
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${question.enabled ? "" : "text-muted-foreground line-through"}`}>
                  {question.question}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {KIND_LABEL[question.answerKind]}
                  {requirement ? ` · ${requirement}` : " · Recorded only"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  requirement
                    ? "bg-amber-50 text-amber-700"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {requirement ? "Requirement" : "Recorded"}
              </span>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {editing ? (
          <QuestionModal
            question={editing === "new" ? null : editing}
            onDelete={editing === "new" ? undefined : () => handleDelete(editing._id)}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function QuestionModal({
  question,
  onDelete,
  onClose,
}: {
  question: Question | null;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const save = useMutation(api.screening.save);
  const toast = useToast();

  const [text, setText] = useState(question?.question ?? "");
  const [answerKind, setAnswerKind] = useState<AnswerKind>(question?.answerKind ?? "yes_no");
  const [choicesText, setChoicesText] = useState((question?.choices ?? []).join(", "));
  const [enabled, setEnabled] = useState(question?.enabled ?? true);
  const [isRequirement, setIsRequirement] = useState(Boolean(question?.criterion));
  const [busy, setBusy] = useState(false);

  const initial = question?.criterion;
  const [mustBe, setMustBe] = useState(initial?.kind === "yes_no" ? initial.mustBe : true);
  const [op, setOp] = useState<"gte" | "lte">(initial?.kind === "number" ? initial.op : "gte");
  const [threshold, setThreshold] = useState(initial?.kind === "number" ? initial.value : 0);
  const [allowed, setAllowed] = useState<string[]>(
    initial?.kind === "choice" ? initial.allowed : [],
  );

  const choices = choicesText
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  // Free text can never carry a requirement — screening.save rejects it server-side too, this
  // just stops the checkbox offering something that will fail.
  const canBeRequirement = answerKind !== "text";

  const buildCriterion = (): Criterion | undefined => {
    if (!isRequirement || !canBeRequirement) return undefined;
    if (answerKind === "yes_no") return { kind: "yes_no", mustBe };
    if (answerKind === "number") return { kind: "number", op, value: threshold };
    return { kind: "choice", allowed: allowed.filter((a) => choices.includes(a)) };
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await save({
        id: question?._id,
        question: text.trim(),
        answerKind,
        choices: answerKind === "choice" ? choices : undefined,
        criterion: buildCriterion(),
        enabled,
      });
      toast(question ? "Question updated" : "Question added — Sarah will start asking it");
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save that question.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="text-lg font-bold">{question ? "Edit question" : "Add question"}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">What should Sarah ask?</span>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Do you have a co-signer?"
              className={inputClass}
            />
            <span className="mt-2 block text-xs text-muted-foreground">
              She asks it in her own words, worked into the conversation — this is the substance,
              not a script.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">Expected answer</span>
            <select
              value={answerKind}
              onChange={(event) => {
                const next = event.target.value as AnswerKind;
                setAnswerKind(next);
                if (next === "text") setIsRequirement(false);
              }}
              className={inputClass}
            >
              {(Object.keys(KIND_LABEL) as AnswerKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs text-muted-foreground">{KIND_HINT[answerKind]}</span>
          </label>

          {answerKind === "choice" ? (
            <label className="block">
              <span className="mb-2 block text-sm font-medium">Options</span>
              <input
                value={choicesText}
                onChange={(event) => setChoicesText(event.target.value)}
                placeholder="Employed, Self-employed, Student, Retired"
                className={inputClass}
              />
              <span className="mt-2 block text-xs text-muted-foreground">
                Comma separated, at least two.
              </span>
            </label>
          ) : null}

          <div className="rounded-xl border border-border p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={isRequirement}
                disabled={!canBeRequirement}
                onChange={(event) => setIsRequirement(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-blue-600 disabled:opacity-40"
              />
              <span>
                <span className="block text-sm font-medium">Use as a qualification requirement</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {canBeRequirement
                    ? "Off, the answer is just recorded on the lead. On, a caller who does not meet it is told they do not qualify."
                    : "A free-text answer can only be recorded. Pick Yes/No, a number, or a list to make it a requirement."}
                </span>
              </span>
            </label>

            {isRequirement && canBeRequirement ? (
              <div className="mt-4 border-t border-border pt-4">
                {answerKind === "yes_no" ? (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">Passing answer</span>
                    <select
                      value={mustBe ? "yes" : "no"}
                      onChange={(event) => setMustBe(event.target.value === "yes")}
                      className={inputClass}
                    >
                      <option value="yes">Must answer Yes</option>
                      <option value="no">Must answer No</option>
                    </select>
                  </label>
                ) : null}

                {answerKind === "number" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label>
                      <span className="mb-2 block text-sm font-medium">Requirement</span>
                      <select
                        value={op}
                        onChange={(event) => setOp(event.target.value as "gte" | "lte")}
                        className={inputClass}
                      >
                        <option value="gte">At least</option>
                        <option value="lte">No more than</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-2 block text-sm font-medium">Value</span>
                      <input
                        type="number"
                        value={threshold}
                        onChange={(event) => setThreshold(Number(event.target.value))}
                        className={inputClass}
                      />
                    </label>
                  </div>
                ) : null}

                {answerKind === "choice" ? (
                  <div>
                    <span className="mb-2 block text-sm font-medium">Passing answers</span>
                    {choices.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Add some options above first.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {choices.map((choice) => {
                          const on = allowed.includes(choice);
                          return (
                            <button
                              key={choice}
                              type="button"
                              onClick={() =>
                                setAllowed((current) =>
                                  on ? current.filter((c) => c !== choice) : [...current, choice],
                                )
                              }
                              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                                on
                                  ? "bg-primary text-primary-foreground"
                                  : "border border-input bg-card hover:bg-accent"
                              }`}
                            >
                              {choice}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            Ask this question
          </label>
        </div>

        <div className="flex items-center border-t border-border bg-muted/30 px-6 py-4">
          {onDelete ? (
            <button
              onClick={onDelete}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy || !text.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
