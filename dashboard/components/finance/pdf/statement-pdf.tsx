/**
 * Rental Owner Statement as a PDF (spec section 7), laid out like Buildium's statement
 * (ROS.pdf pages 3-7): Summary by property, Income statement and Detail transactions, each starting
 * a new page, with the same header and footer on every physical page.
 *
 * Every string on the page comes from convex/rosView.ts (buildView, footerLeft, pageLabel). This file
 * only places them; it never formats money or dates. Sizes and colours live in ./layout.ts.
 *
 * Loaded only through a dynamic import (download-button.tsx), so @react-pdf/renderer never enters
 * the main bundle. It also renders in Node (renderToBuffer), for e-mail delivery later (spec 5.7).
 */

import { Document, Font, Image, Page, Text, View, type Styles } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { StatementSnapshot } from "@/convex/rosCalc";
import { buildView, footerLeft, pageLabel, type DetailViewLine, type StatementView, type ViewRow } from "@/convex/rosView";
import {
  COLOR,
  CONTENT_WIDTH,
  DETAIL,
  FONT,
  FOOTER,
  INCOME,
  LOGO,
  LOGO_SRC,
  MARGIN,
  META,
  PAGE,
  PREPARED_BY,
  RECIPIENT,
  SECTION_TITLE,
  SUMMARY,
  TABLE,
  TITLE,
  WATERMARK,
} from "./layout";

// Buildium never hyphenates: a long Memo or Name wraps between words only.
Font.registerHyphenationCallback((word) => [word]);

export type StatementPdfProps = {
  snapshot: StatementSnapshot;
  generatedMs: number;
  draft: boolean;
  /** Where the logo is loaded from. The browser needs an absolute URL; defaults to LOGO_SRC. */
  logoSrc?: string;
};

export function StatementPdf({ snapshot, generatedMs, draft, logoSrc = LOGO_SRC }: StatementPdfProps) {
  const view = buildView(snapshot.result, snapshot.header);
  const chrome = (
    <Chrome view={view} footer={footerLeft(snapshot.header.footerName, generatedMs)} logoSrc={logoSrc} draft={draft} />
  );

  return (
    <Document title={view.header.title}>
      {/* 1. Summary by property (page 1 keeps Buildium's blank recipient block, A34). */}
      <Page size={PAGE.size} orientation={PAGE.orientation} style={s.page} wrap>
        {chrome}
        <View style={{ height: RECIPIENT.height }} />
        <SectionTitle>{view.summary.title}</SectionTitle>
        <ValueTables columns={view.summary.columns} rows={view.summary.rows} widths={SUMMARY} />
      </Page>

      {/* 2. Income statement. */}
      <Page size={PAGE.size} orientation={PAGE.orientation} style={s.page} wrap>
        {chrome}
        <SectionTitle>{view.incomeStatement.title}</SectionTitle>
        <ValueTables columns={view.incomeStatement.columns} rows={view.incomeStatement.rows} widths={INCOME} income />
      </Page>

      {/* 3. Detail transactions (may span many pages; the column header repeats). */}
      <Page size={PAGE.size} orientation={PAGE.orientation} style={s.page} wrap>
        {chrome}
        <SectionTitle>{view.detail.title}</SectionTitle>
        <DetailTable detail={view.detail} />
      </Page>
    </Document>
  );
}

// --- page chrome (fixed: repeats on every physical page) ------------------------------------------

function Chrome({ view, footer, logoSrc, draft }: { view: StatementView; footer: string; logoSrc: string; draft: boolean }) {
  const h = view.header;
  return (
    <>
      {draft ? (
        <View fixed style={s.watermarkBox}>
          <Text style={s.watermarkText}>{WATERMARK.text}</Text>
        </View>
      ) : null}

      <Text fixed style={s.title}>
        {h.title}
      </Text>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt; the PDF is not HTML */}
      <Image fixed src={logoSrc} style={s.logo} />
      <MetaRow top={META.rowTops[0]} label={h.periodLabel} value={h.period} />
      <MetaRow top={META.rowTops[1]} label={h.dateLabel} value={h.date} />

      <View fixed style={s.preparedBy}>
        {h.preparedBy.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </View>

      <Text fixed style={s.footerLeft}>
        {footer}
      </Text>
      <Text fixed style={s.pageNumber} render={({ pageNumber }) => pageLabel(pageNumber)} />
    </>
  );
}

function MetaRow({ top, label, value }: { top: number; label: string; value: string }) {
  return (
    <>
      <Text fixed style={[s.metaLabel, { top }]}>
        {label}
      </Text>
      <Text fixed style={[s.metaValue, { top }]}>
        {value}
      </Text>
    </>
  );
}

function SectionTitle({ children }: { children: string }) {
  // Keeps the title on the same page as the table head and at least one row.
  return (
    <Text style={s.sectionTitle} minPresenceAhead={TABLE.headerHeight + TABLE.rowHeight * 2}>
      {children}
    </Text>
  );
}

// --- Summary / Income statement tables ------------------------------------------------------------

/** Splits the value columns into consecutive chunks of at most 5 (spec 7.3); "All properties" stays last. */
function columnChunks(count: number): number[][] {
  const all = Array.from({ length: count }, (_, i) => i);
  if (count <= TABLE.maxValueColumns) return [all];
  const chunks: number[][] = [];
  for (let i = 0; i < count; i += TABLE.maxValueColumns) chunks.push(all.slice(i, i + TABLE.maxValueColumns));
  return chunks;
}

function ValueTables({
  columns,
  rows,
  widths,
  income = false,
}: {
  columns: string[];
  rows: ViewRow[];
  widths: { labelWidth: number; valueWidth: number };
  income?: boolean;
}) {
  const lastColumn = columns.length - 1;
  return (
    <>
      {columnChunks(columns.length).map((chunk, ci) => {
        const width = widths.labelWidth + widths.valueWidth * chunk.length;
        return (
          <View key={ci} style={[{ width }, ci > 0 ? { marginTop: TABLE.chunkGap } : {}]}>
            {/* Repeats at the top of every page this table continues onto. */}
            <View fixed style={s.headerBand}>
              <View style={{ width: widths.labelWidth }} />
              {chunk.map((c) => (
                <Text key={c} style={[s.cellRight, { width: widths.valueWidth }, c === lastColumn ? s.bold : {}]}>
                  {columns[c]}
                </Text>
              ))}
            </View>
            {rows.map((row, ri) => (
              <ValueRow key={ri} row={row} chunk={chunk} widths={widths} income={income} />
            ))}
          </View>
        );
      })}
    </>
  );
}

function ValueRow({
  row,
  chunk,
  widths,
  income,
}: {
  row: ViewRow;
  chunk: number[];
  widths: { labelWidth: number; valueWidth: number };
  income: boolean;
}) {
  const strong = row.kind !== "row";
  // Income statement: account rows and "Total ..." rows are indented, as in the sample.
  const indent = income && (row.kind === "row" || row.kind === "total") ? TABLE.indent : 0;
  return (
    <View wrap={false}>
      <View style={[s.row, row.kind === "total" ? s.dotted : {}]}>
        <Text style={[s.cellLeft, { width: widths.labelWidth, paddingLeft: TABLE.padX + indent }, strong ? s.bold : {}]}>
          {income && row.kind === "total" ? <TotalLabel label={row.label} /> : row.label}
        </Text>
        {chunk.map((c) => (
          <Text key={c} style={[s.cellRight, { width: widths.valueWidth }, strong ? s.bold : {}]}>
            {row.values[c]}
          </Text>
        ))}
      </View>
      {row.kind === "grand" ? <DoubleRule /> : null}
    </View>
  );
}

/** "Total income": "Total" bold, the rest regular (spec 4.3). Only splits the given string. */
function TotalLabel({ label }: { label: string }): ReactNode {
  const space = label.indexOf(" ");
  if (space <= 0) return label;
  return (
    <>
      {label.slice(0, space)}
      <Text style={s.regular}>{label.slice(space)}</Text>
    </>
  );
}

function DoubleRule() {
  return <View style={s.doubleRule} />;
}

// --- Detail transactions --------------------------------------------------------------------------

const W = DETAIL.widths;
/** Label span of the "Beginning / Total / Ending" rows: Date through Name. */
const LABEL_SPAN = W.date + W.property + W.unit + W.account + W.name;

function DetailTable({ detail }: { detail: StatementView["detail"] }) {
  const [cDate, cProperty, cUnit, cAccount, cName, cMemo, cAmount, cBalance] = detail.columns;
  // A total must never start a page alone: the item before it keeps the total (and, at the end,
  // the Ending row) on its page.
  const keepAdditionsTotal = TABLE.rowHeight + 6;
  const keepSubtractionsTotal = TABLE.rowHeight * 2 + DETAIL.endingGap + 6;

  return (
    <View style={{ width: CONTENT_WIDTH }}>
      <View fixed style={s.headerBand}>
        <Text style={[s.cellRight, { width: W.date }]}>{cDate}</Text>
        <Text style={[s.cellLeft, { width: W.property }]}>{cProperty}</Text>
        <Text style={[s.cellLeft, { width: W.unit }]}>{cUnit}</Text>
        <Text style={[s.cellLeft, { width: W.account }]}>{cAccount}</Text>
        <Text style={[s.cellLeft, { width: W.name }]}>{cName}</Text>
        <Text style={[s.cellLeft, { width: W.memo }]}>{cMemo}</Text>
        <Text style={[s.cellRight, { width: W.amount }]}>{cAmount}</Text>
        <Text style={[s.cellRight, { width: W.balance }]}>{cBalance}</Text>
      </View>

      <View wrap={false} style={[s.row, s.dotted]} minPresenceAhead={TABLE.rowHeight * 2}>
        <Text style={[s.cellLeft, s.bold, { width: CONTENT_WIDTH - W.balance }]}>{detail.beginning.label}</Text>
        <Text style={[s.cellRight, s.bold, { width: W.balance }]}>{detail.beginning.balance}</Text>
      </View>

      <DetailGroup title={detail.additionsTitle} lines={detail.additions} keepWithTotal={keepAdditionsTotal} />
      <DetailTotal label={detail.additionsTotal.label} amount={detail.additionsTotal.amount} />

      <DetailGroup title={detail.subtractionsTitle} lines={detail.subtractions} keepWithTotal={keepSubtractionsTotal} />
      <DetailTotal label={detail.subtractionsTotal.label} amount={detail.subtractionsTotal.amount} />

      <View wrap={false} style={{ marginTop: DETAIL.endingGap }}>
        <View style={s.row}>
          <Text style={[s.cellLeft, s.bold, { width: CONTENT_WIDTH - W.balance }]}>{detail.ending.label}</Text>
          <Text style={[s.cellRight, s.bold, { width: W.balance }]}>{detail.ending.balance}</Text>
        </View>
        <DoubleRule />
      </View>
    </View>
  );
}

function DetailGroup({ title, lines, keepWithTotal }: { title: string; lines: DetailViewLine[]; keepWithTotal: number }) {
  const last = lines.length - 1;
  return (
    <>
      <View
        wrap={false}
        style={s.row}
        minPresenceAhead={lines.length === 0 ? keepWithTotal : TABLE.rowHeight}
      >
        <Text style={[s.cellLeft, s.bold, { width: CONTENT_WIDTH }]}>{title}</Text>
      </View>
      {lines.map((l, i) => (
        <View key={i} wrap={false} style={s.row} minPresenceAhead={i === last ? keepWithTotal : undefined}>
          <Text style={[s.cellRight, { width: W.date }]}>{l.date}</Text>
          <Text style={[s.cellLeft, { width: W.property }]}>{l.property}</Text>
          <Text style={[s.cellLeft, { width: W.unit }]}>{l.unit}</Text>
          <Text style={[s.cellLeft, { width: W.account }]}>{l.account}</Text>
          <Text style={[s.cellLeft, { width: W.name }]}>{l.name}</Text>
          <Text style={[s.cellLeft, { width: W.memo }]}>{l.memo}</Text>
          <Text style={[s.cellRight, { width: W.amount }]}>{l.amount}</Text>
          <Text style={[s.cellRight, { width: W.balance }]}>{l.balance}</Text>
        </View>
      ))}
    </>
  );
}

/** "Total from ..." row: bold label, bold amount right-aligned in the Memo column (as Buildium prints it). */
function DetailTotal({ label, amount }: { label: string; amount: string }) {
  return (
    <View wrap={false} style={[s.row, s.dotted, { width: CONTENT_WIDTH - W.balance }]}>
      <Text style={[s.cellLeft, s.bold, { width: LABEL_SPAN }]}>{label}</Text>
      <Text style={[s.cellRight, s.bold, { width: W.memo }]}>{amount}</Text>
    </View>
  );
}

// --- styles ---------------------------------------------------------------------------------------

type Style = Styles[string];

const abs = (style: Style): Style => ({ position: "absolute", ...style });

const s = {
  page: {
    paddingTop: MARGIN.top,
    paddingLeft: MARGIN.left,
    paddingRight: MARGIN.right,
    paddingBottom: MARGIN.bottom,
    fontFamily: FONT.family,
    fontWeight: FONT.regular,
    fontSize: TABLE.fontSize,
    color: COLOR.text,
    backgroundColor: "#FFFFFF",
  },
  bold: { fontWeight: FONT.bold },
  regular: { fontWeight: FONT.regular },

  title: abs({ top: TITLE.top, right: TITLE.right, fontSize: TITLE.fontSize }),
  logo: abs({ top: LOGO.top, right: LOGO.right, width: LOGO.width, height: LOGO.height, objectFit: "contain" }),
  metaLabel: abs({
    left: META.labelRight - META.labelWidth,
    width: META.labelWidth,
    textAlign: "right",
    fontSize: META.fontSize,
  }),
  metaValue: abs({
    left: META.valueRight - META.valueWidth,
    width: META.valueWidth,
    textAlign: "right",
    fontSize: META.fontSize,
    fontWeight: FONT.bold,
  }),
  preparedBy: abs({
    left: PREPARED_BY.left,
    top: PREPARED_BY.top,
    fontSize: PREPARED_BY.fontSize,
    lineHeight: PREPARED_BY.lineHeight / PREPARED_BY.fontSize,
  }),
  footerLeft: abs({ left: FOOTER.left, top: FOOTER.top, fontSize: FOOTER.fontSize }),
  pageNumber: abs({
    left: PAGE.width - MARGIN.right - FOOTER.pageWidth,
    width: FOOTER.pageWidth,
    top: FOOTER.pageTop,
    fontSize: FOOTER.fontSize,
    textAlign: "right",
  }),

  watermarkBox: abs({
    top: 0,
    left: 0,
    width: PAGE.width,
    height: PAGE.height,
    alignItems: "center",
    justifyContent: "center",
  }),
  watermarkText: {
    fontWeight: FONT.bold,
    fontSize: WATERMARK.fontSize,
    color: COLOR.watermark,
    opacity: WATERMARK.opacity,
    transform: `rotate(${WATERMARK.rotateDeg}deg)`,
  },

  sectionTitle: { fontWeight: FONT.bold, fontSize: SECTION_TITLE.fontSize, height: SECTION_TITLE.height },

  headerBand: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: TABLE.headerHeight,
    backgroundColor: COLOR.headerBand,
  },
  row: { flexDirection: "row", alignItems: "flex-start", minHeight: TABLE.rowHeight },
  cellLeft: {
    fontSize: TABLE.fontSize,
    paddingLeft: TABLE.padX,
    paddingRight: TABLE.padX,
    paddingTop: TABLE.padY,
    paddingBottom: TABLE.padY,
    lineHeight: TABLE.lineHeight,
  },
  cellRight: {
    fontSize: TABLE.fontSize,
    paddingLeft: TABLE.padX,
    paddingRight: TABLE.padX,
    paddingTop: TABLE.padY,
    paddingBottom: TABLE.padY,
    lineHeight: TABLE.lineHeight,
    textAlign: "right",
  },
  dotted: {
    borderBottomWidth: TABLE.dottedWidth,
    borderBottomColor: COLOR.dottedRule,
    borderBottomStyle: "dotted",
  },
  doubleRule: {
    height: TABLE.doubleRuleWidth * 2 + TABLE.doubleRuleGap,
    borderTopWidth: TABLE.doubleRuleWidth,
    borderBottomWidth: TABLE.doubleRuleWidth,
    borderTopColor: COLOR.rule,
    borderBottomColor: COLOR.rule,
    borderTopStyle: "solid",
    borderBottomStyle: "solid",
  },
} satisfies Record<string, Style>;
