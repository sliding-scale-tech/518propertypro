"use client";

/**
 * Downloads a Rental Owner Statement as a PDF (spec 7.2). On click it fetches the statement
 * (`ownerStatements.pdfData`: the stored snapshot for a final, a live build for a draft), loads
 * @react-pdf/renderer and the PDF component with a dynamic import (so neither enters the page
 * bundle or runs during SSR), renders in the browser, saves the file and then records the download
 * (`ownerStatements.recordDownload`, audited server side).
 *
 * The data is fetched on click rather than with a live useQuery: a draft is rebuilt from the ledger
 * on every read, so a subscription would recompute it on every ledger change while the page is
 * open, and a query error would break the page instead of showing a toast.
 */

import { useState } from "react";
import { ConvexError } from "convex/values";
import { useConvex, useMutation } from "convex/react";
import { Download, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Btn } from "@/components/ui/controls";
import { toast } from "@/components/ui/toast";
import { serverError } from "@/lib/form-errors";
import { LOGO_SRC } from "./layout";

const PDF_FAILED = "Couldn't build the PDF. Try again.";
const LOG_FAILED = "The PDF downloaded, but the download couldn't be recorded.";

/** True for the server's deliberate, user-facing errors (`instanceof` can miss across bundles). */
function isConvexError(e: unknown): boolean {
  return e instanceof ConvexError || (!!e && typeof e === "object" && "data" in e);
}

/** "Nye Properties LLC" -> "nye-properties-llc". */
function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "statement";
}

/** `ROS-{slug(legalName)}-{YYYY-MM}{-DRAFT}.pdf` (spec 7.2). */
function fileName(legalName: string, periodStart: string, draft: boolean): string {
  return `ROS-${slug(legalName)}-${periodStart.slice(0, 7)}${draft ? "-DRAFT" : ""}.pdf`;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function DownloadStatementPdfButton({
  statementId,
  draft,
  label,
}: {
  statementId: Id<"ownerStatements">;
  draft: boolean;
  label: string;
}) {
  const convex = useConvex();
  const recordDownload = useMutation(api.ownerStatements.recordDownload);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      let saved: boolean;
      try {
        const [data, { pdf }, { StatementPdf }] = await Promise.all([
          convex.query(api.ownerStatements.pdfData, { statementId }),
          import("@react-pdf/renderer"),
          import("./statement-pdf"),
        ]);
        // The server decides draft vs final (status), not the prop: the watermark and file name follow it.
        const blob = await pdf(
          <StatementPdf
            snapshot={data.snapshot}
            generatedMs={Date.now()}
            draft={data.draft}
            logoSrc={new URL(LOGO_SRC, window.location.origin).href}
          />,
        ).toBlob();
        saveBlob(blob, fileName(data.snapshot.header.ownerLegalName, data.snapshot.header.periodStart, data.draft));
        saved = true;
      } catch (e) {
        toast.error(isConvexError(e) ? serverError(e).message : PDF_FAILED);
        saved = false;
      }
      if (!saved) return;
      try {
        await recordDownload({ statementId, draft });
      } catch (e) {
        toast.error(isConvexError(e) ? serverError(e).message : LOG_FAILED);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Btn
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      title={draft ? "Download a draft PDF marked DRAFT - NOT FINAL" : "Download the final PDF"}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
      {busy ? "Building PDF..." : label}
    </Btn>
  );
}
