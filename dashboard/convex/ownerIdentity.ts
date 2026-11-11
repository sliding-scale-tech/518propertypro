/**
 * Owner identity (ROS): who is the same rental owner as whom. User decision 2026-11-11: an owner
 * is identified by NAME and EMAIL together. This is the ONE rule; the owners import
 * (ownersImportLib.ts), the automatic owner link when a property is saved (ownerLinking.ts), the
 * "Needs an owner" list and the merge checks (owners.ts) all call it.
 *
 *   same normalized name + at least one shared email        -> same owner
 *   same name, both sides have emails, none shared          -> separate, flag same_name_different_email
 *   different name, a shared email                          -> separate, flag same_email_different_name
 *   same name, one side (or both) has no email              -> same owner, flag name_only_match
 *   neither                                                 -> different owners
 *
 * Names compare by normalizeNameKey (case, inner spaces, trailing period). Emails compare exactly
 * after trim + lowercase: there is no domain or fuzzy matching, so two joint owners on
 * @518propertypro.com addresses are only flagged when they share the exact same address. A flag
 * never merges anything: a person decides (Merge owners, or "Not the same owner").
 *
 * Pure: no Convex imports, erasable TypeScript only, so the node tests load it directly.
 */

import { formatBps, normalizeNameKey } from "./rosFormat";
import { MAX_EMAILS, validateOwnerFields } from "./rosPolicy";
import { maskEmail } from "./rosterFields";

export { maskEmail };

// --- the rule ------------------------------------------------------------------------------------

export type IdentityFlag = "same_name_different_email" | "same_email_different_name" | "name_only_match";

export type Identity = { nameKey: string; emails: string[] };

export type IdentityVerdict = {
  /** True = the same owner (exact, or flagged name_only_match). */
  same: boolean;
  /** Null = no doubt either way (an exact match, or clearly different owners). */
  flag: IdentityFlag | null;
  sharedEmails: string[];
};

/** Trimmed, lowercased, blanks dropped, de-duplicated, in the order given. */
export function cleanEmails(raw: ReadonlyArray<string | null | undefined> | null | undefined): string[] {
  const out: string[] = [];
  for (const r of raw ?? []) {
    const e = (typeof r === "string" ? r : "").trim().toLowerCase();
    if (e !== "" && !out.includes(e)) out.push(e);
  }
  return out;
}

export function identityOf(name: string | null | undefined, emails: ReadonlyArray<string | null | undefined> | null | undefined): Identity {
  return { nameKey: normalizeNameKey(typeof name === "string" ? name : ""), emails: cleanEmails(emails) };
}

/** The identity rule (see the table at the top). An empty name never matches by name. */
export function compareIdentity(a: Identity, b: Identity): IdentityVerdict {
  const sharedEmails = a.emails.filter((e) => b.emails.includes(e));
  const sameName = a.nameKey !== "" && a.nameKey === b.nameKey;
  if (sameName) {
    if (sharedEmails.length > 0) return { same: true, flag: null, sharedEmails };
    if (a.emails.length === 0 || b.emails.length === 0) return { same: true, flag: "name_only_match", sharedEmails };
    return { same: false, flag: "same_name_different_email", sharedEmails };
  }
  if (sharedEmails.length > 0) return { same: false, flag: "same_email_different_name", sharedEmails };
  return { same: false, flag: null, sharedEmails };
}

/** An exact match: the same owner with nothing to review. */
export function isExactMatch(v: IdentityVerdict): boolean {
  return v.same && v.flag === null;
}

export const FLAG_LABEL: Record<IdentityFlag, string> = {
  same_name_different_email: "Same name, different email",
  same_email_different_name: "Same email, different name: possibly the same owner",
  name_only_match: "Same name, but no email to confirm it",
};

// --- dismissals ("Not the same owner") -----------------------------------------------------------

/** Order-independent key of two owners. */
export function ownerPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The roster identity of a property, as stored with a dismissal: a later change brings the flag back. */
export function identitySignature(id: Identity): string {
  return `${id.nameKey}|${[...id.emails].sort().join(",")}`;
}

/** Key of "this property's owner (as the property page states it) is not this owner". */
export function propertyOwnerKey(propertyId: string, ownerId: string, signature: string): string {
  return `${propertyId}|${ownerId}|${signature}`;
}

export type Dismissals = {
  /** ownerPairKey(a, b) */
  ownerPairs: ReadonlySet<string>;
  /** propertyOwnerKey(property, owner, signature) */
  propertyOwner: ReadonlySet<string>;
};

export const NO_DISMISSALS: Dismissals = { ownerPairs: new Set(), propertyOwner: new Set() };

// --- deciding a property's owner link ------------------------------------------------------------

export type IdOwner = {
  id: string;
  legalName: string;
  emails: string[];
  active: boolean;
  /** Set on an owner merged into another one; such an owner is never matched. */
  mergedIntoOwnerId?: string;
};

export type LinkDecisionInput = {
  property: { id: string; ownerName?: string | null; ownerEmails?: ReadonlyArray<string | null | undefined> | null };
  owners: IdOwner[];
  /** Owners this property is linked to today (ownerProperties). */
  linkedOwnerIds: string[];
  /** The property is on an open (draft) owner statement. */
  hasOpenDraft: boolean;
  dismissed?: Dismissals;
};

export type Candidate = { ownerId: string; flag: IdentityFlag | null; sharedEmails: string[] };

export type NeedsReason =
  | "no_owner_name"
  | "open_draft"
  | "invalid_owner_data"
  | "inactive_owner"
  | "several_match"
  | "no_email"
  | "flagged"
  /** Nobody is left to match, but a same-name owner was marked "Not the same owner" for it. */
  | "dismissed_match";

export type LinkDecision =
  /** Linked, and the property page agrees (or says nothing). */
  | { kind: "linked" }
  /** Linked, but the property page names someone else. Never moved automatically. */
  | { kind: "mismatch"; linkedOwnerIds: string[]; candidates: Candidate[] }
  /** Exactly one active owner matches by name AND email, and nothing else is in doubt. */
  | { kind: "link"; ownerId: string }
  /** Nobody matches or is in doubt, and the property page has a name and an email. */
  | { kind: "create"; legalName: string; emails: string[] }
  /** A person has to decide. */
  | { kind: "needs"; reason: NeedsReason; candidates: Candidate[]; message?: string };

/** Why the roster data can't make an owner (the owner form's rules, fee aside), or null. */
export function ownerDataProblem(legalName: string, emails: string[]): string | null {
  const r = validateOwnerFields({ mode: "update", legalName, emails });
  if (r.ok) return null;
  if (r.field === "emails") return r.message.includes("at most") ? r.message : "An owner email on the property page isn't valid.";
  return r.message;
}

/**
 * What to do with one property's owner link. Conservative on purpose: it links only on an exact
 * name + email match to exactly one active owner with no other owner in doubt, creates an owner
 * only when nobody matches at all, and never moves or adds a link on a property that already
 * has one.
 */
export function decidePropertyLink(input: LinkDecisionInput): LinkDecision {
  const dismissed = input.dismissed ?? NO_DISMISSALS;
  const name = (input.property.ownerName ?? "").trim();
  const me = identityOf(name, input.property.ownerEmails);
  const signature = identitySignature(me);
  const notDismissedFor = (ownerId: string): boolean =>
    !dismissed.propertyOwner.has(propertyOwnerKey(input.property.id, ownerId, signature));
  const owners = input.owners.filter((o) => o.mergedIntoOwnerId === undefined);

  const candidatesOf = (list: IdOwner[]): Candidate[] => {
    const out: Candidate[] = [];
    for (const o of list) {
      if (!notDismissedFor(o.id)) continue;
      const v = compareIdentity(me, identityOf(o.legalName, o.emails));
      if (v.same || v.flag !== null) out.push({ ownerId: o.id, flag: v.flag, sharedEmails: v.sharedEmails });
    }
    return out;
  };

  if (input.linkedOwnerIds.length > 0) {
    // The roster says nothing about the name: nothing to compare.
    if (me.nameKey === "") return { kind: "linked" };
    const linked = owners.filter((o) => input.linkedOwnerIds.includes(o.id));
    const agrees = linked.some((o) => compareIdentity(me, identityOf(o.legalName, o.emails)).same);
    const allDismissed = input.linkedOwnerIds.every((id) => !notDismissedFor(id));
    if (agrees || allDismissed) return { kind: "linked" };
    return {
      kind: "mismatch",
      linkedOwnerIds: [...input.linkedOwnerIds],
      candidates: candidatesOf(owners.filter((o) => !input.linkedOwnerIds.includes(o.id))),
    };
  }

  if (me.nameKey === "") return { kind: "needs", reason: "no_owner_name", candidates: [] };
  const candidates = candidatesOf(owners);
  if (input.hasOpenDraft) return { kind: "needs", reason: "open_draft", candidates };
  const problem = ownerDataProblem(name, me.emails);
  if (problem) return { kind: "needs", reason: "invalid_owner_data", candidates, message: problem };

  // A candidate with no flag is an exact match (candidatesOf keeps only same-or-flagged owners).
  const exact = candidates.filter((c) => c.flag === null);
  if (exact.length > 1) return { kind: "needs", reason: "several_match", candidates };
  // Owners already confirmed as "not the same owner" as the exact match don't cast doubt on it.
  const doubts = candidates.filter(
    (c) => c.flag !== null && !(exact.length === 1 && dismissed.ownerPairs.has(ownerPairKey(exact[0].ownerId, c.ownerId))),
  );
  if (exact.length === 1) {
    if (doubts.length > 0) return { kind: "needs", reason: "flagged", candidates };
    const owner = owners.find((o) => o.id === exact[0].ownerId);
    if (!owner || !owner.active) return { kind: "needs", reason: "inactive_owner", candidates };
    return { kind: "link", ownerId: owner.id };
  }
  if (doubts.length > 0) return { kind: "needs", reason: "flagged", candidates };
  if (me.emails.length === 0) return { kind: "needs", reason: "no_email", candidates };
  // An owner with this name (and no email, or a shared one) was marked "Not the same owner" for
  // this property: a new owner would look exactly like it, so a person decides.
  if (createConflict(me, owners)) return { kind: "needs", reason: "dismissed_match", candidates };
  return { kind: "create", legalName: name, emails: me.emails };
}

/**
 * True when a new owner with this identity would clash with an owner that is not merged: the same
 * name with no email on either side, or the same name sharing an email. The same rule as
 * owners.createForProperty's same-name check.
 */
export function createConflict(me: Identity, owners: IdOwner[]): boolean {
  if (me.nameKey === "") return false;
  return owners.some((o) => {
    if (o.mergedIntoOwnerId !== undefined) return false;
    const them = identityOf(o.legalName, o.emails);
    if (them.nameKey !== me.nameKey) return false;
    return me.emails.length === 0 || them.emails.length === 0 || them.emails.some((e) => me.emails.includes(e));
  });
}

// --- messages for owner writes -------------------------------------------------------------------

/** owners.update / setActive / linkProperty on an owner that was merged into another one. */
export function ownerMergedMessage(name: string, intoName: string): string {
  return `${name} was merged into ${intoName}.`;
}

export const EXACT_MATCH_NOT_DISMISSABLE =
  "This owner matches the property's name and email exactly. Link it, or change the owner on the property page.";

/**
 * Why "Not the same owner" (property -> owner) is refused, or null: an owner that matches an
 * unlinked property's name and email exactly is the owner the identity rule would link, so the
 * accountant links it (or fixes the property page) instead of hiding it.
 */
export function propertyDismissProblem(input: {
  propertyLinked: boolean;
  property: { ownerName?: string | null; ownerEmails?: ReadonlyArray<string | null | undefined> | null };
  owner: { legalName: string; emails: string[]; mergedIntoOwnerId?: string };
}): string | null {
  if (input.propertyLinked || input.owner.mergedIntoOwnerId !== undefined) return null;
  const v = compareIdentity(identityOf(input.property.ownerName, input.property.ownerEmails), identityOf(input.owner.legalName, input.owner.emails));
  return isExactMatch(v) ? EXACT_MATCH_NOT_DISMISSABLE : null;
}

// --- "Link all exact matches" (the Needs-an-owner bulk action) -----------------------------------

/** Properties one "Link all exact matches" call links at most; the button repeats for the rest. */
export const LINK_ALL_LIMIT = 100;

export type BulkPropertyInput = {
  id: string;
  /** The property's name, for messages. */
  name: string;
  ownerName?: string | null;
  ownerEmails?: ReadonlyArray<string | null | undefined> | null;
  linkedOwnerIds: string[];
  hasOpenDraft: boolean;
};

export type BulkAction =
  /** Link to an owner that exists ("Ready to link"). */
  | { kind: "link"; ownerId: string }
  /** Create the owner from the property page and link it ("New owner"). */
  | { kind: "create"; legalName: string; emails: string[] }
  /** Link to the owner the same run creates from property `fromPropertyId` (same name + email). */
  | { kind: "link_new"; fromPropertyId: string };

export type BulkRow = {
  propertyId: string;
  decision: LinkDecision;
  /** What "Link all exact matches" does with this property; null = doubtful (or nothing to do). */
  action: BulkAction | null;
  /** Why the property is left out of the bulk action, in plain words; null when it is safe. */
  doubt: string | null;
};

export const DOUBT_FLAG_TEXT: Record<IdentityFlag, string> = {
  same_email_different_name: "Same email, different name",
  same_name_different_email: "Same name, different email",
  name_only_match: "Name-only match, no email to confirm it",
};

export const DOUBT_REASON_TEXT: Record<NeedsReason | "mismatch", string> = {
  no_owner_name: "Missing owner name on the property page",
  open_draft: "On an open draft statement",
  invalid_owner_data: "The owner details on the property page can't make an owner",
  inactive_owner: "Matches an inactive owner",
  several_match: "Several possible owners",
  no_email: "Missing email on the property page",
  flagged: "An owner looks similar",
  dismissed_match: "A same-name owner was marked “Not the same owner”",
  mismatch: "The property page differs from the linked owner",
};

/** Plain-words reason a decision is not safe for the bulk action. */
export function doubtOf(d: LinkDecision): string | null {
  if (d.kind === "linked" || d.kind === "link" || d.kind === "create") return null;
  if (d.kind === "mismatch") return DOUBT_REASON_TEXT.mismatch;
  if (d.reason === "invalid_owner_data" && d.message) return `${DOUBT_REASON_TEXT.invalid_owner_data}: ${d.message}`;
  if (d.reason !== "flagged") return DOUBT_REASON_TEXT[d.reason];
  const flags = [...new Set(d.candidates.map((c) => c.flag).filter((f): f is IdentityFlag => f !== null))];
  const parts = flags.map((f) => DOUBT_FLAG_TEXT[f]);
  if (d.candidates.length > 1) parts.push(DOUBT_REASON_TEXT.several_match.toLowerCase());
  return parts.length > 0 ? parts.join("; ") : DOUBT_REASON_TEXT.flagged;
}

/**
 * What "Link all exact matches" would do with every property, decided by the same rule as the
 * automatic link (decidePropertyLink), plus checks across the list itself:
 *   - "Ready to link" (one exact, unflagged, active owner) is safe;
 *   - "New owner" is safe only when no other property on the list looks like it (same name with
 *     another email, or no email; same email under another name). Properties with the same name
 *     and a shared email are one new owner: the first (in the order given) creates it, the rest
 *     link to it. If one of them is doubtful, all of them are;
 *   - everything else is doubtful, with the reason.
 * Pure; the caller passes the properties in display order. Properties already linked and agreeing
 * with their owner are left out.
 */
export function planLinkAll(input: { properties: BulkPropertyInput[]; owners: IdOwner[]; dismissed?: Dismissals }): BulkRow[] {
  const dismissed = input.dismissed ?? NO_DISMISSALS;
  type Item = { p: BulkPropertyInput; me: Identity; d: LinkDecision; action: BulkAction | null; doubt: string | null };
  const items: Item[] = [];
  for (const p of input.properties) {
    const d = decidePropertyLink({
      property: { id: p.id, ownerName: p.ownerName, ownerEmails: p.ownerEmails },
      owners: input.owners,
      linkedOwnerIds: p.linkedOwnerIds,
      hasOpenDraft: p.hasOpenDraft,
      dismissed,
    });
    if (d.kind === "linked") continue;
    const action: BulkAction | null =
      d.kind === "link" ? { kind: "link", ownerId: d.ownerId } : d.kind === "create" ? { kind: "create", legalName: d.legalName, emails: d.emails } : null;
    items.push({ p, me: identityOf(p.ownerName, p.ownerEmails), d, action, doubt: doubtOf(d) });
  }

  // "New owner" rows against every other unlinked property that names an owner.
  const unlinked = items.filter((x) => x.p.linkedOwnerIds.length === 0 && x.me.nameKey !== "");
  const creates = items.filter((x) => x.d.kind === "create");
  for (const x of creates) {
    for (const other of unlinked) {
      if (other === x) continue;
      const v = compareIdentity(x.me, other.me);
      if (v.flag === null) continue;
      x.doubt = `${DOUBT_FLAG_TEXT[v.flag]} as ${other.p.name}, also on this list`;
      break;
    }
  }
  // Same name + shared email = one new owner: group them (transitively) and keep them together.
  const groups: Item[][] = [];
  for (const x of creates) {
    const hits = groups.filter((g) => g.some((y) => isExactMatch(compareIdentity(x.me, y.me))));
    const into: Item[] = hits.length > 0 ? hits[0] : [];
    if (hits.length === 0) groups.push(into);
    for (const other of hits.slice(1)) {
      into.push(...other);
      groups.splice(groups.indexOf(other), 1);
    }
    into.push(x);
  }
  const order = new Map(items.map((x, i) => [x, i]));
  for (const g of groups) {
    g.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const bad = g.find((x) => x.doubt !== null);
    if (bad) {
      for (const x of g) if (x.doubt === null) x.doubt = `Same owner as ${bad.p.name}, which needs a check first`;
      continue;
    }
    for (const x of g.slice(1)) x.action = { kind: "link_new", fromPropertyId: g[0].p.id };
  }
  return items.map((x) => ({ propertyId: x.p.id, decision: x.d, action: x.doubt === null ? x.action : null, doubt: x.doubt }));
}

/** Counts of what "Link all exact matches" would do, for the confirmation dialog. */
export function linkAllCounts(rows: BulkRow[], limit: number = LINK_ALL_LIMIT): {
  link: number;
  create: number;
  linkNew: number;
  total: number;
  doubtful: number;
  thisRun: number;
} {
  const out = { link: 0, create: 0, linkNew: 0, total: 0, doubtful: 0, thisRun: 0 };
  for (const r of rows) {
    if (r.action === null) {
      if (r.doubt !== null) out.doubtful++;
      continue;
    }
    out.total++;
    if (r.action.kind === "link") out.link++;
    else if (r.action.kind === "create") out.create++;
    else out.linkNew++;
  }
  out.thisRun = Math.min(out.total, limit);
  return out;
}

export const NEEDS_REASON_TEXT: Record<NeedsReason | "mismatch" | "link" | "create", string> = {
  no_owner_name: "The property page has no owner name.",
  open_draft: "This property is on an open draft statement. Finalize or discard it, then link the owner.",
  invalid_owner_data: "The owner details on the property page can't make an owner.",
  inactive_owner: "It matches an inactive owner. Turn that owner back on, or link another owner.",
  several_match: "Several owners match this name and email. Merge them, or link one by hand.",
  no_email: "The property page has an owner name but no email, and no owner has that name.",
  flagged: "An owner looks similar. Check whether it is the same owner.",
  dismissed_match:
    "An owner with this name was marked “Not the same owner” for this property, so no owner is made automatically. Link or create the owner by hand.",
  mismatch: "The property page names a different owner than the one its statements are linked to.",
  link: "Matches an owner by name and email.",
  create: "No owner has this name or email yet.",
};

// --- merge preconditions -------------------------------------------------------------------------

export type MergeSide = {
  id: string;
  legalName: string;
  emails: string[];
  active: boolean;
  /** DEPRECATED owner-level fee: owners.ts no longer passes it (the fee is per link, LinkSettings). */
  managementFeeBps?: number;
  payeeName?: string;
  mergedIntoOwnerId?: string;
  hasFinal: boolean;
  hasOpenDraft: boolean;
  /** Ledger rows (not voided) that belong to this owner. */
  ledgerRows: number;
};

export type LinkSettings = {
  openingBalanceCents?: number;
  startMonth?: string;
  propertyReserveCents?: number;
  /** The property's own management fee (bps); undefined = the org default. */
  managementFeeBps?: number;
};

export const MERGE_MSG = {
  keepMissing: "Select the owner to keep.",
  mergeMissing: "Select the owner to merge into it.",
  sameOwner: "Pick two different owners to merge.",
  alreadyMerged: (name: string): string => `${name} was already merged into another owner.`,
  keepInactive: (name: string): string => `${name} is inactive. Turn it back on first, or keep the other owner.`,
  hasFinal: (name: string): string =>
    `${name} already has a final statement, so it can't be merged. Final statements stay with the owner they were issued to.`,
  hasDraft: (name: string): string => `${name} has an open draft statement. Finalize or discard it first.`,
  ledger: (name: string, n: number): string =>
    `${name} has ${n} ledger transaction${n === 1 ? "" : "s"}. Void ${n === 1 ? "it" : "them"} first (or merge the other way round).`,
  feeDiffers: (keep: string, keepFee: string, merge: string, mergeFee: string): string =>
    `The management fees differ (${keep}: ${keepFee}, ${merge}: ${mergeFee}). Make them match on both owners first.`,
  payeeDiffers: (keep: string, keepPayee: string, merge: string, mergePayee: string): string =>
    `The owner draw payees differ (${keep}: ${keepPayee}, ${merge}: ${mergePayee}). Make them match on both owners first.`,
  tooManyEmails: (n: number): string =>
    `Together these owners have ${n} email addresses, and an owner can have at most ${MAX_EMAILS}. Remove some first.`,
  linkSettingsDiffer: (property: string): string =>
    `Both owners are linked to ${property} with different opening balance, first statement month, reserve or management fee. Make them match, or unlink it from one owner first.`,
} as const;

const feeText = (bps: number | undefined): string => (bps === undefined ? "not set" : `${formatBps(bps)}%`);
const payeeText = (p: string | undefined): string => (p === undefined || p.trim() === "" ? "not set" : p);

/** Emails of the kept owner first, then the merged owner's new ones. */
export function mergedEmails(keep: string[], merge: string[]): string[] {
  return cleanEmails([...keep, ...merge]);
}

function sameSettings(a: LinkSettings, b: LinkSettings): boolean {
  return (
    a.openingBalanceCents === b.openingBalanceCents &&
    a.startMonth === b.startMonth &&
    a.propertyReserveCents === b.propertyReserveCents &&
    a.managementFeeBps === b.managementFeeBps
  );
}

function hasSettings(s: LinkSettings): boolean {
  return (
    s.openingBalanceCents !== undefined ||
    s.startMonth !== undefined ||
    s.propertyReserveCents !== undefined ||
    s.managementFeeBps !== undefined
  );
}

/**
 * Why owner `merge` can't be merged into owner `keep`, or null. `sharedLinks` = properties linked
 * to both, with each side's link settings.
 */
export function mergeProblem(
  keep: MergeSide | null,
  merge: MergeSide | null,
  sharedLinks: Array<{ propertyName: string; keep: LinkSettings; merge: LinkSettings }> = [],
): { field: "keepOwnerId" | "mergeOwnerId"; message: string } | null {
  if (!keep) return { field: "keepOwnerId", message: MERGE_MSG.keepMissing };
  if (!merge) return { field: "mergeOwnerId", message: MERGE_MSG.mergeMissing };
  if (keep.id === merge.id) return { field: "mergeOwnerId", message: MERGE_MSG.sameOwner };
  if (keep.mergedIntoOwnerId !== undefined) return { field: "keepOwnerId", message: MERGE_MSG.alreadyMerged(keep.legalName) };
  if (merge.mergedIntoOwnerId !== undefined) return { field: "mergeOwnerId", message: MERGE_MSG.alreadyMerged(merge.legalName) };
  if (!keep.active) return { field: "keepOwnerId", message: MERGE_MSG.keepInactive(keep.legalName) };
  for (const [field, side] of [["keepOwnerId", keep], ["mergeOwnerId", merge]] as const) {
    if (side.hasFinal) return { field, message: MERGE_MSG.hasFinal(side.legalName) };
    if (side.hasOpenDraft) return { field, message: MERGE_MSG.hasDraft(side.legalName) };
  }
  if (merge.ledgerRows > 0) return { field: "mergeOwnerId", message: MERGE_MSG.ledger(merge.legalName, merge.ledgerRows) };
  if (merge.managementFeeBps !== undefined && merge.managementFeeBps !== keep.managementFeeBps) {
    return {
      field: "mergeOwnerId",
      message: MERGE_MSG.feeDiffers(keep.legalName, feeText(keep.managementFeeBps), merge.legalName, feeText(merge.managementFeeBps)),
    };
  }
  const mergePayee = merge.payeeName?.trim() ?? "";
  if (mergePayee !== "" && mergePayee !== (keep.payeeName?.trim() ?? "")) {
    return {
      field: "mergeOwnerId",
      message: MERGE_MSG.payeeDiffers(keep.legalName, payeeText(keep.payeeName), merge.legalName, payeeText(merge.payeeName)),
    };
  }
  const emails = mergedEmails(keep.emails, merge.emails);
  if (emails.length > MAX_EMAILS) return { field: "mergeOwnerId", message: MERGE_MSG.tooManyEmails(emails.length) };
  for (const s of sharedLinks) {
    if (hasSettings(s.merge) && !sameSettings(s.keep, s.merge)) {
      return { field: "mergeOwnerId", message: MERGE_MSG.linkSettingsDiffer(s.propertyName) };
    }
  }
  return null;
}
