/**
 * Pure rules for who gives tours (B40). No database access and no imports, so the probe tests load
 * it directly.
 *
 * Each property team (properties.category: Gold, Silver, Make Up) has a list of the people who give
 * tours of its buildings. With no saved list (no tourStaff row) the list is that team's asset
 * managers: the asset managers of the units in its buildings, most units first. Only current
 * members of the org ever count; a removed member is dropped silently.
 *
 * Once the caller has chosen a building on a team, Sarah books from that team's list only. Without a
 * building (or a building with no team) the pool is today's: lead-assignee asset managers.
 */

export const TOUR_TEAMS = ["gold", "silver", "make_up"] as const;
export type TourTeam = (typeof TOUR_TEAMS)[number];

export const TOUR_TEAM_LABEL: Readonly<Record<TourTeam, string>> = {
  gold: "Gold",
  silver: "Silver",
  make_up: "Make Up",
};

export function isTourTeam(value: unknown): value is TourTeam {
  return value === "gold" || value === "silver" || value === "make_up";
}

/**
 * The default list for a team: the distinct asset managers of its units, the one with the most units
 * first (ties keep the order they were first seen in), members of the org only.
 */
export function defaultTourStaff(unitAssetManagerIds: readonly string[], memberIds: ReadonlySet<string>): string[] {
  const count = new Map<string, number>();
  for (const id of unitAssetManagerIds) {
    if (!memberIds.has(id)) continue;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  // Map keeps insertion order, and Array.prototype.sort is stable, so ties stay first-seen.
  return [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));
}

/**
 * The team's tour list: the saved list when there is one (even an empty one), otherwise the default.
 * Either way only current members, each once, in order.
 */
export function resolveTourStaff(
  saved: readonly string[] | null | undefined,
  defaults: readonly string[],
  memberIds: ReadonlySet<string>,
): { userIds: string[]; isDefault: boolean } {
  const isDefault = saved === null || saved === undefined;
  const source = isDefault ? defaults : saved;
  const seen = new Set<string>();
  const userIds: string[] = [];
  for (const id of source) {
    if (!memberIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    userIds.push(id);
  }
  return { userIds, isDefault };
}

/**
 * Who is considered for a booking, before the per-person checks (bookable below).
 *  - teamStaff null: no building chosen, or a building with no team. Today's pool: members marked as
 *    lead assignees who hold the asset_manager job role.
 *  - teamStaff set: exactly that team's list, in its order. No lead-assignee or job-role requirement:
 *    anyone an admin put on the list counts. Ids that are not members are dropped.
 */
export function poolCandidates<M extends { userId: string; leadAssignee?: boolean; jobRoles?: readonly string[] }>(
  memberships: readonly M[],
  teamStaff: readonly string[] | null,
): M[] {
  if (teamStaff === null) {
    return memberships.filter((m) => m.leadAssignee === true && (m.jobRoles ?? []).includes("asset_manager"));
  }
  const byUser = new Map(memberships.map((m) => [m.userId, m]));
  const out: M[] = [];
  const seen = new Set<string>();
  for (const id of teamStaff) {
    const m = byUser.get(id);
    if (!m || seen.has(id)) continue;
    seen.add(id);
    out.push(m);
  }
  return out;
}

export type CalendarState = "connected" | "needs_reconnect" | "not_connected";

/** The calendar state shown in Settings and used for booking, from a googleCalendarConnections row. */
export function calendarState(connection: { invalidAt?: number } | null | undefined): CalendarState {
  if (!connection) return "not_connected";
  return connection.invalidAt !== undefined ? "needs_reconnect" : "connected";
}

/**
 * Whether one person can be booked at all right now: not out of office, taking tours, and a calendar
 * Google still accepts (we cannot see a calendar we cannot read, so we never book anyone blind). Their
 * tour hours and days off are checked per time slot, later.
 */
export function bookable(
  person: { unavailableUntil?: number; availableForTours?: boolean; calendar: CalendarState },
  now: number,
): boolean {
  if (person.unavailableUntil !== undefined && person.unavailableUntil > now) return false;
  if (person.availableForTours === false) return false;
  return person.calendar === "connected";
}

/** Why there is nobody to book, for the logs (never read to the caller). */
export function noOneBookableReason(team: TourTeam | null): string {
  return team
    ? `No one on the ${TOUR_TEAM_LABEL[team]} tour list has a calendar connected and is taking tours.`
    : "No lead-assignee asset manager has a calendar connected and is taking tours.";
}

/** The warning on a team's card in Settings, or null when someone on the list can be booked. */
export function tourStaffWarning(
  team: TourTeam,
  people: ReadonlyArray<{ calendar: CalendarState; takingTours: boolean; outOfOffice: boolean }>,
): string | null {
  const label = TOUR_TEAM_LABEL[team];
  if (people.length === 0) {
    return `No one gives tours for ${label} buildings; Sarah will take the caller's preferred time.`;
  }
  if (!people.some((p) => p.calendar === "connected" && p.takingTours && !p.outOfOffice)) {
    return `No one on this list can be booked right now (calendar connected, taking tours, not out of office); Sarah will take the caller's preferred time.`;
  }
  return null;
}
