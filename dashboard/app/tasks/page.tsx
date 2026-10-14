"use client";

import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlignLeft,
  Bold,
  Calendar,
  ChevronDown,
  Italic,
  Link as LinkIcon,
  List as ListIcon,
  Paperclip,
  Plus,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";
import { Dropdown } from "@/components/ui/dropdown";

type Status = "todo" | "in_progress" | "completed";
type Priority = "low" | "medium" | "high";

type Task = {
  _id: Id<"tasks">;
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  category?: string;
  dueDate?: number;
  tags?: string[];
};

type Attachment = {
  _id: Id<"taskAttachments">;
  fileName: string;
  url?: string | null;
  uploadedByName?: string;
};

const STATUS_META: Record<Status, { label: string; dotClassName: string }> = {
  in_progress: { label: "In Progress", dotClassName: "bg-blue-500" },
  todo: { label: "Todo", dotClassName: "bg-slate-300" },
  completed: { label: "Completed", dotClassName: "bg-emerald-500" },
};

const GROUPS: Array<{ status: Task["status"]; label: string; dotClassName: string }> = [
  { status: "in_progress", label: "In Progress", dotClassName: "bg-blue-500 shadow-[0_0_0_4px_rgba(219,234,254,1)]" },
  { status: "todo", label: "Todo", dotClassName: "bg-slate-300 shadow-[0_0_0_4px_rgba(241,245,249,1)]" },
  { status: "completed", label: "Completed", dotClassName: "bg-emerald-500 shadow-[0_0_0_4px_rgba(209,250,229,1)]" },
];

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  high: "bg-rose-50 text-rose-600 border border-rose-100",
  medium: "bg-amber-50 text-amber-700 border border-amber-100",
  low: "bg-emerald-50 text-emerald-600 border border-emerald-100",
};

const PRIORITY_DOT: Record<Priority, string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-rose-500",
};

const STATUS_OPTIONS = (Object.keys(STATUS_META) as Status[]).map((s) => ({
  value: s,
  label: STATUS_META[s].label,
  icon: <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_META[s].dotClassName}`} />,
}));

const PRIORITY_OPTIONS = (["low", "medium", "high"] as const).map((p) => ({
  value: p,
  label: p[0].toUpperCase() + p.slice(1),
  icon: <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[p]}`} />,
}));

const CATEGORY_TONES = [
  "bg-blue-50 text-blue-600",
  "bg-purple-50 text-purple-600",
  "bg-cyan-50 text-cyan-600",
  "bg-fuchsia-50 text-fuchsia-600",
  "bg-orange-50 text-orange-600",
];

// Keeps a task row from growing tall/wide when someone tags it heavily — the rest collapse
// into a "+N" pill (see TaskRow) rather than wrapping the row across multiple lines.
const MAX_VISIBLE_TAGS = 2;

function hashIndex(value: string, length: number) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % length;
}

function formatDueDate(dueDate?: number) {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(due, today)) return "Today";
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (sameDay(due, tomorrow)) return "Tomorrow";
  return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


export default function TasksPage() {
  const tasks = useQuery(api.tasks.list) as Task[] | undefined;
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<Id<"tasks"> | null>(null);

  const grouped = GROUPS.map((group) => ({
    ...group,
    tasks: (tasks ?? []).filter((t) => t.status === group.status),
  }));
  const selectedTask = tasks?.find((t) => t._id === selectedId) ?? null;

  return (
    <div className="space-y-8 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Tasks</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            Create and manage tasks for your team. Keep track of what needs to be done.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New task
        </button>
      </header>

      {tasks?.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          No tasks yet. Add one to start tracking what your team needs to do.
        </div>
      ) : null}

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <div className="flex w-full flex-col gap-4 xl:flex-1">
          {grouped.map((group) =>
            group.tasks.length === 0 && tasks?.length === 0 ? null : (
              <TaskGroup
                key={group.status}
                label={group.label}
                dotClassName={group.dotClassName}
                tasks={group.tasks}
                selectedId={selectedId}
                onToggle={(id) => void toggleComplete({ taskId: id })}
                onSelect={setSelectedId}
              />
            ),
          )}
        </div>

        {selectedTask ? (
          <div className="w-full shrink-0 xl:sticky xl:top-6 xl:w-[420px]">
            <TaskDetailPanel key={selectedTask._id} task={selectedTask} onClose={() => setSelectedId(null)} />
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {modalOpen ? (
          <NewTaskModal
            onClose={() => setModalOpen(false)}
            onCreated={() => {
              toast("Task added");
              setModalOpen(false);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TaskGroup({
  label,
  dotClassName,
  tasks,
  selectedId,
  onToggle,
  onSelect,
}: {
  label: string;
  dotClassName: string;
  tasks: Task[];
  selectedId: Id<"tasks"> | null;
  onToggle: (id: Id<"tasks">) => void;
  onSelect: (id: Id<"tasks">) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between border-b border-border/70 bg-muted/30 px-4 py-3"
      >
        <div className="flex items-center gap-2.5">
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
          <span className={`h-2.5 w-2.5 rounded-full ${dotClassName}`} />
          <span className="text-sm font-semibold text-foreground">{label}</span>
          <span className="text-sm font-medium text-muted-foreground">{tasks.length}</span>
        </div>
      </button>

      {!collapsed ? (
        tasks.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing here.</div>
        ) : (
          <div className="flex flex-col">
            {tasks.map((task, index) => (
              <TaskRow
                key={task._id}
                task={task}
                bordered={index > 0}
                selected={task._id === selectedId}
                onToggle={() => onToggle(task._id)}
                onSelect={() => onSelect(task._id)}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  bordered,
  selected,
  onToggle,
  onSelect,
}: {
  task: Task;
  bordered: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const done = task.status === "completed";
  const due = formatDueDate(task.dueDate);
  const categoryTone = task.category ? CATEGORY_TONES[hashIndex(task.category, CATEGORY_TONES.length)] : null;

  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer flex-col gap-3 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
        bordered ? "border-t border-border/70" : ""
      } ${selected ? "bg-primary/5" : "hover:bg-muted/30"}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          aria-label={done ? "Mark as not done" : "Mark as done"}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
            done ? "border-primary bg-primary" : "border-input hover:border-primary"
          }`}
        >
          {done ? <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" /> : null}
        </button>
        <span
          className={`truncate text-sm ${
            done ? "text-muted-foreground line-through" : "font-medium text-foreground"
          }`}
        >
          {task.title}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        <span className={`rounded px-2 py-1 text-[11px] font-medium ${PRIORITY_STYLES[task.priority]}`}>
          {task.priority[0].toUpperCase() + task.priority.slice(1)}
        </span>
        {task.category ? (
          <span className={`rounded px-2.5 py-1 text-[11px] font-medium ${categoryTone}`}>{task.category}</span>
        ) : null}
        {(task.tags ?? []).slice(0, MAX_VISIBLE_TAGS).map((tag) => (
          <span
            key={tag}
            className={`rounded px-2.5 py-1 text-[11px] font-medium ${CATEGORY_TONES[hashIndex(tag, CATEGORY_TONES.length)]}`}
          >
            {tag}
          </span>
        ))}
        {(task.tags?.length ?? 0) > MAX_VISIBLE_TAGS ? (
          <span className="rounded bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
            +{(task.tags?.length ?? 0) - MAX_VISIBLE_TAGS}
          </span>
        ) : null}
        <span className="w-12 text-right text-xs text-muted-foreground">{due ?? ""}</span>
      </div>
    </div>
  );
}

function toDateInputValue(ms?: number) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function TaskDetailPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const update = useMutation(api.tasks.update);
  const toggleComplete = useMutation(api.tasks.toggleComplete);
  const attachments = useQuery(api.tasks.attachments, { taskId: task._id }) as Attachment[] | undefined;
  const generateUploadUrl = useMutation(api.tasks.generateUploadUrl);
  const attach = useMutation(api.tasks.attach);
  const removeAttachment = useMutation(api.tasks.removeAttachment);
  const toast = useToast();

  const [description, setDescription] = useState(task.description ?? "");
  const [newTag, setNewTag] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [uploading, setUploading] = useState(false);

  const patch = async (fields: Parameters<typeof update>[0]) => {
    try {
      await update(fields);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update the task.", "error");
    }
  };

  const handleAttachFiles = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploadUrl = await generateUploadUrl();
        const uploaded = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!uploaded.ok) throw new Error("Could not upload the file.");
        const { storageId } = (await uploaded.json()) as { storageId: Id<"_storage"> };
        await attach({ storageId, fileName: file.name, taskId: task._id });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not attach that file.", "error");
    } finally {
      setUploading(false);
    }
  };

  const tags = task.tags ?? [];

  const handleAddTag = async () => {
    const value = newTag.trim();
    if (!value || tags.includes(value)) {
      setNewTag("");
      setAddingTag(false);
      return;
    }
    await patch({ taskId: task._id, tags: [...tags, value] });
    setNewTag("");
    setAddingTag(false);
  };

  const handleRemoveTag = async (tag: string) => {
    await patch({ taskId: task._id, tags: tags.filter((t) => t !== tag) });
  };

  return (
    <motion.div
      key={task._id}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      className="flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => void toggleComplete({ taskId: task._id })}
            aria-label={task.status === "completed" ? "Mark as not done" : "Mark as done"}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
              task.status === "completed" ? "border-primary bg-primary" : "border-input hover:border-primary"
            }`}
          >
            {task.status === "completed" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
            ) : null}
          </button>
          <h2 className="text-base font-bold leading-tight text-foreground">{task.title}</h2>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-5 px-5 py-5">
          <RichTextEditor
            value={description}
            onChange={setDescription}
            onBlur={() => {
              const clean = sanitizeHtml(description);
              if (clean !== sanitizeHtml(task.description ?? "")) {
                void patch({ taskId: task._id, description: htmlIsBlank(clean) ? "" : clean });
              }
            }}
            placeholder="Add a description…"
            onAttachFiles={(files) => void handleAttachFiles(files)}
            uploading={uploading}
          />

          <AttachmentList
            attachments={attachments ?? []}
            onRemove={(id) => void removeAttachment({ attachmentId: id })}
          />

          <div className="grid grid-cols-[88px_1fr] items-center gap-y-4 text-sm">
            <span className="text-muted-foreground">Status</span>
            <Dropdown
              value={task.status}
              options={STATUS_OPTIONS}
              onChange={(status) => void patch({ taskId: task._id, status })}
              buttonClassName="h-9"
            />

            <span className="text-muted-foreground">Priority</span>
            <Dropdown
              value={task.priority}
              options={PRIORITY_OPTIONS}
              onChange={(priority) => void patch({ taskId: task._id, priority })}
              buttonClassName="h-9"
            />


            <span className="text-muted-foreground">Due date</span>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="date"
                  value={toDateInputValue(task.dueDate)}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    void patch({ taskId: task._id, dueDate: new Date(value).getTime() });
                  }}
                  className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              {task.dueDate ? (
                <button
                  type="button"
                  onClick={() => void patch({ taskId: task._id, clearDueDate: true })}
                  aria-label="Clear due date"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <span className="text-muted-foreground">Tags</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => void handleRemoveTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    className="text-blue-400 hover:text-blue-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {addingTag ? (
                <input
                  autoFocus
                  value={newTag}
                  onChange={(event) => setNewTag(event.target.value)}
                  onBlur={() => void handleAddTag()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleAddTag();
                    if (event.key === "Escape") {
                      setNewTag("");
                      setAddingTag(false);
                    }
                  }}
                  placeholder="Tag name"
                  className="h-7 w-24 rounded border border-input bg-card px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTag(true)}
                  className="flex items-center gap-1 rounded border border-dashed border-input px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                >
                  <Tag className="h-3 w-3" />
                  Add tag
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bold;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Keeps focus (and the current selection/caret) on the editor instead of moving it to
      // this button — without this, clicking Bold would first blur the editor and lose the
      // selection execCommand needs to act on.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/** Strict allowlist run before any editor HTML is sent to Convex: unwraps any element that
 * isn't in ALLOWED_TAGS to plain text and drops every attribute except a validated `href` on
 * `<a>`. Runs client-side only (DOMParser) — this page never renders untrusted HTML from
 * elsewhere, but user-authored HTML from execCommand shouldn't be trusted verbatim either. */
function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return html;
  const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "A", "UL", "OL", "LI", "BR", "DIV", "P", "SPAN"]);
  const doc = new DOMParser().parseFromString(html, "text/html");

  const safeHrefs = new Map<Element, string>();
  doc.body.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) safeHrefs.set(a, href);
  });

  const clean = (node: Element) => {
    Array.from(node.children).forEach((child) => {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent ?? ""));
        return;
      }
      Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
      clean(child);
    });
  };
  clean(doc.body);

  doc.body.querySelectorAll("a").forEach((a) => {
    const href = safeHrefs.get(a);
    if (href) {
      a.setAttribute("href", href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noreferrer");
    } else {
      a.replaceWith(document.createTextNode(a.textContent ?? ""));
    }
  });

  return doc.body.innerHTML;
}

/**
 * True once tags are stripped and only whitespace is left — used to tell "no description" from
 * "described something", since an empty contentEditable still saves as e.g. "<div><br></div>".
 *
 * A list is treated as never blank even with no text yet: clicking Bullet/Numbered list on an
 * empty editor produces "<ol><li><br></li></ol>", which strips down to nothing but still
 * renders a real, visible "1." marker — if this function still called that blank, the
 * placeholder `<span>` this drives would keep showing and visually overlap that marker.
 */
function htmlIsBlank(html: string) {
  if (/<(ol|ul|li)[\s>]/i.test(html)) return false;
  return html.replace(/<[^>]*>/g, "").trim().length === 0;
}

/**
 * A real WYSIWYG editor for the task description, backed by the browser's own `execCommand` —
 * Bold/Italic/lists/links apply actual formatting instead of inserting literal markdown
 * characters (the earlier version showed the user raw "**text**"/"[x](y)" syntax, which read as
 * broken). Attach files uploads straight to Convex storage through `onAttachFiles`, which the
 * caller wires to either a pending (pre-task) or a task-linked attach mutation.
 */
function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  onAttachFiles,
  uploading,
}: {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder: string;
  onAttachFiles: (files: FileList) => void;
  uploading: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(htmlIsBlank(value));

  // Sets the starting content imperatively, once, instead of through JSX (no
  // dangerouslySetInnerHTML on the element below at all). That matters because JSX
  // children/dangerouslySetInnerHTML are something React tracks per element and can decide to
  // re-apply on a later render — which would mean fighting the DOM the browser is actively
  // editing and losing the caret. Writing the initial HTML directly to the node here, and never
  // describing this element's contents to React at all, means React has nothing to reconcile
  // here on subsequent renders and leaves it alone.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = value;
    // Intentionally empty deps: this sets the *starting* content only. A later task/value
    // change is handled by the caller remounting this component via a `key`, not by this
    // effect re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusEditor = () => editorRef.current?.focus();

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const handleInput = () => {
    const html = editorRef.current?.innerHTML ?? "";
    setEmpty(htmlIsBlank(html));
    onChange(html);
  };

  const exec = (command: string, arg?: string) => {
    focusEditor();
    document.execCommand(command, false, arg);
    handleInput();
  };

  const handleLink = () => {
    saveSelection();
    const url = window.prompt("Link URL");
    if (!url) return;
    focusEditor();
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      document.execCommand("insertHTML", false, `<a href="${url}">${url}</a>`);
    } else {
      document.execCommand("createLink", false, url);
    }
    handleInput();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-input">
      <div className="relative">
        {/* No children and no dangerouslySetInnerHTML here on purpose — see the mount effect
            above for why. */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={onBlur}
          className="min-h-24 w-full px-3 py-3 text-sm leading-6 outline-none [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
        />
        {empty ? (
          <span className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground-subtle">
            {placeholder}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <ToolbarButton icon={Bold} label="Bold" onClick={() => exec("bold")} />
          <ToolbarButton icon={Italic} label="Italic" onClick={() => exec("italic")} />
          <ToolbarButton icon={LinkIcon} label="Link" onClick={handleLink} />
          <ToolbarButton icon={AlignLeft} label="Numbered list" onClick={() => exec("insertOrderedList")} />
          <ToolbarButton icon={ListIcon} label="Bullet list" onClick={() => exec("insertUnorderedList")} />
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent">
          <Paperclip className="h-3.5 w-3.5" />
          {uploading ? "Uploading…" : "Attach files"}
          <input
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              if (event.target.files?.length) onAttachFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (id: Id<"taskAttachments">) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a) => (
        <div
          key={a._id}
          className="flex items-center gap-1.5 rounded-lg border border-input bg-muted/30 px-2.5 py-1.5 text-xs"
        >
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          {a.url ? (
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-[160px] truncate text-foreground hover:underline"
            >
              {a.fileName}
            </a>
          ) : (
            <span className="max-w-[160px] truncate text-foreground">{a.fileName}</span>
          )}
          <button
            type="button"
            onClick={() => onRemove(a._id)}
            aria-label={`Remove ${a.fileName}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function NewTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const create = useMutation(api.tasks.create);
  const generateUploadUrl = useMutation(api.tasks.generateUploadUrl);
  const attach = useMutation(api.tasks.attach);
  const removeAttachment = useMutation(api.tasks.removeAttachment);
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleAddTag = () => {
    const value = newTag.trim();
    if (value && !tags.includes(value)) setTags((current) => [...current, value]);
    setNewTag("");
    setAddingTag(false);
  };

  // Uploaded before the task exists, so each one is a standalone taskAttachments row with no
  // taskId yet — `create` below links them all to the new task right after inserting it.
  const handleAttachFiles = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploadUrl = await generateUploadUrl();
        const uploaded = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!uploaded.ok) throw new Error("Could not upload the file.");
        const { storageId } = (await uploaded.json()) as { storageId: Id<"_storage"> };
        const attachmentId = await attach({ storageId, fileName: file.name });
        setAttachments((current) => [...current, { _id: attachmentId, fileName: file.name }]);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not attach that file.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAttachment = (id: Id<"taskAttachments">) => {
    setAttachments((current) => current.filter((a) => a._id !== id));
    void removeAttachment({ attachmentId: id }).catch(() => {});
  };

  // A cancelled create shouldn't leave orphaned uploads sitting in storage with no task to
  // ever claim them.
  const handleClose = () => {
    for (const a of attachments) void removeAttachment({ attachmentId: a._id }).catch(() => {});
    onClose();
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const cleanDescription = sanitizeHtml(description);
      await create({
        title: title.trim(),
        description: htmlIsBlank(cleanDescription) ? undefined : cleanDescription,
        status,
        priority,
        dueDate: dueDate ? new Date(dueDate).getTime() : undefined,
        tags: tags.length ? tags : undefined,
        attachmentIds: attachments.map((a) => a._id),
      });
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add that task.", "error");
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
      onClick={handleClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="text-lg font-bold">Create task</h2>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title…"
            autoFocus
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base font-medium outline-none placeholder:text-muted-foreground-subtle placeholder:font-normal focus:ring-2 focus:ring-ring/20"
          />

          <RichTextEditor
            value={description}
            onChange={setDescription}
            placeholder="Add a description, details, or instructions…"
            onAttachFiles={(files) => void handleAttachFiles(files)}
            uploading={uploading}
          />

          <AttachmentList attachments={attachments} onRemove={handleRemoveAttachment} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium">Status</span>
              <Dropdown value={status} options={STATUS_OPTIONS} onChange={setStatus} />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium">Priority</span>
              <Dropdown value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium">Due date</span>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
            </label>

            <div className="block">
              <span className="mb-2 block text-sm font-medium">Labels</span>
              <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-card px-2 py-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags((current) => current.filter((t) => t !== tag))}
                      aria-label={`Remove tag ${tag}`}
                      className="text-blue-400 hover:text-blue-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {addingTag ? (
                  <input
                    autoFocus
                    value={newTag}
                    onChange={(event) => setNewTag(event.target.value)}
                    onBlur={handleAddTag}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleAddTag();
                      if (event.key === "Escape") {
                        setNewTag("");
                        setAddingTag(false);
                      }
                    }}
                    placeholder="Tag name"
                    className="h-7 w-20 rounded border border-input bg-card px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring/20"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTag(true)}
                    className="flex items-center gap-1 rounded border border-dashed border-input px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                  >
                    <Tag className="h-3 w-3" />
                    Add tag
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-6 py-4">
          <button
            onClick={handleClose}
            className="rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !title.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
