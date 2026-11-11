// Unit tests for convex/rosFormat.ts (ROS money, date and string helpers). No packages. From dashboard/:
//   node --test scripts/probes/ros_format.test.mjs
// Spec: docs/specs/ros-build-spec.md 4.1 and 9.2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});
const F = await import("../../convex/rosFormat.ts");

test("constants", () => {
  assert.equal(F.ROS_TIME_ZONE, "America/New_York");
  assert.equal(F.COMPANY_NAME, "Property Pro Realty Group Inc.");
  assert.deepEqual([...F.COMPANY_ADDRESS_LINES], ["60 Broad Street", "Waterford, NY 12188"]);
  assert.equal(F.PROPERTY_LEVEL, "Property level");
  assert.equal(F.MAX_AMOUNT_CENTS, 100000000);
});

test("formatAmount and formatCurrency", () => {
  const cases = [
    [0, "0.00", "$0.00"],
    [5, "0.05", "$0.05"],
    [99, "0.99", "$0.99"],
    [100, "1.00", "$1.00"],
    [123456789, "1,234,567.89", "$1,234,567.89"],
    [-1, "(0.01)", "($0.01)"],
    [-240000, "(2,400.00)", "($2,400.00)"],
    [433387, "4,333.87", "$4,333.87"],
    [100000000, "1,000,000.00", "$1,000,000.00"],
    [-100000000, "(1,000,000.00)", "($1,000,000.00)"],
    [99999, "999.99", "$999.99"],
    [100000, "1,000.00", "$1,000.00"],
  ];
  for (const [c, a, cur] of cases) {
    assert.equal(F.formatAmount(c), a, `formatAmount(${c})`);
    assert.equal(F.formatCurrency(c), cur, `formatCurrency(${c})`);
  }
  assert.equal(F.formatAmount(-0), "0.00");
  assert.throws(() => F.formatAmount(10.5));
  assert.throws(() => F.formatCurrency(NaN));
  assert.throws(() => F.formatAmount(Number.MAX_SAFE_INTEGER + 1));
});

test("assertCents", () => {
  F.assertCents(0);
  F.assertCents(-5);
  assert.throws(() => F.assertCents(0.1));
  assert.throws(() => F.assertCents(Infinity));
  assert.throws(() => F.assertCents("5"));
});

test("parseDollarsToCents", () => {
  const ok = [
    ["12.5", 1250],
    ["$1,250.00", 125000],
    ["0.1", 10],
    ["0.07", 7],
    ["1.15", 115],
    ["4.35", 435],
    ["0.29", 29],
    ["  12  ", 1200],
    ["0", 0],
    ["1000000", 100000000],
    ["$4,333.87", 433387],
    ["8.20", 820],
    ["19.99", 1999],
  ];
  for (const [raw, cents] of ok) assert.equal(F.parseDollarsToCents(raw), cents, raw);
  for (const raw of ["1.234", "-1", "", "abc", "  ", "$", ".5", "1.", "1e3", "$$1", "1 000", "--1", "(1.00)"]) {
    assert.equal(F.parseDollarsToCents(raw), null, JSON.stringify(raw));
  }
  assert.equal(F.parseDollarsToCents(null), null);
  assert.equal(F.parseDollarsToCents(undefined), null);
  assert.equal(F.parseDollarsToCents("99999999999999999"), null, "beyond safe integer");
});

test("parseSignedDollarsToCents", () => {
  assert.equal(F.parseSignedDollarsToCents("(12.00)"), -1200);
  assert.equal(F.parseSignedDollarsToCents("-0.50"), -50);
  assert.equal(F.parseSignedDollarsToCents("-$1,250.00"), -125000);
  assert.equal(F.parseSignedDollarsToCents("($2,400.00)"), -240000);
  assert.equal(F.parseSignedDollarsToCents("12.34"), 1234);
  assert.ok(Object.is(F.parseSignedDollarsToCents("-0"), 0), "no negative zero");
  for (const raw of ["", "--1", "(1", "-", "()", "abc", "-1.234"]) {
    assert.equal(F.parseSignedDollarsToCents(raw), null, JSON.stringify(raw));
  }
});

test("roundHalfUpDiv: half up, not banker's", () => {
  assert.equal(F.roundHalfUpDiv(5, 10), 1);
  assert.equal(F.roundHalfUpDiv(4, 10), 0);
  assert.equal(F.roundHalfUpDiv(15, 10), 2);
  assert.equal(F.roundHalfUpDiv(25, 10), 3);
  assert.equal(F.roundHalfUpDiv(0, 7), 0);
  assert.throws(() => F.roundHalfUpDiv(-1, 10));
  assert.throws(() => F.roundHalfUpDiv(1, 0));
  assert.throws(() => F.roundHalfUpDiv(1.5, 10));
  assert.throws(() => F.roundHalfUpDiv(Number.MAX_SAFE_INTEGER, 10));
});

test("percentOf", () => {
  assert.equal(F.percentOf(433387, 500), 21669);
  assert.equal(F.percentOf(100, 250), 3);
  assert.equal(F.percentOf(1, 500), 0);
  assert.equal(F.percentOf(0, 500), 0);
  assert.equal(F.percentOf(10000, 1), 1);
  assert.equal(F.percentOf(10, 500), 1, "0.5 rounds up");
  assert.equal(F.percentOf(9, 500), 0, "0.45 rounds down");
  assert.equal(F.percentOf(100000000, 10000), 100000000);
  assert.throws(() => F.percentOf(-1, 500));
  assert.throws(() => F.percentOf(100, 2.5));
});

test("formatBps and parsePercentToBps", () => {
  assert.equal(F.formatBps(500), "5.00");
  assert.equal(F.formatBps(1250), "12.50");
  assert.equal(F.formatBps(1), "0.01");
  assert.equal(F.formatBps(0), "0.00");
  assert.equal(F.formatBps(10000), "100.00");
  for (const raw of ["5", "5.0", "5.00", "5%", " 5 % "]) assert.equal(F.parsePercentToBps(raw), 500, raw);
  assert.equal(F.parsePercentToBps("5.5%"), 550);
  assert.equal(F.parsePercentToBps("100"), 10000);
  assert.equal(F.parsePercentToBps("0"), 0);
  assert.equal(F.parsePercentToBps("12.5"), 1250);
  for (const raw of ["100.01", "5.123", "", "-5", "abc", "5%%", null, undefined]) {
    assert.equal(F.parsePercentToBps(raw), null, String(raw));
  }
  assert.equal(F.parsePercentToBpsUnbounded("150"), 15000);
});

test("date validity", () => {
  assert.ok(F.isIsoDate("2026-09-30"));
  assert.ok(F.isIsoDate("2028-02-29"));
  assert.ok(!F.isIsoDate("2026-02-29"));
  assert.ok(!F.isIsoDate("2026-09-31"));
  assert.ok(!F.isIsoDate("2026-13-01"));
  assert.ok(!F.isIsoDate("2026-9-1"));
  assert.ok(!F.isIsoDate("2100-02-29"), "2100 is not a leap year");
  assert.ok(F.isIsoDate("2000-02-29"), "2000 is a leap year");
  assert.ok(F.isMonth("2026-09"));
  assert.ok(!F.isMonth("2026-00"));
  assert.ok(!F.isMonth("2026-13"));
  assert.ok(!F.isMonth("2026-9"));
});

test("month helpers", () => {
  assert.equal(F.monthStart("2026-09"), "2026-09-01");
  assert.equal(F.monthEnd("2026-09"), "2026-09-30");
  assert.equal(F.monthEnd("2028-02"), "2028-02-29");
  assert.equal(F.monthEnd("2026-02"), "2026-02-28");
  assert.equal(F.monthEnd("2000-02"), "2000-02-29");
  assert.equal(F.monthEnd("2100-02"), "2100-02-28");
  assert.equal(F.monthEnd("2026-12"), "2026-12-31");
  assert.equal(F.prevMonth("2026-01"), "2025-12");
  assert.equal(F.prevMonth("2026-10"), "2026-09");
  assert.equal(F.nextMonth("2026-12"), "2027-01");
  assert.equal(F.nextMonth("2026-09"), "2026-10");
  assert.equal(F.monthOf("2026-09-30"), "2026-09");
  assert.throws(() => F.monthEnd("2026-13"));
  assert.throws(() => F.monthOf("2026-02-30"));
});

test("date formatting", () => {
  assert.equal(F.formatDate("2026-09-01"), "9/1/2026");
  assert.equal(F.formatDate("2026-10-16"), "10/16/2026");
  assert.equal(F.formatMonth("2026-09"), "September 2026");
  assert.equal(F.formatMonth("2027-01"), "January 2027");
  assert.equal(F.formatPeriod("2026-09-01", "2026-09-30"), "9/1/2026 - 9/30/2026");
});

test("businessDate and generatedStamp use New York time", () => {
  assert.equal(F.businessDate(Date.UTC(2026, 9, 1, 3, 30)), "2026-09-30", "EDT: still the 30th");
  assert.equal(F.businessDate(Date.UTC(2026, 9, 1, 4, 0)), "2026-10-01");
  assert.equal(F.businessToday(Date.UTC(2026, 0, 1, 4, 59)), "2025-12-31", "EST: UTC-5");
  assert.equal(F.generatedStamp(Date.UTC(2026, 9, 16, 13, 26, 36)), "10/16/2026 09:26:36");
  assert.equal(F.generatedStamp(Date.UTC(2026, 0, 15, 5, 7, 8)), "01/15/2026 00:07:08", "January = EST, midnight is 00");
  assert.equal(F.generatedStamp(Date.UTC(2026, 0, 15, 23, 59, 59)), "01/15/2026 18:59:59");
});

test("normalizeNameKey and naturalCompare", () => {
  assert.equal(F.normalizeNameKey("  Nye   Properties LLC. "), "nye properties llc");
  assert.equal(F.normalizeNameKey("Rent Income"), "rent income");
  assert.equal(F.normalizeNameKey("A.B. Corp..."), "a.b. corp");
  assert.ok(F.naturalCompare("Unit 2", "Unit 10") < 0);
  assert.ok(F.naturalCompare("9 A St", "12 B St") < 0);
  assert.ok(F.naturalCompare("12 B St", "108 Jackson Avenue") < 0);
  assert.equal(F.naturalCompare("abc", "ABC"), 0);
});
