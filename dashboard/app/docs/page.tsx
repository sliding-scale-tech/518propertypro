"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  Lightbulb,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/toast";

const SYNC_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: "Queued", className: "bg-muted text-muted-foreground" },
  indexing: { label: "Indexing…", className: "bg-amber-50 text-amber-700" },
  synced: { label: "Live", className: "bg-emerald-50 text-emerald-600" },
  failed: { label: "Failed", className: "bg-red-50 text-red-600" },
};

const CARD_TONES = [
  { icon: FileText, className: "bg-blue-50 text-blue-600" },
  { icon: FileText, className: "bg-fuchsia-50 text-fuchsia-600" },
  { icon: ShoppingBag, className: "bg-orange-50 text-orange-500" },
] as const;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ACCEPTED_UPLOAD =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Doc = {
  _id: Id<"docs">;
  title: string;
  body: string;
  syncState: string;
  syncError?: string;
  updatedAt: number;
};

function relativeDate(timestamp: number) {
  if (!timestamp) return "Updated recently";
  const delta = Math.max(0, Date.now() - timestamp);
  const days = Math.floor(delta / 86_400_000);
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${days} days ago`;
}

export default function DocsPage() {
  const docs = useQuery(api.docs.list);
  const save = useMutation(api.docs.save);
  const remove = useAction(api.docs.remove);
  const ensureSeeded = useAction(api.agents.ensureSeeded);
  const toast = useToast();
  const [selected, setSelected] = useState<Doc | "new" | null>(null);
  const seedAttempted = useRef(false);

  // A brand-new team has no agent row yet, so docs.list legitimately returns [] until one of
  // mintToken / Settings-save / this runs agents.ensure to clone the template's knowledge
  // base. Firing it here means landing on this tab is enough — no need to start a call first.
  // Guarded to once per mount: docs is a fresh array reference on every reactive update, and
  // ensureSeeded, while idempotent server-side, has no reason to be called more than once.
  useEffect(() => {
    if (docs?.length === 0 && !seedAttempted.current) {
      seedAttempted.current = true;
      void ensureSeeded();
    }
  }, [docs, ensureSeeded]);

  return (
    <div className="space-y-8 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Knowledge</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            What the agent answers from. Type an answer or upload a PDF or Word file. Saving
            pushes the text to the ElevenLabs knowledge base and rebuilds its RAG index; Sarah
            can use it once the badge reads Live.
          </p>
        </div>
        <button
          onClick={() => setSelected("new")}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Knowledge
        </button>
      </header>

      {docs?.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          No knowledge yet. Add an answer or upload a PDF / Word file so Sarah can use it
          during calls.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {docs?.map((doc, index) => {
          const badge = SYNC_LABELS[doc.syncState] ?? SYNC_LABELS.pending;
          const tone = CARD_TONES[index % CARD_TONES.length];
          const Icon = tone.icon;
          return (
            <motion.button
              key={doc._id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 8) * 0.04 }}
              whileHover={{ y: -2 }}
              onClick={() => setSelected(doc)}
              className="flex min-h-64 flex-col overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone.className}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
                <h2 className="mt-6 text-lg font-bold text-foreground">{doc.title}</h2>
                <p className="mt-3 line-clamp-4 text-sm leading-6 text-muted-foreground">{doc.body}</p>
                {doc.syncError ? <p className="mt-2 text-xs text-destructive">{doc.syncError}</p> : null}
              </div>
              <div className="flex w-full items-center border-t border-border bg-muted/30 px-5 py-4 text-xs text-muted-foreground">
                <Clock3 className="mr-2 h-3.5 w-3.5" />
                {relativeDate(doc.updatedAt)}
                <ChevronRight className="ml-auto h-4 w-4" />
              </div>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {selected ? (
          <KnowledgeModal
            doc={selected === "new" ? null : selected}
            onSave={async (title, body) => {
              await save({ id: selected === "new" ? undefined : selected._id, title, body });
              toast(selected === "new" ? "Knowledge added, syncing…" : "Knowledge updated, syncing…");
              setSelected(null);
            }}
            onDelete={
              selected !== "new"
                ? async () => {
                    await remove({ docId: selected._id });
                    toast("Knowledge deleted");
                    setSelected(null);
                  }
                : undefined
            }
            onClose={() => setSelected(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function KnowledgeModal({
  doc,
  onSave,
  onDelete,
  onClose,
}: {
  doc: Doc | null;
  onSave: (title: string, body: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const generateUploadUrl = useMutation(api.docs.generateUploadUrl);
  const extractFile = useAction(api.docs.extractFile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(doc?.title ?? "");
  const [body, setBody] = useState(doc?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      await onSave(title.trim(), body.trim());
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".doc") && !lower.endsWith(".docx")) {
      toast("Old .doc files aren't supported. Save as .docx or PDF and try again.", "error");
      return;
    }
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      toast("Please upload a PDF or Word (.docx) file.", "error");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast("That file is over 20MB. Please upload a smaller PDF or Word doc.", "error");
      return;
    }

    setReadingFile(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const uploaded = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploaded.ok) throw new Error("Could not upload the file.");
      const { storageId } = (await uploaded.json()) as { storageId: Id<"_storage"> };
      const extracted = await extractFile({ storageId, fileName: file.name });
      setTitle((current) => current.trim() || extracted.title);
      setBody(extracted.body);
      toast("Extracted the file text — review it and save");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not read that file.", "error");
    } finally {
      setReadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="text-lg font-bold">{doc ? "Edit Knowledge" : "Add Knowledge"}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Document title</span>
            <div className="relative">
              <FileText className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground-subtle" />
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Refund policy"
                className="h-11 w-full rounded-xl border border-input bg-card pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground-subtle focus:ring-2 focus:ring-ring/20"
              />
            </div>
          </label>

          <div>
            <span className="mb-2 block text-sm font-medium">Upload PDF or Word</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_UPLOAD}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <button
              type="button"
              disabled={busy || readingFile}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const file = event.dataTransfer.files[0];
                if (file) void handleFile(file);
              }}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                dragOver
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-input bg-muted/20 text-muted-foreground hover:bg-accent"
              }`}
            >
              <FileUp className="h-4 w-4 shrink-0" />
              {readingFile ? "Reading file…" : "Drop a .pdf or .docx here, or click to browse"}
            </button>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">Answer / content</span>
            <div className="relative">
              <Sparkles className="absolute top-4 left-3 h-4 w-4 text-muted-foreground-subtle" />
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={10}
                placeholder="Write the answer the way you would say it out loud, or upload a file above."
                className="min-h-40 w-full resize-y rounded-xl border border-input bg-card px-10 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground-subtle focus:ring-2 focus:ring-ring/20"
              />
            </div>
          </label>

          <div className="flex gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <div>
              <p className="text-sm font-semibold text-blue-900">Tips for better results</p>
              <p className="mt-1 text-xs leading-5 text-blue-700">
                Be clear, specific and conversational. Include important details like prices,
                policies, timeframes, etc.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center border-t border-border bg-muted/30 px-6 py-4">
          {onDelete ? (
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
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
              disabled={busy || readingFile || !title.trim() || !body.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Saving…" : doc ? "Save changes" : "Add knowledge"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
