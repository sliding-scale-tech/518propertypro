/**
 * Rental Owner Statement PDF: every size, position and colour (spec 7.4). Units are PDF points
 * (1/72 in) on a US Letter landscape page, 792 x 612. Measured from Buildium's sample (ROS.pdf
 * pages 3-7) and tuned by eye against renders of the golden fixture.
 *
 * No logic here: statement-pdf.tsx reads these, and every string comes from convex/rosView.ts.
 */

/** Placeholder logo cropped from the scan (ASSUMPTION A17). Swap the file for a high-res one (Q17). */
export const LOGO_SRC = "/brand/pprg-logo.png";

export const PAGE = {
  size: "LETTER",
  orientation: "landscape",
  width: 792,
  height: 612,
} as const;

/** Content box. `top` is where a section title sits on every page except page 1 (see RECIPIENT). */
export const MARGIN = { top: 183, left: 40, right: 50, bottom: 60 } as const;
export const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right; // 702
/** Right edge of everything right-aligned (title, logo, header values, "Page N"). */
export const RIGHT_EDGE = PAGE.width - MARGIN.right; // 742

/** Built-in Helvetica (ASSUMPTION A26); bold is the same family at weight "bold" (Helvetica-Bold). */
export const FONT = { family: "Helvetica", regular: "normal", bold: "bold" } as const;

export const COLOR = {
  text: "#000000",
  headerBand: "#E6E6E6",
  dottedRule: "#999999",
  rule: "#000000",
  watermark: "#9A9A9A",
} as const;

/** Top right: "Rental Owner Statement". `top` is the text box top (baseline is about y 70). */
export const TITLE = { fontSize: 18, top: 54, right: MARGIN.right } as const;

/** Logo box under the title; the image keeps its aspect ratio inside it. */
export const LOGO = { top: 80, right: MARGIN.right, width: 125, height: 50 } as const;

/** "Statement period" / "Statement date" rows: labels end at x 652, bold values end at x 742. */
export const META = {
  fontSize: 8.5,
  rowTops: [134, 148] as const,
  labelRight: 652,
  valueRight: RIGHT_EDGE,
  labelWidth: 120,
  valueWidth: 88,
} as const;

/** Top left: "Prepared By: ..." and the address. */
export const PREPARED_BY = { left: 62, top: 96, fontSize: 10, lineHeight: 11 } as const;

/** Page 1 only: Buildium's blank mailing-window block, so the Summary title lands at y 305 (A34). */
export const RECIPIENT = { height: 305 - MARGIN.top } as const;

export const FOOTER = { left: MARGIN.left, top: 566, pageTop: 569, fontSize: 8, pageWidth: 80 } as const;

export const SECTION_TITLE = { fontSize: 9, height: 14 } as const;

export const TABLE = {
  fontSize: 8,
  /** 8 x 1.3 = 10.4 pt between wrapped lines, as in the sample. */
  lineHeight: 1.3,
  /** Minimum row height; a wrapped Memo/Name grows the row. */
  rowHeight: 15,
  headerHeight: 16,
  padX: 4,
  /** 2 x 2.3 + 10.4 = 15 pt: one-line rows are exactly rowHeight. */
  padY: 2.3,
  /** Indent of account and "Total" rows in the income statement. */
  indent: 12,
  dottedWidth: 0.5,
  doubleRuleWidth: 0.75,
  doubleRuleGap: 1.5,
  /** At most this many value columns per table; more are split into stacked tables (spec 7.3). */
  maxValueColumns: 5,
  /** Space between stacked column-chunk tables. */
  chunkGap: 14,
} as const;

/** Summary by property: label column + one 88 pt column per property and "All properties". */
export const SUMMARY = { labelWidth: 171, valueWidth: 88 } as const;

/** Income statement: narrower, like the sample. */
export const INCOME = { labelWidth: 92, valueWidth: 87 } as const;

/**
 * Detail transactions columns (sum = CONTENT_WIDTH). The "Total from ..." amounts sit right-aligned
 * in the Memo column, as Buildium prints them.
 */
export const DETAIL = {
  widths: { date: 61, property: 86, unit: 58, account: 74, name: 175, memo: 120, amount: 58, balance: 70 },
  /** Extra space above the "Ending cash balance" row. */
  endingGap: 7,
} as const;

/** Draft only (A29): diagonal light-grey text across every page. */
export const WATERMARK = { text: "DRAFT - NOT FINAL", fontSize: 64, opacity: 0.15, rotateDeg: -30 } as const;
