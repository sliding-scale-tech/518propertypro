"use node";

import { v } from "convex/values";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { internalAction } from "./_generated/server";
import { requireUserId } from "./authz";

/** Same ceiling ElevenLabs uses for knowledge-base files. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Reads an uploaded PDF or .docx and returns plain text the existing docs.save → syncDoc
 * pipeline can treat like a typed answer.
 *
 * Why extract instead of handing the file to ElevenLabs: the voice agent RAG-indexes
 * ElevenLabs documents, but WhatsApp and SMS paste every doc's `body` into Gemini's prompt.
 * If the words only lived as an ElevenLabs file id, those two channels would never see them.
 */
export const extractFile = internalAction({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args): Promise<{ title: string; body: string }> => {
    await requireUserId(ctx);

    const blob = await ctx.storage.get(args.storageId);
    try {
      if (!blob) throw new Error("Upload was lost before it could be read. Try again.");
      if (blob.size > MAX_FILE_BYTES) {
        throw new Error("That file is over 20MB. Please upload a smaller PDF or Word doc.");
      }

      const kind = fileKind(args.fileName, blob.type);
      const buffer = Buffer.from(await blob.arrayBuffer());
      const raw = kind === "pdf" ? await extractPdf(buffer) : await extractDocx(buffer);
      const body = cleanText(raw);
      if (!body) {
        throw new Error(
          "No text found in that file. If it's a scanned PDF, paste the content instead.",
        );
      }

      return { title: titleFromFileName(args.fileName), body };
    } finally {
      await ctx.storage.delete(args.storageId).catch(() => {
        /* leftover blob is harmless; the next upload does not depend on this id */
      });
    }
  },
});

function fileKind(fileName: string, contentType: string): "pdf" | "docx" {
  const lower = fileName.toLowerCase();
  const type = contentType.toLowerCase();
  if (lower.endsWith(".pdf") || type.includes("pdf")) return "pdf";
  if (lower.endsWith(".docx") || type.includes("wordprocessingml")) return "docx";
  if (lower.endsWith(".doc") || type === "application/msword") {
    throw new Error("Old .doc files aren't supported. Save as .docx or PDF and try again.");
  }
  throw new Error("Please upload a PDF or Word (.docx) file.");
}

function titleFromFileName(fileName: string) {
  const base = fileName.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const titled = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return titled || "Untitled document";
}

function cleanText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdf(buffer: Buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({ pageJoiner: "\n\n" });
    return result.pages.map((page) => page.text).join("\n\n") || result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
