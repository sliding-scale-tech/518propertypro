"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera, CheckCircle2, Loader2, LinkIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { compressImage, uploadBlob } from "@/components/tech/lib";

// Matches the server limits in maintenance.ts: images 10 MB (after compression), video 50 MB.
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

type Item = { name: string; state: "uploading" | "done" | "error"; pct: number; error?: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 bg-background px-4 py-8">
      <div className="text-[22px] font-bold tracking-[-0.03em]">518 Property Pro</div>
      {children}
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[20px] border border-border bg-card px-6 py-10 text-center">
      <LinkIcon aria-hidden className="h-8 w-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * Public, no-login tenant upload page. The token in the URL is the only credential; the server
 * returns just the unit label and uses one generic "expired" answer for every failure, so
 * nothing else about the request or tenant is exposed here.
 */
export default function TenantUploadPage() {
  const { token } = useParams<{ token: string }>();
  const info = useQuery(api.maintenance.publicLinkInfo, { token });
  const getUrl = useMutation(api.maintenance.publicUploadUrl);
  const attach = useMutation(api.maintenance.publicAttach);
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [expired, setExpired] = useState(false);

  const patch = (i: number, p: Partial<Item>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)));

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const base = items.length;
    setItems((prev) => [...prev, ...picked.map((f) => ({ name: f.name, state: "uploading" as const, pct: 0 }))]);
    for (const [n, file] of picked.entries()) {
      const i = base + n;
      try {
        const isVideo = file.type.startsWith("video/");
        const isImage = file.type.startsWith("image/");
        if (!isVideo && !isImage) throw new Error("Only photos and videos can be sent.");
        if (isVideo && file.size > VIDEO_MAX_BYTES) throw new Error("Videos can be at most 50 MB.");
        const blob = isImage ? await compressImage(file) : file;
        if (isImage && blob.size > IMAGE_MAX_BYTES) throw new Error("That photo is too large.");
        const res = await getUrl({ token });
        if (!res.ok) {
          setExpired(true);
          return;
        }
        const storageId = await uploadBlob(res.url, blob, (pct) => patch(i, { pct }));
        const done = await attach({ token, storageId: storageId as Id<"_storage"> });
        if (!done.ok) {
          if (/expired/i.test(done.error)) {
            setExpired(true);
            return;
          }
          throw new Error(done.error);
        }
        patch(i, { state: "done", pct: 100 });
      } catch (e) {
        patch(i, { state: "error", error: e instanceof Error ? e.message : "Upload failed." });
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  if (info === undefined) {
    return (
      <Shell>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }
  if (!info.valid || expired) {
    return (
      <Shell>
        <Notice
          title="This link has expired"
          body="It may have been used already or is no longer needed. If you still want to send photos, reply to the text message and we will send a new link."
        />
      </Shell>
    );
  }

  const uploading = items.some((it) => it.state === "uploading");
  const sent = items.filter((it) => it.state === "done").length;

  return (
    <Shell>
      <div className="rounded-[20px] border border-border bg-card px-5 py-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">
          Upload photos or a short video of the issue{info.unitLabel ? ` at Unit ${info.unitLabel}` : ""}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This helps us get the right person out faster. You do not need to sign in.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="sr-only"
          id="tenant-files"
          disabled={uploading}
          onChange={(e) => void onFiles(e.target.files)}
        />
        <label
          htmlFor="tenant-files"
          className={`mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] bg-primary py-[13px] text-[15px] font-semibold text-primary-foreground ${uploading ? "pointer-events-none opacity-40" : ""}`}
        >
          <Camera aria-hidden className="h-5 w-5" />
          {items.length === 0 ? "Take or choose photos" : "Add more"}
        </label>
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {items.map((it, i) => (
            <li key={i} className="rounded-[14px] border border-border bg-card px-3.5 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                {it.state === "done" ? <CheckCircle2 aria-label="Sent" className="h-4 w-4 text-success-ink" /> : null}
                {it.state === "uploading" ? <span className="tabular-nums text-muted-foreground">{it.pct}%</span> : null}
              </div>
              {it.state === "uploading" ? (
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={it.pct}
                  aria-label={`Uploading ${it.name}`}
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${it.pct}%` }} />
                </div>
              ) : null}
              {it.state === "error" ? <p className="mt-1 text-xs text-danger-ink">{it.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {sent > 0 && !uploading ? (
        <div className="flex items-center gap-3 rounded-[20px] border border-border bg-success-soft px-5 py-4 text-success-ink">
          <CheckCircle2 aria-hidden className="h-6 w-6 shrink-0" />
          <div>
            <div className="font-semibold">Thank you</div>
            <div className="text-sm">
              We received {sent} {sent === 1 ? "file" : "files"}. Your property manager has been told. You can close this page.
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
