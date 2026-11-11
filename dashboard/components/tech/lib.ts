/** Shared helpers for the technician pages. Pure, no server access. */

import { ConvexError } from "convex/values";

export function mapsUrl(destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export const PRIORITY_BAR: Record<string, string> = {
  emergency: "bg-destructive",
  urgent: "bg-warning",
  routine: "bg-primary/40",
};

export const STATUS_LABEL: Record<string, string> = {
  created: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Sent for review",
  reviewed_closed: "Closed",
  cancelled: "Cancelled",
};

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/** "12.50" / "$12.5" -> 1250, or null when not a valid non-negative amount (no float drift). */
export function dollarsToCents(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function todayLocalIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Downscale to max 1600px long edge and re-encode as JPEG 0.8. Falls back to the original file. */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.8));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** POST a blob to a Convex upload URL with progress. Resolves to the storageId. Rejects with a ConvexError so errorMessage() shows its text. */
export function uploadBlob(url: string, blob: Blob, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const { storageId } = JSON.parse(xhr.responseText) as { storageId?: string };
          if (storageId) return resolve(storageId);
        } catch {
          /* fall through */
        }
      }
      reject(new ConvexError("The upload failed. Please try again."));
    };
    xhr.onerror = () => reject(new ConvexError("The upload failed. Check your connection and try again."));
    xhr.send(blob);
  });
}
