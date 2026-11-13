"use client";

import { ArrowDown, ArrowUp, CornerDownRight, GripVertical, MessageSquare, Plus, Trash2, Megaphone } from "lucide-react";
import { useMemo, useState } from "react";
import {
  FACTS,
  OPS,
  QFLOW_META,
  conditionBadge,
  dependentsOf,
  factOf,
  newId,
  orderIsValid,
  promptOrder,
  treeRows,
  visibleSteps,
  type QCond,
  type QFlowId,
  type QNode,
  type QuestionFlows,
  type Sample,
} from "@/convex/questionFlowLib";
import { Btn, IconBtn, Input, Pill, Seg, Select, Textarea, Toggle, cx } from "@/components/ui";
import { useToast } from "@/components/toast";

/**
 * The question-flow editor for one group of call types (maintenance or leasing).
 *
 * Each flow is an ordered list of steps. A step can carry "ask only if" conditions; a step whose
 * condition points at an earlier question is a follow-up and is drawn indented under it. Edit view
 * is the working surface; Diagram shows the whole branch structure read-only; the preview panel
 * plays the sequence Sarah will follow for sample answers. All of it edits the config: nothing
 * reaches a call until Save (which then updates Sarah for new calls).
 */

type Group = "maintenance" | "leasing";

const YESNO = ["yes", "no"] as const;

function shortText(s: string, max = 70): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}...` : t;
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// --- Condition editor ---------------------------------------------------------------------------------

function ConditionRow({
  cond,
  earlier,
  onChange,
  onRemove,
}: {
  cond: QCond;
  earlier: QNode[];
  onChange: (c: QCond) => void;
  onRemove: () => void;
}) {
  const parent = earlier.find((n) => n.id === cond.questionId);
  const op = OPS.find((o) => o.key === cond.op);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted p-2">
      <div className="w-40">
        <Select
          aria-label="Condition type"
          value={cond.type}
          onChange={(e) => {
            const type = e.target.value as QCond["type"];
            if (type === cond.type) return;
            onChange(
              type === "fact"
                ? { type: "fact", fact: FACTS[0].key }
                : { type: "answer", questionId: earlier[0]?.id, op: "is", value: "yes" },
            );
          }}
        >
          <option value="answer">An earlier answer</option>
          <option value="fact">The situation</option>
        </Select>
      </div>
      {cond.type === "fact" ? (
        <>
          <div className="w-56">
            <Select
              aria-label="Situation"
              value={cond.fact ?? ""}
              onChange={(e) => onChange({ ...cond, fact: e.target.value })}
            >
              {FACTS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-32">
            <Select
              aria-label="True or not true"
              value={cond.not ? "no" : "yes"}
              onChange={(e) => onChange({ ...cond, not: e.target.value === "no" })}
            >
              <option value="yes">is true</option>
              <option value="no">is not true</option>
            </Select>
          </div>
        </>
      ) : (
        <>
          <div className="w-64 max-w-full">
            <Select
              aria-label="Earlier question"
              value={cond.questionId ?? ""}
              placeholder="Pick a question"
              onChange={(e) => {
                const target = earlier.find((n) => n.id === e.target.value);
                onChange({ ...cond, questionId: e.target.value, value: target?.answerKind === "yesno" ? "yes" : cond.value });
              }}
            >
              {earlier.map((n) => (
                <option key={n.id} value={n.id}>
                  {shortText(n.text, 48)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-36">
            <Select
              aria-label="Comparison"
              value={cond.op ?? "is"}
              onChange={(e) => onChange({ ...cond, op: e.target.value as QCond["op"] })}
            >
              {OPS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          {op?.needsValue ? (
            parent?.answerKind === "yesno" && cond.op !== "contains" ? (
              <div className="w-24">
                <Select aria-label="Value" value={cond.value ?? "yes"} onChange={(e) => onChange({ ...cond, value: e.target.value })}>
                  {YESNO.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <Input
                aria-label="Value"
                className="w-40"
                maxLength={200}
                placeholder="value"
                value={cond.value ?? ""}
                onChange={(e) => onChange({ ...cond, value: e.target.value })}
              />
            )
          ) : null}
        </>
      )}
      <IconBtn label="Remove condition" onClick={onRemove}>
        <Trash2 />
      </IconBtn>
    </div>
  );
}

// --- One step card ---------------------------------------------------------------------------------------

function StepCard({
  nodes,
  row,
  open,
  onToggleOpen,
  update,
  move,
  canMove,
  remove,
  addFollowUp,
  dragProps,
  dropping,
}: {
  nodes: QNode[];
  row: { node: QNode; index: number; depth: number };
  open: boolean;
  onToggleOpen: () => void;
  update: (patch: Partial<QNode>) => void;
  move: (dir: -1 | 1) => void;
  canMove: (dir: -1 | 1) => boolean;
  remove: () => void;
  addFollowUp: () => void;
  dragProps: {
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  dropping: boolean;
}) {
  const { node, index, depth } = row;
  const when = node.when ?? [];
  const earlier = nodes.slice(0, index).filter((n) => n.kind === "ask");
  const setWhen = (next: QCond[]) => update({ when: next.length ? next : undefined });
  const isAsk = node.kind === "ask";

  return (
    <div
      className="relative"
      style={{ marginLeft: `${Math.min(depth, 4) * 28}px` }}
      onDragOver={dragProps.onDragOver}
      onDrop={dragProps.onDrop}
    >
      {depth > 0 ? (
        <span
          aria-hidden
          className="absolute -left-[18px] top-0 h-7 w-4 rounded-bl-xl border-b-2 border-l-2 border-border-strong"
        />
      ) : null}
      <div
        className={cx(
          "rounded-2xl border bg-card p-3 transition-colors",
          dropping ? "border-primary bg-accent" : "border-border",
          when.length > 0 && "border-l-4 border-l-warning-ink/60",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            draggable
            onDragStart={dragProps.onDragStart}
            onDragEnd={dragProps.onDragEnd}
            title="Drag to reorder"
            aria-label="Drag to reorder"
            className="cursor-grab text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </span>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground px-1.5 text-xs font-semibold text-background">
            {index + 1}
          </span>
          <Pill tone={isAsk ? "acc" : "vio"}>
            {isAsk ? <MessageSquare className="h-3 w-3" /> : <Megaphone className="h-3 w-3" />}
            {isAsk ? "Ask" : "Say"}
          </Pill>
          <Seg
            label="Required or optional"
            value={node.required ? "req" : "opt"}
            onChange={(v) => update({ required: v === "req" })}
            options={[
              { value: "req", label: "Required" },
              { value: "opt", label: "Optional" },
            ]}
          />
          <span className="ml-auto flex items-center gap-1">
            <IconBtn label="Move up" disabled={!canMove(-1)} onClick={() => move(-1)}>
              <ArrowUp />
            </IconBtn>
            <IconBtn label="Move down" disabled={!canMove(1)} onClick={() => move(1)}>
              <ArrowDown />
            </IconBtn>
            <IconBtn label="Delete step" onClick={remove} className="text-danger-ink">
              <Trash2 />
            </IconBtn>
          </span>
        </div>

        <Textarea
          aria-label={isAsk ? "Question Sarah asks" : "What Sarah says"}
          className="mt-2 min-h-[44px]"
          rows={2}
          maxLength={400}
          value={node.text}
          onChange={(e) => update({ text: e.target.value })}
        />

        {when.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Ask only if</span>
            {when.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span className="text-xs text-muted-foreground">and</span> : null}
                <Pill tone="warn">{conditionBadge(c, nodes)}</Pill>
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn sm onClick={onToggleOpen} aria-expanded={open}>
            {open ? "Hide condition" : when.length ? "Edit condition" : "Add condition"}
          </Btn>
          {isAsk ? (
            <Btn sm onClick={addFollowUp}>
              <CornerDownRight className="h-3.5 w-3.5" /> Add follow-up
            </Btn>
          ) : null}
          {isAsk ? (
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              Answer type
              <span className="w-24">
                <Select
                  aria-label="Answer type"
                  value={node.answerKind ?? "text"}
                  onChange={(e) => update({ answerKind: e.target.value === "yesno" ? "yesno" : undefined })}
                >
                  <option value="text">Free text</option>
                  <option value="yesno">Yes / no</option>
                </Select>
              </span>
            </label>
          ) : null}
        </div>

        {open ? (
          <div className="mt-2 space-y-2">
            {when.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No condition: Sarah asks this every time (unless it is already answered or known).
              </p>
            ) : null}
            {when.map((c, i) => (
              <ConditionRow
                key={i}
                cond={c}
                earlier={earlier}
                onChange={(next) => setWhen(when.map((x, k) => (k === i ? next : x)))}
                onRemove={() => setWhen(when.filter((_, k) => k !== i))}
              />
            ))}
            {when.length < 3 ? (
              <Btn
                sm
                onClick={() =>
                  setWhen([
                    ...when,
                    earlier.length
                      ? { type: "answer", questionId: earlier[earlier.length - 1].id, op: "is", value: "yes" }
                      : { type: "fact", fact: FACTS[0].key },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add another condition
              </Btn>
            ) : (
              <p className="text-xs text-muted-foreground">Three conditions is the most (all must hold).</p>
            )}
            <Input
              aria-label="Where the answer is recorded"
              className="max-w-sm"
              maxLength={80}
              placeholder="Record the answer in (optional), e.g. first_noticed"
              value={node.field ?? ""}
              onChange={(e) => update({ field: e.target.value || undefined })}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Diagram (read-only) -----------------------------------------------------------------------------------

function stepLine(n: QNode, nodes: QNode[]): { cond: string; body: string } {
  const cond = (n.when ?? []).map((c) => conditionBadge(c, nodes)).join(" AND ");
  return { cond, body: `${n.kind === "ask" ? "ask" : "say"}: ${shortText(n.text, 90)}` };
}

function DiagramFlow({ nodes }: { nodes: QNode[] }) {
  const rows = treeRows(nodes);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No steps.</p>;
  return (
    <ol className="space-y-1.5">
      {rows.map(({ node, index, depth }) => {
        const { cond, body } = stepLine(node, nodes);
        return (
          <li key={node.id} className="relative flex flex-wrap items-center gap-1.5 text-sm" style={{ marginLeft: `${Math.min(depth, 4) * 24}px` }}>
            {depth > 0 ? (
              <span aria-hidden className="absolute -left-4 top-0 h-3.5 w-3 rounded-bl-lg border-b-2 border-l-2 border-border-strong" />
            ) : null}
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-semibold text-background">
              {index + 1}
            </span>
            {cond ? <Pill tone="warn">IF {cond}</Pill> : null}
            {cond ? <span className="text-muted-foreground">→</span> : null}
            <span>{body}</span>
            <Pill tone={node.required ? "acc" : "neutral"}>{node.required ? "Required" : "Optional"}</Pill>
          </li>
        );
      })}
    </ol>
  );
}

function Diagram({ group, flows }: { group: Group; flows: QuestionFlows }) {
  const metas = QFLOW_META.filter((m) => m.group === group);
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        The whole structure in one view. Indented steps are follow-ups: Sarah only asks them when their condition holds.
        Optional steps always come after the required ones.
      </p>
      {metas.map((m) => (
        <div key={m.id} className="rounded-2xl border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{m.label}</span>
            {m.gate ? <Pill tone="warn">{m.gate}</Pill> : <Pill>{m.applies}</Pill>}
          </div>
          <DiagramFlow nodes={flows[m.id]} />
        </div>
      ))}
    </div>
  );
}

// --- Preview ---------------------------------------------------------------------------------------------

function defaultSample(nodes: QNode[]): Sample {
  const answers: Sample["answers"] = {};
  for (const n of nodes) if (n.kind === "ask" && n.answerKind === "yesno") answers[n.id] = "yes";
  return { answers, facts: {} };
}

function Preview({ nodes, sample, setSample }: { nodes: QNode[]; sample: Sample; setSample: (s: Sample) => void }) {
  const referenced = useMemo(() => {
    const ids = new Set<string>();
    const facts = new Set<string>();
    for (const n of nodes) {
      for (const c of n.when ?? []) {
        if (c.type === "answer" && c.questionId) ids.add(c.questionId);
        if (c.type === "fact" && c.fact) facts.add(c.fact);
      }
    }
    return { questions: nodes.filter((n) => ids.has(n.id)), facts: FACTS.filter((f) => facts.has(f.key)) };
  }, [nodes]);

  const visible = useMemo(() => visibleSteps(nodes, sample), [nodes, sample]);
  const shown = new Set(visible.map((v) => v.node.id));
  const ordered = promptOrder(visible);
  const skipped = nodes.map((node, index) => ({ node, index })).filter((r) => !shown.has(r.node.id));

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/40 p-3">
      <div className="text-sm font-semibold">Preview the conversation</div>
      <p className="text-xs text-muted-foreground">
        Change the sample answers to see steps appear and disappear. This is the order Sarah follows, one question per turn.
      </p>

      {referenced.questions.length + referenced.facts.length > 0 ? (
        <div className="space-y-2 rounded-xl bg-card p-2.5">
          {referenced.questions.map((q) => {
            const val = sample.answers[q.id];
            const yesno = q.answerKind === "yesno";
            return (
              <div key={q.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-40 flex-1">If the caller says, to &ldquo;{shortText(q.text, 50)}&rdquo;:</span>
                {yesno ? (
                  <div className="w-36">
                    <Select
                      aria-label={`Sample answer for ${shortText(q.text, 30)}`}
                      value={val ?? "yes"}
                      onChange={(e) => setSample({ ...sample, answers: { ...sample.answers, [q.id]: e.target.value } })}
                    >
                      <option value="yes">yes</option>
                      <option value="no">no</option>
                      <option value="">no answer</option>
                    </Select>
                  </div>
                ) : (
                  <Input
                    aria-label={`Sample answer for ${shortText(q.text, 30)}`}
                    className="w-44"
                    placeholder="type a sample answer"
                    value={val ?? ""}
                    onChange={(e) =>
                      setSample({ ...sample, answers: { ...sample.answers, [q.id]: e.target.value === "" ? undefined : e.target.value } })
                    }
                  />
                )}
              </div>
            );
          })}
          {referenced.facts.map((f) => (
            <div key={f.key} className="flex items-center gap-2 text-sm">
              <Toggle
                label={f.label}
                checked={!!sample.facts[f.key]}
                onChange={(on) => setSample({ ...sample, facts: { ...sample.facts, [f.key]: on } })}
              />
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">This flow has no conditions yet: every step is always asked.</p>
      )}

      <ol className="space-y-1.5">
        {ordered.map(({ node, index }, i) => (
          <li key={node.id} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-muted-foreground">{node.kind === "ask" ? "Sarah asks: " : "Sarah says: "}</span>
              {node.text}
            </span>
            <Pill tone={node.required ? "acc" : "neutral"}>{node.required ? "Required" : "Optional"}</Pill>
            <span className="sr-only">Step {index + 1} in the list</span>
          </li>
        ))}
        {ordered.length === 0 ? <li className="text-sm text-muted-foreground">Sarah asks nothing for this sample.</li> : null}
      </ol>

      {skipped.length > 0 ? (
        <div className="border-t border-border pt-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Skipped for this sample ({skipped.length})</div>
          <ul className="space-y-1">
            {skipped.map(({ node }) => (
              <li key={node.id} className="text-xs text-muted-foreground line-through">
                {shortText(node.text, 90)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// --- The editor ----------------------------------------------------------------------------------------------

export function QuestionFlowEditor({
  group,
  flows,
  onChange,
}: {
  group: Group;
  flows: QuestionFlows;
  onChange: (next: QuestionFlows) => void;
}) {
  const toast = useToast();
  const metas = QFLOW_META.filter((m) => m.group === group);
  const [active, setActive] = useState<QFlowId>(metas[0].id);
  const [view, setView] = useState<"edit" | "diagram">("edit");
  const [openCond, setOpenCond] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [samples, setSamples] = useState<Partial<Record<QFlowId, Sample>>>({});

  const meta = metas.find((m) => m.id === active) ?? metas[0];
  const nodes = flows[meta.id];
  const rows = useMemo(() => treeRows(nodes), [nodes]);
  const sample = samples[meta.id] ?? defaultSample(nodes);

  const setNodes = (next: QNode[]) => onChange({ ...flows, [meta.id]: next });
  const update = (i: number, patch: Partial<QNode>) => setNodes(nodes.map((n, k) => (k === i ? { ...n, ...patch } : n)));

  const canMove = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= nodes.length) return false;
    return orderIsValid(moveItem(nodes, i, j));
  };
  const move = (i: number, dir: -1 | 1) => {
    if (canMove(i, dir)) setNodes(moveItem(nodes, i, i + dir));
  };
  const dropOn = (to: number) => {
    const from = dragFrom;
    setDragFrom(null);
    setDropAt(null);
    if (from === null || from === to) return;
    const next = moveItem(nodes, from, to);
    if (!orderIsValid(next)) {
      toast("A follow-up has to stay after the question it depends on.", "error");
      return;
    }
    setNodes(next);
  };

  const remove = (i: number) => {
    const gone = new Set([nodes[i].id, ...dependentsOf(nodes, nodes[i].id)]);
    setNodes(nodes.filter((n) => !gone.has(n.id)));
    if (gone.size > 1) toast(`Removed this step and ${gone.size - 1} follow-up${gone.size > 2 ? "s" : ""} that depended on it.`, "success");
  };

  const addEnd = (kind: QNode["kind"]) => {
    const id = newId(nodes, kind === "ask" ? "q" : "s");
    setNodes([...nodes, { id, kind, text: "", required: false }]);
    setOpenCond(null);
  };

  const addFollowUp = (i: number) => {
    const parent = nodes[i];
    const gone = dependentsOf(nodes, parent.id);
    let last = i;
    nodes.forEach((n, k) => {
      if (gone.has(n.id) && k > last) last = k;
    });
    const id = newId(nodes);
    const follow: QNode = {
      id,
      kind: "ask",
      text: "",
      required: false,
      when: [{ type: "answer", questionId: parent.id, op: parent.answerKind === "yesno" ? "is" : "answered", ...(parent.answerKind === "yesno" ? { value: "yes" } : {}) }],
    };
    const next = [...nodes.slice(0, last + 1), follow, ...nodes.slice(last + 1)];
    setNodes(next);
    setOpenCond(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto">
          <Seg
            label="Question flow"
            value={active}
            onChange={(v) => {
              setActive(v);
              setOpenCond(null);
            }}
            options={metas.map((m) => ({ value: m.id, label: m.label }))}
          />
        </div>
        <span className="ml-auto" />
        <Seg
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "edit", label: "Edit steps" },
            { value: "diagram", label: "Diagram" },
          ]}
        />
      </div>

      {view === "diagram" ? (
        <Diagram group={group} flows={flows} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{meta.label}</span>
              {meta.gate ? <Pill tone="warn">{meta.gate}</Pill> : null}
              <span className="text-muted-foreground">Used when {meta.applies}.</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Sarah goes down these steps in order, one question per turn. A step marked Optional only comes after every
              Required step. A follow-up is asked only when its condition holds. Skipped automatically: anything the caller
              already told her.
            </p>

            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No steps. Sarah will ask nothing for this flow. Add a question below.
              </p>
            ) : null}

            <div className="space-y-2.5">
              {rows.map((row) => (
                <StepCard
                  key={row.node.id}
                  nodes={nodes}
                  row={row}
                  open={openCond === row.node.id}
                  onToggleOpen={() => setOpenCond(openCond === row.node.id ? null : row.node.id)}
                  update={(patch) => update(row.index, patch)}
                  move={(dir) => move(row.index, dir)}
                  canMove={(dir) => canMove(row.index, dir)}
                  remove={() => remove(row.index)}
                  addFollowUp={() => addFollowUp(row.index)}
                  dropping={dropAt === row.index && dragFrom !== null && dragFrom !== row.index}
                  dragProps={{
                    onDragStart: (e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", row.node.id);
                      setDragFrom(row.index);
                    },
                    onDragEnd: () => {
                      setDragFrom(null);
                      setDropAt(null);
                    },
                    onDragOver: (e) => {
                      if (dragFrom === null) return;
                      e.preventDefault();
                      setDropAt(row.index);
                    },
                    onDrop: (e) => {
                      e.preventDefault();
                      dropOn(row.index);
                    },
                  }}
                />
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => addEnd("ask")}>
                <Plus className="h-4 w-4" /> Add question
              </Btn>
              <Btn onClick={() => addEnd("say")}>
                <Plus className="h-4 w-4" /> Add statement
              </Btn>
              <Btn
                variant="dng"
                onClick={() => {
                  setNodes([]);
                  setOpenCond(null);
                }}
                disabled={nodes.length === 0}
              >
                Clear all
              </Btn>
            </div>
          </div>

          <div className="xl:sticky xl:top-4 xl:self-start">
            <Preview nodes={nodes} sample={sample} setSample={(s) => setSamples((prev) => ({ ...prev, [meta.id]: s }))} />
            {nodes.some((n) => !n.text.trim()) ? (
              <p className="mt-2 text-xs text-danger-ink">Every step needs wording before you can save.</p>
            ) : null}
            {nodes.some((n) => (n.when ?? []).some((c) => c.type === "fact" && !factOf(c.fact ?? ""))) ? (
              <p className="mt-2 text-xs text-danger-ink">A condition uses a situation that no longer exists.</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
