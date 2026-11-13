/**
 * Bulk "Change asset manager" (whole building, or a whole team optionally limited to one current
 * manager): the pure parts shared by the client form, the preview query and the batched apply.
 *
 * Pure: no Convex imports, erasable TypeScript only (Node's test runner loads it directly).
 * The client and the server use the SAME validation and the same messages, so what the form says
 * before submitting and what the server says if it disagrees are word for word identical.
 */

export type BulkTeam = "gold" | "silver" | "make_up";
export const BULK_TEAMS: readonly BulkTeam[] = ["gold", "silver", "make_up"];
export const BULK_TEAM_LABEL: Readonly<Record<BulkTeam, string>> = { gold: "Gold", silver: "Silver", make_up: "Make Up" };

export function isBulkTeam(v: unknown): v is BulkTeam {
  return v === "gold" || v === "silver" || v === "make_up";
}

export const BULK_REASON_MIN = 3;
export const BULK_REASON_MAX = 500;
/** Units moved per internal mutation. Each unit is a patch, an audit row and its open requests. */
export const BULK_BATCH_SIZE = 40;

export const BULK_MSG = {
  chooseManager: "Choose the new asset manager.",
  notAnAm: "That person is not an asset manager on this team.",
  reasonMissing: "Enter a reason for this change.",
  reasonShort: `Enter a reason of at least ${BULK_REASON_MIN} characters.`,
  reasonLong: `The reason is too long (max ${BULK_REASON_MAX} characters).`,
  chooseScope: "Choose a building or a team to change.",
  teamUnknown: "That team does not exist. Choose Gold, Silver or Make Up.",
  buildingNotFound: "Building not found.",
  fromNotFound: "The asset manager to move units away from was not found.",
  sameAsFrom: "Choose a different new asset manager: that is the person the units are moving away from.",
} as const;

export type BulkField = "toUserId" | "reason" | "fromUserId";
export type BulkFieldError = { field: BulkField; message: string };

/** Trim and drop control characters (same rule as the single-unit reason). */
export function cleanReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

/**
 * Field checks for the form, in on-screen order. Empty/null/undefined all mean "nothing chosen"
 * (a select can hand back "" or null). Returns every problem, so the form can mark each field.
 */
export function validateBulkInput(input: {
  toUserId: string | null | undefined;
  reason: string | null | undefined;
  fromUserId?: string | null | undefined;
}): BulkFieldError[] {
  const out: BulkFieldError[] = [];
  const to = typeof input.toUserId === "string" ? input.toUserId.trim() : "";
  const from = typeof input.fromUserId === "string" ? input.fromUserId.trim() : "";
  if (to === "") out.push({ field: "toUserId", message: BULK_MSG.chooseManager });
  else if (from !== "" && from === to) out.push({ field: "toUserId", message: BULK_MSG.sameAsFrom });
  const reason = cleanReason(input.reason);
  if (reason === "") out.push({ field: "reason", message: BULK_MSG.reasonMissing });
  else if (reason.length < BULK_REASON_MIN) out.push({ field: "reason", message: BULK_MSG.reasonShort });
  else if (reason.length > BULK_REASON_MAX) out.push({ field: "reason", message: BULK_MSG.reasonLong });
  return out;
}

export type PlanUnit = { unitId: string; propertyId: string; assetManagerUserId: string };

/**
 * Which units in scope move: every unit not already with `to`, limited to those `from` holds when
 * `from` is given. `fromCounts` is per current manager, largest first (ties by id, stable).
 */
export function planBulkMove<U extends PlanUnit>(
  units: readonly U[],
  to: string,
  from?: string | null,
): {
  total: number;
  inFilter: number;
  alreadyWithTarget: number;
  moving: U[];
  fromCounts: Array<{ userId: string; count: number }>;
  buildings: string[];
} {
  const inFilter = from ? units.filter((u) => u.assetManagerUserId === from) : units.slice();
  const moving = inFilter.filter((u) => u.assetManagerUserId !== to);
  const counts = new Map<string, number>();
  for (const u of moving) counts.set(u.assetManagerUserId, (counts.get(u.assetManagerUserId) ?? 0) + 1);
  const fromCounts = [...counts.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
  const buildings = [...new Set(moving.map((u) => u.propertyId))];
  return {
    total: units.length,
    inFilter: inFilter.length,
    alreadyWithTarget: units.filter((u) => u.assetManagerUserId === to).length,
    moving,
    fromCounts,
    buildings,
  };
}

/** The next batch to apply: the first `size` of what still needs to move. */
export function nextBatch<U extends PlanUnit>(units: readonly U[], to: string, from: string | null | undefined, size = BULK_BATCH_SIZE): U[] {
  return planBulkMove(units, to, from).moving.slice(0, Math.max(1, Math.floor(size)));
}

/** How many batch mutations a move of `count` units takes (the apply loop's upper bound). */
export function batchCount(count: number, size = BULK_BATCH_SIZE): number {
  if (!(count > 0)) return 0;
  return Math.ceil(count / Math.max(1, Math.floor(size)));
}

/** "Nikki", "Nikki and Pat", "Nikki, Pat and Delia". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why nothing would move, or null when something will. `scopeLabel` is "this building" or
 * "Silver"; `fromName` is set when the move is limited to one current manager.
 */
export function nothingToMoveMessage(p: {
  total: number;
  inFilter: number;
  movingCount: number;
  toName: string;
  fromName?: string | null;
  scopeLabel: string;
}): string | null {
  if (p.movingCount > 0) return null;
  if (p.total === 0) return p.scopeLabel === "this building" ? "This building has no units yet." : `${p.scopeLabel} has no units yet.`;
  if (p.fromName && p.inFilter === 0) return `${p.fromName} holds no units in ${p.scopeLabel}.`;
  const n = p.fromName ? p.inFilter : p.total;
  return n === 1 ? `${p.toName} already manages this unit.` : `${p.toName} already manages all ${n} of these units.`;
}

/**
 * "Moves 48 units in 6 buildings from Nikki (40) and Pat (8) to Delia; also moves 7 open
 * maintenance requests and 3 open leads." Only what the apply actually moves is mentioned.
 */
export function previewSentence(p: {
  unitCount: number;
  buildingCount: number;
  from: ReadonlyArray<{ name: string; count: number }>;
  toName: string;
  requestsMoving: number;
  leadsMoving?: number;
}): string {
  const where = p.buildingCount === 1 ? "" : ` in ${plural(p.buildingCount, "building")}`;
  const from = p.from.length === 1 ? p.from[0].name : joinNames(p.from.map((f) => `${f.name} (${f.count})`));
  const base = `Moves ${plural(p.unitCount, "unit")}${where} from ${from} to ${p.toName}`;
  const also: string[] = [];
  if (p.requestsMoving > 0) also.push(plural(p.requestsMoving, "open maintenance request"));
  if ((p.leadsMoving ?? 0) > 0) also.push(plural(p.leadsMoving ?? 0, "open lead"));
  if (also.length === 0) return `${base}.`;
  return `${base}; also moves ${also.join(" and ")}.`;
}

// --- Leads (B41 lead routing rows) -------------------------------------------------------

export type PlanLead = {
  leadId: string;
  assignedUserId?: string | null;
  assignedPropertyId?: string | null;
  assignedBy?: "auto_building" | "manual" | null;
};

/**
 * Whether a lead is still "open". The Leads page has no closed / lost / converted / archived state
 * (a lead is a call with a qualifications row; its outcome is how the call went, not a lifecycle),
 * so every assigned lead is open. Kept as ONE function so a future lead status is excluded here and
 * the preview, the apply and the tests all follow.
 */
export function isOpenLead(lead: { assignedUserId?: string | null }): boolean {
  return !!lead.assignedUserId;
}

/**
 * The leads a bulk change moves: open, routed by one of the buildings in scope (`propertyIds`) and
 * currently held by one of the people the units move away from (`holders`, never `to`). Both
 * automatic (auto_building) and manual assignments move: an admin handover takes in-progress work
 * too. Whatever is already with `to` is not listed, so a re-read after a batch only sees what is
 * left.
 */
export function planLeadMove<T extends PlanLead>(
  leads: readonly T[],
  propertyIds: ReadonlySet<string>,
  holders: ReadonlySet<string>,
  to: string,
): T[] {
  return leads.filter(
    (l) =>
      isOpenLead(l) &&
      !!l.assignedPropertyId &&
      propertyIds.has(l.assignedPropertyId) &&
      !!l.assignedUserId &&
      l.assignedUserId !== to &&
      holders.has(l.assignedUserId),
  );
}

/**
 * The fields a bulk move changes on a lead. Deliberately NOT included: assignedBy (an auto-routed
 * lead stays auto, a manual one stays manual) and assignedPropertyId (the building that routed it).
 * leadNotifiedUserId follows the new owner only when the lead was texted before, so a later
 * "new owner by building" text does not go to someone the bulk summary already told.
 */
export function leadMovePatch(
  lead: { leadNotifiedAt?: number | null },
  to: string,
  now: number,
): { assignedUserId: string; assignedAt: number; assignmentReason: string; updatedAt: number; leadNotifiedUserId?: string } {
  return {
    assignedUserId: to,
    assignedAt: now,
    assignmentReason: "moved in a bulk asset manager change",
    updatedAt: now,
    ...(lead.leadNotifiedAt !== undefined && lead.leadNotifiedAt !== null ? { leadNotifiedUserId: to } : {}),
  };
}

/** "3 upcoming tours stay with Nikki; change them in the calendar if needed." or null. */
export function toursStayNote(byManager: ReadonlyArray<{ name: string; count: number }>): string | null {
  const rows = byManager.filter((r) => r.count > 0);
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return null;
  const who = joinNames(rows.map((r) => r.name));
  return `${plural(total, "upcoming tour")} ${total === 1 ? "stays" : "stay"} with ${who}; change ${total === 1 ? "it" : "them"} in the calendar if needed.`;
}

/**
 * Which buildings' DEFAULT asset manager (what new units start with) switches to `to`: with no
 * `from`, every building in scope where everything moves; with `from`, the buildings whose default
 * was `from`. A building already defaulting to `to` is left alone.
 */
export function defaultsToSwitch<P extends { propertyId: string; defaultAssetManagerUserId?: string | null }>(
  properties: readonly P[],
  to: string,
  from?: string | null,
): P[] {
  return properties.filter((p) => {
    const current = p.defaultAssetManagerUserId ?? null;
    if (current === to) return false;
    return from ? current === from : true;
  });
}

/** The per-unit audit note: the admin's reason plus where the change came from. */
export function bulkUnitReason(reason: string, scopeLabel: string): string {
  return `${reason} (bulk change: ${scopeLabel})`;
}

/** The one summary audit note for the whole change. */
export function bulkAuditNote(p: {
  scopeLabel: string;
  unitCount: number;
  buildingCount: number;
  from: ReadonlyArray<{ name: string; count: number }>;
  toName: string;
  requestsMoved: number;
  leadsMoved?: number;
  reason: string;
  partial?: boolean;
}): string {
  const from = joinNames(p.from.map((f) => `${f.name} (${f.count})`)) || "nobody";
  const head = `${p.partial ? "Stopped early: " : ""}${plural(p.unitCount, "unit")} in ${plural(p.buildingCount, "building")} (${p.scopeLabel}) moved from ${from} to ${p.toName}; ${plural(p.requestsMoved, "open request")} moved${(p.leadsMoved ?? 0) > 0 ? ` and ${plural(p.leadsMoved ?? 0, "open lead")} moved` : ""}.`;
  return `${head} Reason: ${p.reason}`.slice(0, 2000);
}
