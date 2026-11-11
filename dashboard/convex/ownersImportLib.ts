/**
 * Owners import (ROS WP4): pure planning. Spec: docs/specs/ros-build-spec.md 3.2, 3.3, 8 and 12.
 *
 * Source of truth: the client's unit rosters (Gold, Silver, Make Up), already imported onto each
 * property as ownerName / ownerEmails / ownership (convex/rosterImport.ts). Every property names
 * its own owner, so there is NO address matching.
 *
 * Owners are identified by NAME + EMAIL (convex/ownerIdentity.ts, user decision 2026-11-11), both
 * within the roster and against owners already in the app:
 *   - properties with the same normalized name that share an email are one owner (emails unioned);
 *   - the same name with different emails stays separate owners (flag same_name_different_email);
 *   - a shared email under different names stays separate (flag same_email_different_name);
 *   - a property with no email joins the one owner of that name (flag name_only_match); with two
 *     or more such owners it is not linked (flag name_only_ambiguous);
 *   - properties joined only through a chain of shared emails stay one owner, flagged
 *     joined_via_shared_email_chain.
 * Against owners already in the app the import is as strict as the automatic link: no adoption
 * on a name-only match or next to a look-alike, and "Not the same owner" decisions are respected.
 * Nothing is ever merged on a flag: the accountant merges owners on the Owners page.
 *
 * Links are add-only and never added to a property that already has an owner link (to anyone):
 * a property moved to another owner by hand stays where it was put, and is reported under
 * linkedElsewhere ("roster owner differs from the linked owner").
 *
 * Pure: no Convex imports, erasable TypeScript only, so scripts/probes/owners_import.test.mjs
 * loads it directly. convex/ownersImport.ts reads the database, calls planImport and carries out
 * the plan; every decision about what to create, link or report is made here.
 *
 * Never invented: contact names (the roster has none), the management fee (links get none, so the
 * property uses the org default fee) and payeeName (derived). A name that looks like two owners is flagged, never split.
 */

import { validateOwnerFields } from "./rosPolicy";
import { normalizeNameKey } from "./rosFormat";
import { maskEmail } from "./rosterFields";
import { ownerEmailsOf } from "./ownerVerifyLib";
import {
  FLAG_LABEL,
  cleanEmails,
  compareIdentity,
  identityOf,
  identitySignature,
  isExactMatch,
  ownerPairKey,
  propertyOwnerKey,
  type Identity,
  type IdentityFlag,
} from "./ownerIdentity";

export { maskEmail };

// --- inputs --------------------------------------------------------------------------------------

export type Category = "gold" | "silver" | "make_up";
export const CATEGORIES: readonly Category[] = ["gold", "silver", "make_up"];

export type DbProperty = {
  id: string;
  name: string;
  category?: Category;
  ownership?: "company_owned" | "managed";
  ownerName?: string;
  /** properties.ownerEmails, or [ownerEmail] when only that is set. */
  ownerEmails?: string[];
};

export type DbOwner = {
  id: string;
  legalName: string;
  nameKey: string;
  importKey?: string;
  contactFirstName?: string;
  contactLastName?: string;
  emails: string[];
  /** Missing = active (older fixtures). */
  active?: boolean;
  /** Merged into another owner: never matched, never linked. */
  mergedIntoOwnerId?: string;
};

export type DbLink = { ownerId: string; propertyId: string };

export type PlanInput = {
  properties: DbProperty[];
  owners: DbOwner[];
  links: DbLink[];
  /** Properties on an open (status "draft") owner statement: no new link is added to them. */
  draftPropertyIds?: string[];
  /** "Not the same owner" decisions: ownerPairKey(a, b). */
  dismissedOwnerPairs?: string[];
  /** "Not the same owner" decisions: propertyOwnerKey(property, owner, signature). */
  dismissedPropertyOwner?: string[];
};

// --- grouping ------------------------------------------------------------------------------------

export type RosterOwner = {
  /** The plan's key for this owner: the nameKey, plus "#2", "#3"... for further owners of that name. */
  importKey: string;
  nameKey: string;
  /** The roster's ownerName as written (trimmed); the first property's spelling wins. */
  legalName: string;
  /** Lowercased, de-duplicated, in property order. */
  emails: string[];
  properties: DbProperty[];
  /** Names of the properties that joined by name only (they have no email). */
  nameOnly: string[];
  /**
   * True when some of its properties share no email with each other and are one owner only
   * through a chain (A and B share one email, B and C another). Still one owner; flagged.
   */
  chained: boolean;
};

export type RosterGrouping = {
  owners: RosterOwner[];
  /** No-email properties whose name matches two or more roster owners: not linked. */
  ambiguous: Array<{ property: DbProperty; legalName: string; owners: number }>;
};

const ownerNameOf = (p: DbProperty): string | undefined => {
  const t = (p.ownerName ?? "").trim();
  return t === "" ? undefined : t;
};

/** Roster owners by the identity rule (name + email). Properties with no ownerName are left out. */
export function groupRosterOwners(properties: DbProperty[]): RosterGrouping {
  const order = new Map(properties.map((p, i) => [p.id, i]));
  const byOrder = (a: DbProperty, b: DbProperty): number => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  const byName = new Map<string, DbProperty[]>();
  for (const p of properties) {
    const name = ownerNameOf(p);
    if (name === undefined) continue;
    const key = normalizeNameKey(name);
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }

  const owners: RosterOwner[] = [];
  const ambiguous: RosterGrouping["ambiguous"] = [];
  for (const [nameKey, props] of byName) {
    type Cluster = { props: DbProperty[]; emails: string[]; nameOnly: DbProperty[] };
    const clusters: Cluster[] = [];
    for (const p of props) {
      const id = identityOf(p.ownerName, p.ownerEmails);
      if (id.emails.length === 0) continue;
      const hits = clusters.filter((c) => isExactMatch(compareIdentity(id, { nameKey, emails: c.emails })));
      if (hits.length === 0) {
        clusters.push({ props: [p], emails: id.emails, nameOnly: [] });
        continue;
      }
      // p shares an email with each hit, so they are all one owner.
      const into = hits[0];
      for (const other of hits.slice(1)) {
        into.props.push(...other.props);
        clusters.splice(clusters.indexOf(other), 1);
      }
      into.props.push(p);
      into.props.sort(byOrder);
      into.emails = cleanEmails(into.props.flatMap((x) => x.ownerEmails ?? []));
    }
    const noEmail = props.filter((p) => cleanEmails(p.ownerEmails).length === 0);
    if (clusters.length === 0) {
      if (noEmail.length > 0) clusters.push({ props: noEmail, emails: [], nameOnly: noEmail.slice(1) });
    } else if (clusters.length === 1) {
      clusters[0].props.push(...noEmail);
      clusters[0].props.sort(byOrder);
      clusters[0].nameOnly.push(...noEmail);
    } else {
      for (const p of noEmail) ambiguous.push({ property: p, legalName: ownerNameOf(p) as string, owners: clusters.length });
    }
    clusters.sort((a, b) => byOrder(a.props[0], b.props[0]));
    clusters.forEach((c, i) =>
      owners.push({
        importKey: i === 0 ? nameKey : `${nameKey}#${i + 1}`,
        nameKey,
        legalName: ownerNameOf(c.props[0]) as string,
        emails: c.emails,
        properties: c.props,
        nameOnly: c.nameOnly.map((p) => p.name),
        chained: isChained(c.props),
      }),
    );
  }
  return { owners, ambiguous };
}

/** True when two of these properties (both with emails) share no email: joined only via a chain. */
function isChained(props: DbProperty[]): boolean {
  const lists = props.map((p) => cleanEmails(p.ownerEmails)).filter((e) => e.length > 0);
  for (let i = 0; i < lists.length; i++) {
    for (let j = i + 1; j < lists.length; j++) if (!lists[i].some((e) => lists[j].includes(e))) return true;
  }
  return false;
}

/** Why a name may be two owners in one cell, or null. Report only: the name is never split. */
export function twoOwnerReason(name: string): string | null {
  if (name.includes("/")) return 'contains "/"';
  if (/\s&\s/.test(name)) return 'contains " & "';
  if (/\sand\s/i.test(name)) return 'contains " and "';
  return null;
}

// --- plan ----------------------------------------------------------------------------------------

export type OwnerFieldsToWrite = { legalName: string; nameKey: string; emails: string[] };

export type OwnerOp =
  | { kind: "create"; importKey: string; fields: OwnerFieldsToWrite }
  | { kind: "patch"; importKey: string; ownerId: string; patch: { importKey?: string; emails?: string[] } }
  | { kind: "unchanged"; importKey: string; ownerId: string };

export type LinkOp = {
  importKey: string;
  /** Set when the owner already exists; a created owner gets its id when the plan is carried out. */
  ownerId?: string;
  propertyId: string;
  propertyName: string;
};

type CategoryCounts = {
  properties: number;
  withOwner: number;
  noOwner: number;
  companyOwned: number;
  linksToCreate: number;
  linksExisting: number;
};

export type ImportFlag =
  | IdentityFlag
  /** A no-email property whose name matches two or more roster owners (not linked). */
  | "name_only_ambiguous"
  /** A roster owner that matches two or more owners in the app (not imported). */
  | "several_owners_match"
  /** A roster owner that matches an inactive owner (not linked). */
  | "inactive_owner_match"
  /**
   * One owner only through a chain of shared emails: roster properties that share no email with
   * each other, or two roster owners joined by one owner in the app that has both emails. Still
   * one owner (grouped / linked); flagged for a person to check.
   */
  | "joined_via_shared_email_chain"
  /** Some properties were marked "Not the same owner" for the owner the roster matches (not linked). */
  | "dismissed_owner";

/**
 * Compact on purpose: the dry run carries this inside a ConvexError, and Convex cuts error data
 * at about 16 KB. Lists name owners and properties; emails are masked everywhere.
 */
export type ImportReport = {
  owners: { created: number; updated: number; unchanged: number };
  links: { created: number; existing: number };
  /** Per properties.category ("none" = a property with no category, e.g. made by hand). */
  byCategory: Record<Category | "none", CategoryCounts>;
  /** "Ann Able (3 properties)" */
  ownersToCreate: string[];
  /** Identity flags to review (never merged automatically). */
  flags: Array<{ flag: ImportFlag; detail: string }>;
  /** Properties whose roster row names no owner (linked by hand): "7 Birch Road (Gold)". */
  noOwner: string[];
  /** Owners the roster data cannot create (owner rules); not created, not linked. */
  invalid: Array<{ owner: string; message: string; properties: number }>;
  /** Owners whose properties span more than one category: "Ann Able (Gold, Silver; 3 properties)". */
  crossCategory: string[];
  /** Names that may hold two owners; not split, still one owner. */
  twoOwnerNames: Array<{ owner: string; reason: string; properties: number }>;
  /** Company-owned properties per owner: still linked, flagged for review. */
  companyOwned: Array<{ owner: string; properties: string[] }>;
  /** Properties that already have 2+ owner links (statements blocked until split, A10). */
  coOwned: Array<{ property: string; owners: string[] }>;
  /** A new link was NOT added because the property is on an open statement draft: "2 Oak St -> Ann Able". */
  skippedOpenDraft: string[];
  /** The roster names an owner, but the property is already linked to someone else: no link added. */
  linkedElsewhere: Array<{ property: string; roster: string; linkedTo: string[] }>;
  /** Existing owner whose values differ from the roster; left as they are. */
  differsFromRoster: Array<{ owner: string; fields: string[] }>;
  /**
   * Not linked because the match is in doubt (name-only match, a look-alike owner in the app, or
   * "Not the same owner" for that owner): left for the Owners page's "Needs an owner" list.
   */
  needsOwner: Array<{ property: string; roster: string; reason: string }>;
  /** Roster owners NOT created because none of their properties would get a link: "Ann Able (2 properties)". */
  notCreated: string[];
  /** Owner emails on a property page that aren't valid addresses, ignored (as the automatic link does). */
  ignoredEmails: string[];
  /** Set by compactReport when lists had to be cut to fit: list name -> items left out. */
  truncated?: Record<string, number>;
};

export type ImportPlan = { ownerOps: OwnerOp[]; linkOps: LinkOp[]; report: ImportReport };

const sortNames = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const catOf = (p: DbProperty): Category | "none" => p.category ?? "none";
const CAT_LABEL: Record<Category | "none", string> = { gold: "Gold", silver: "Silver", make_up: "Make Up", none: "No category" };
const emptyCounts = (): CategoryCounts => ({
  properties: 0,
  withOwner: 0,
  noOwner: 0,
  companyOwned: 0,
  linksToCreate: 0,
  linksExisting: 0,
});
const q = (s: string): string => `“${s}”`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const masked = (emails: string[]): string => (emails.length === 0 ? "no email" : emails.map(maskEmail).join(", "));

/** The owner rules of the Owners form (fee and payee aside), or null when the owner is valid. */
function ownerProblem(g: RosterOwner): string | null {
  const r = validateOwnerFields({ mode: "update", legalName: g.legalName, emails: g.emails });
  if (r.ok) return null;
  // Never echo a full email address: the CLI prints this message.
  if (r.field === "emails") {
    return `${r.message.includes("at most") ? r.message : "An email address isn't valid."} (${g.emails.map(maskEmail).join(", ")})`;
  }
  return r.message;
}

/**
 * Everything the importer will do, as data. Each roster owner is matched against the owners in
 * the app by the identity rule, as strictly as the automatic link (ownerIdentity.decidePropertyLink):
 *   - exactly one active owner with the same name AND a shared email is adopted (an owner typed in
 *     by hand is not duplicated); a match by name only is never adopted;
 *   - no match creates a new owner, but only when at least one of its properties gets a link;
 *   - two or more matches, or an inactive match, import nothing for it and are flagged;
 *   - a property is not linked (left for the "Needs an owner" list) when an owner in the app looks
 *     like it (flagged, and not marked "Not the same owner"), or when it was marked "Not the same
 *     owner" for the matched owner.
 * A re-run never overwrites a value (only a missing import key is filled in). Links are only ever
 * added, never removed, and never added to a property that already has an owner link. Emails in
 * the report are masked.
 */
export function planImport(input: PlanInput): ImportPlan {
  // The same email check as the automatic link (ownerVerifyLib.ownerEmailsOf): an address that
  // isn't valid is ignored, and said so.
  const ignoredEmails: string[] = [];
  const properties = input.properties.map((p) => {
    const raw = cleanEmails(p.ownerEmails);
    const valid = ownerEmailsOf({ ownerEmails: raw });
    if (valid.length < raw.length) {
      const n = raw.length - valid.length;
      ignoredEmails.push(`${p.name}: ${n} owner email${n === 1 ? " isn't a valid address" : "s aren't valid addresses"}`);
    }
    const out: DbProperty = { ...p };
    if (valid.length > 0) out.ownerEmails = valid;
    else delete out.ownerEmails;
    return out;
  });
  const { owners: groups, ambiguous } = groupRosterOwners(properties);
  const drafts = new Set(input.draftPropertyIds ?? []);
  const dismissedPairs = new Set(input.dismissedOwnerPairs ?? []);
  const dismissedProp = new Set(input.dismissedPropertyOwner ?? []);
  const byCategory = {
    gold: emptyCounts(),
    silver: emptyCounts(),
    make_up: emptyCounts(),
    none: emptyCounts(),
  } as Record<Category | "none", CategoryCounts>;
  const report: ImportReport = {
    owners: { created: 0, updated: 0, unchanged: 0 },
    links: { created: 0, existing: 0 },
    byCategory,
    ownersToCreate: [],
    flags: [],
    noOwner: [],
    invalid: [],
    crossCategory: [],
    twoOwnerNames: [],
    companyOwned: [],
    coOwned: [],
    skippedOpenDraft: [],
    linkedElsewhere: [],
    differsFromRoster: [],
    needsOwner: [],
    notCreated: [],
    ignoredEmails: ignoredEmails.sort(sortNames),
  };

  const noOwnerRows: DbProperty[] = [];
  for (const p of properties) {
    const c = byCategory[catOf(p)];
    c.properties++;
    if (ownerNameOf(p) === undefined) {
      c.noOwner++;
      noOwnerRows.push(p);
    } else c.withOwner++;
    if (p.ownership === "company_owned") c.companyOwned++;
  }
  report.noOwner = noOwnerRows.sort((a, b) => sortNames(a.name, b.name)).map((p) => `${p.name} (${CAT_LABEL[catOf(p)]})`);

  for (const a of ambiguous) {
    report.flags.push({
      flag: "name_only_ambiguous",
      detail: `${a.property.name}: ${q(a.legalName)} has no email and ${a.owners} roster owners have that name. Not linked; link it by hand.`,
    });
  }

  const candidates = input.owners.filter((o) => o.mergedIntoOwnerId === undefined);
  const ownerById = new Map(input.owners.map((o) => [o.id, o]));
  const sigOf = (p: DbProperty): string => identitySignature(identityOf(p.ownerName, p.ownerEmails));
  /** "Not the same owner" for this property and this owner (with the page's current identity). */
  const propDismissed = (p: DbProperty, ownerId: string): boolean => dismissedProp.has(propertyOwnerKey(p.id, ownerId, sigOf(p)));
  const ownerOps: OwnerOp[] = [];
  /** importKey -> the owner in the app it was adopted as. */
  const resolved = new Map<string, string>();
  type Target = {
    g: RosterOwner;
    label: string;
    /** Exact name + email match to one active owner in the app. */
    adopted?: DbOwner;
    /** The one owner in the app it matches by name only: nothing is linked or created for it. */
    nameOnlyMatch?: DbOwner;
    /** Owners in the app that look like it (flagged, not "Not the same owner" as the adopted owner). */
    lookAlikes: Array<{ o: DbOwner; flag: IdentityFlag }>;
  };
  const targets: Target[] = [];
  const companyOwned = new Map<string, string[]>();

  for (const g of groups) {
    const categories = [...new Set(g.properties.map(catOf))].sort();
    const two = twoOwnerReason(g.legalName);
    if (two) report.twoOwnerNames.push({ owner: g.legalName, reason: two, properties: g.properties.length });
    if (categories.length > 1) {
      report.crossCategory.push(`${g.legalName} (${categories.map((c) => CAT_LABEL[c]).join(", ")}; ${plural(g.properties.length, "property", "properties")})`);
    }
    for (const p of g.properties) {
      if (p.ownership === "company_owned") companyOwned.set(g.legalName, [...(companyOwned.get(g.legalName) ?? []), p.name]);
    }
    if (g.nameOnly.length > 0) {
      report.flags.push({
        flag: "name_only_match",
        detail: `${q(g.legalName)}: ${g.nameOnly.join("; ")} ${g.nameOnly.length === 1 ? "has" : "have"} no email and joined this owner by name only.`,
      });
    }
    const label = `${q(g.legalName)} (${plural(g.properties.length, "property", "properties")})`;
    if (g.chained) {
      report.flags.push({
        flag: "joined_via_shared_email_chain",
        detail: `${label}: some of its properties share no email with each other and are one owner only through a chain of shared emails. Grouped as one owner; check it.`,
      });
    }

    const problem = ownerProblem(g);
    if (problem) {
      report.invalid.push({ owner: g.legalName, message: problem, properties: g.properties.length });
      continue;
    }

    const gid: Identity = { nameKey: g.nameKey, emails: g.emails };
    const verdicts = candidates.map((o) => ({ o, v: compareIdentity(gid, identityOf(o.legalName, o.emails)) }));
    const same = verdicts.filter((x) => x.v.same);

    if (same.length > 1) {
      report.flags.push({
        flag: "several_owners_match",
        detail: `${label} matches ${same.length} owners already in the app (${same.map((x) => q(x.o.legalName)).join(", ")}). Not imported: merge them or link by hand.`,
      });
      continue;
    }
    const t: Target = { g, label, lookAlikes: [] };
    if (same.length === 1) {
      const { o, v } = same[0];
      if (o.active === false) {
        report.flags.push({
          flag: "inactive_owner_match",
          detail: `${label} matches the inactive owner ${q(o.legalName)}. Not linked: turn the owner back on or link by hand.`,
        });
        continue;
      }
      if (v.flag === "name_only_match") {
        // Never adopted on the name alone (the same rule as the automatic link).
        t.nameOnlyMatch = o;
        report.flags.push({
          flag: "name_only_match",
          detail: `${label} matches the owner already in the app ${q(o.legalName)} by name only (one side has no email). Not linked: check it on the Needs-an-owner list.`,
        });
      } else {
        t.adopted = o;
        resolved.set(g.importKey, o.id);
      }
    }

    // Owners in the app that look like this roster owner but are kept separate.
    for (const { o, v } of verdicts) {
      if (v.same || v.flag === null) continue;
      if (t.adopted && dismissedPairs.has(ownerPairKey(t.adopted.id, o.id))) continue;
      t.lookAlikes.push({ o, flag: v.flag });
      if (g.properties.every((p) => propDismissed(p, o.id))) continue;
      report.flags.push({
        flag: v.flag,
        detail:
          v.flag === "same_name_different_email"
            ? `${label} (${masked(g.emails)}) and the owner already in the app ${q(o.legalName)} (${masked(o.emails)}) have the same name but different emails. Kept separate.`
            : `${label} and the owner already in the app ${q(o.legalName)} share ${masked(v.sharedEmails)}: possibly the same owner. Kept separate.`,
      });
    }
    const gone = t.adopted ? g.properties.filter((p) => propDismissed(p, (t.adopted as DbOwner).id)) : [];
    if (gone.length > 0) {
      report.flags.push({
        flag: "dismissed_owner",
        detail: `${label}: ${gone.map((p) => p.name).join("; ")} ${gone.length === 1 ? "was" : "were"} marked “Not the same owner” for ${q((t.adopted as DbOwner).legalName)}. Not linked to it.`,
      });
    }
    targets.push(t);
  }

  // Two or more roster owners (different emails) landing on one owner in the app: that owner's
  // emails join them. Still linked to it (each one matches it by name AND email), but flagged.
  const adopters = new Map<string, Target[]>();
  for (const t of targets) if (t.adopted) adopters.set(t.adopted.id, [...(adopters.get(t.adopted.id) ?? []), t]);
  for (const [ownerId, list] of adopters) {
    if (list.length < 2) continue;
    report.flags.push({
      flag: "joined_via_shared_email_chain",
      detail: `${list.map((t) => t.label).join(" and ")} have different emails, but each shares an email with the owner already in the app ${q(ownerById.get(ownerId)?.legalName ?? "Unknown owner")}. All linked to that owner; check it is one owner.`,
    });
  }

  // Per property: link, already linked, linked elsewhere, open draft, or in doubt (left for
  // "Needs an owner"). Links are add-only and never onto a property that already has one.
  const linkedTo = new Map<string, string[]>();
  for (const l of input.links) linkedTo.set(l.propertyId, [...(linkedTo.get(l.propertyId) ?? []), l.ownerId]);
  const linkOps: LinkOp[] = [];
  const patched = new Set<string>();
  for (const t of targets) {
    const { g, adopted } = t;
    const matchedId = adopted?.id ?? t.nameOnlyMatch?.id;
    const mine: LinkOp[] = [];
    for (const p of g.properties) {
      const c = byCategory[catOf(p)];
      const existing = linkedTo.get(p.id) ?? [];
      if (matchedId !== undefined && existing.includes(matchedId)) {
        report.links.existing++;
        c.linksExisting++;
        continue;
      }
      if (existing.length > 0) {
        report.linkedElsewhere.push({
          property: p.name,
          roster: g.legalName,
          linkedTo: existing.map((id) => ownerById.get(id)?.legalName ?? "Unknown owner").sort(sortNames),
        });
        continue;
      }
      if (drafts.has(p.id)) {
        report.skippedOpenDraft.push(`${p.name} -> ${g.legalName}`);
        continue;
      }
      const lookAlike = t.lookAlikes.find((x) => !propDismissed(p, x.o.id));
      const doubt = t.nameOnlyMatch
        ? `matches ${q(t.nameOnlyMatch.legalName)} by name only`
        : adopted && propDismissed(p, adopted.id)
          ? `marked “Not the same owner” for ${q(adopted.legalName)}`
          : lookAlike
            ? `${FLAG_LABEL[lookAlike.flag]}: ${q(lookAlike.o.legalName)}`
            : null;
      if (doubt !== null) {
        report.needsOwner.push({ property: p.name, roster: g.legalName, reason: doubt });
        continue;
      }
      const op: LinkOp = { importKey: g.importKey, propertyId: p.id, propertyName: p.name };
      if (adopted) op.ownerId = adopted.id;
      mine.push(op);
      report.links.created++;
      c.linksToCreate++;
    }
    if (t.nameOnlyMatch) continue;
    if (!adopted) {
      // An owner is only created when at least one of its properties gets a link.
      if (mine.length === 0) {
        report.notCreated.push(`${g.legalName} (${plural(g.properties.length, "property", "properties")})`);
        continue;
      }
      ownerOps.push({ kind: "create", importKey: g.importKey, fields: { legalName: g.legalName, nameKey: g.nameKey, emails: g.emails } });
      report.owners.created++;
      report.ownersToCreate.push(`${g.legalName} (${plural(g.properties.length, "property", "properties")})`);
    } else {
      // Adopted on name + email: only the import key is filled in; nothing is overwritten.
      const patch: { importKey?: string; emails?: string[] } = {};
      const differs: string[] = [];
      const first = !patched.has(adopted.id);
      patched.add(adopted.id);
      if (first && adopted.importKey === undefined) patch.importKey = g.importKey;
      if (adopted.legalName !== g.legalName) differs.push("legalName");
      if (g.emails.length > 0 && !sameSet(adopted.emails, g.emails)) differs.push("emails");
      if (differs.length > 0) report.differsFromRoster.push({ owner: adopted.legalName, fields: differs });
      if (Object.keys(patch).length > 0) {
        ownerOps.push({ kind: "patch", importKey: g.importKey, ownerId: adopted.id, patch });
        report.owners.updated++;
      } else {
        ownerOps.push({ kind: "unchanged", importKey: g.importKey, ownerId: adopted.id });
        report.owners.unchanged++;
      }
    }
    linkOps.push(...mine);
  }

  // Roster owners that look alike but are kept separate (same name / different emails, or a
  // shared email under different names). Not reported when both already resolve to one owner, or
  // to two owners someone marked "Not the same owner".
  const suppressed = (a: RosterOwner, b: RosterOwner): boolean => {
    const ia = resolved.get(a.importKey);
    const ib = resolved.get(b.importKey);
    if (ia === undefined || ib === undefined) return false;
    return ia === ib || dismissedPairs.has(ownerPairKey(ia, ib));
  };
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      const v = compareIdentity({ nameKey: a.nameKey, emails: a.emails }, { nameKey: b.nameKey, emails: b.emails });
      if (v.same || v.flag === null || suppressed(a, b)) continue;
      const la = `${q(a.legalName)} (${plural(a.properties.length, "property", "properties")})`;
      const lb = `${q(b.legalName)} (${plural(b.properties.length, "property", "properties")})`;
      report.flags.push({
        flag: v.flag,
        detail:
          v.flag === "same_name_different_email"
            ? `${la} with ${masked(a.emails)} and ${lb} with ${masked(b.emails)}: same name, different emails. Kept as separate owners.`
            : `${la} and ${lb} share ${masked(v.sharedEmails)}: possibly the same owner. Kept separate.`,
      });
    }
  }

  const propertyById = new Map(input.properties.map((p) => [p.id, p]));
  for (const [propertyId, ids] of linkedTo) {
    if (ids.length < 2) continue;
    report.coOwned.push({
      property: propertyById.get(propertyId)?.name ?? propertyId,
      owners: ids.map((id) => ownerById.get(id)?.legalName ?? "Unknown owner").sort(sortNames),
    });
  }

  report.companyOwned = [...companyOwned]
    .map(([owner, properties]) => ({ owner, properties: properties.sort(sortNames) }))
    .sort((a, b) => sortNames(a.owner, b.owner));
  report.coOwned.sort((a, b) => sortNames(a.property, b.property));
  report.linkedElsewhere.sort((a, b) => sortNames(a.property, b.property));
  return { ownerOps, linkOps, report };
}

// --- transport -----------------------------------------------------------------------------------

/** Convex cuts error data at about 16 KB; the dry-run report must stay well under it. */
export const MAX_REPORT_BYTES = 12_000;

export function jsonBytes(x: unknown): number {
  return new TextEncoder().encode(JSON.stringify(x)).length;
}

const LIST_KEYS = [
  "ownersToCreate",
  "flags",
  "noOwner",
  "invalid",
  "crossCategory",
  "twoOwnerNames",
  "companyOwned",
  "coOwned",
  "skippedOpenDraft",
  "linkedElsewhere",
  "differsFromRoster",
  "needsOwner",
  "notCreated",
  "ignoredEmails",
] as const;

/**
 * The report cut to fit `maxBytes` (JSON, UTF-8): the longest list is shortened first, and
 * `truncated` says how many items each list lost. Counts are never cut. A realistic roster fits
 * without cutting; this is the safety net that keeps the dry run readable instead of truncated.
 */
export function compactReport(report: ImportReport, maxBytes: number = MAX_REPORT_BYTES): ImportReport {
  if (jsonBytes(report) <= maxBytes) return report;
  const out: ImportReport = { ...report, truncated: { ...(report.truncated ?? {}) } };
  const lists = out as unknown as Record<string, unknown[]>;
  for (const k of LIST_KEYS) lists[k] = [...lists[k]];
  for (let guard = 0; guard < 10_000 && jsonBytes(out) > maxBytes; guard++) {
    let longest: (typeof LIST_KEYS)[number] | null = null;
    let size = 0;
    for (const k of LIST_KEYS) {
      const s = lists[k].length === 0 ? 0 : jsonBytes(lists[k]);
      if (s > size) {
        size = s;
        longest = k;
      }
    }
    if (longest === null) break;
    const list = lists[longest];
    const drop = Math.max(1, Math.floor(list.length / 4));
    list.splice(list.length - drop, drop);
    (out.truncated as Record<string, number>)[longest] = ((out.truncated as Record<string, number>)[longest] ?? 0) + drop;
  }
  return out;
}
