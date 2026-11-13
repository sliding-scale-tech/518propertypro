/**
 * Pure rules for who owns a leasing lead (B41). No database access and no imports, so the probe tests
 * load it directly. leads.ts applies them.
 *
 *  - Every renting caller is a lead, saved at Sarah's first log_lead, and starts UNASSIGNED. It sits on
 *    the admin Leads page as "Unassigned" until a building is picked or an admin assigns it.
 *  - Once the caller picks a building (a listing from Sarah's own results, passed to request_tour,
 *    reschedule_tour, find_tour_times or log_lead as spoken_building), the lead goes to THAT building's
 *    asset manager: the units' assetManagerUserId, the one with the most units there when they are
 *    split (ties: the first seen), current team members only.
 *  - A manual assignment (an admin, on the Leads page) is never changed by Sarah. Sarah re-routes only
 *    a lead that is unassigned or was assigned by building (the caller switched buildings).
 *  - A lead assigned before B41 has an assignee but no assignedBy. It is treated as manual: nothing
 *    that was already assigned moves.
 */

export type LeadAssignedBy = "auto_building" | "manual";

/**
 * The asset manager of a building, from its units' assetManagerUserId values: the one with the most
 * units there, ties going to whoever appears first; ids that are not current members are skipped.
 * null when no unit has a current member as its asset manager.
 */
export function buildingAssetManager(
  unitAssetManagerIds: readonly string[],
  memberIds: ReadonlySet<string>,
): string | null {
  const count = new Map<string, number>();
  for (const id of unitAssetManagerIds) {
    if (!memberIds.has(id)) continue;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  // Map keeps insertion order, so a strict ">" leaves a tie with the first one seen.
  for (const [id, n] of count) {
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

/** How a lead is assigned right now. A legacy assignment (assignee, no assignedBy) counts as manual. */
export function effectiveAssignedBy(lead: {
  assignedUserId?: string | null;
  assignedBy?: LeadAssignedBy | null;
}): LeadAssignedBy | null {
  if (!lead.assignedUserId) return null;
  return lead.assignedBy ?? "manual";
}

export type BuildingRouteDecision =
  | {
      action: "assign";
      userId: string;
      propertyId: string;
      // true when the owner changes (the new asset manager is told); false when only the building
      // the assignment came from is updated (same asset manager, another of their buildings).
      ownerChanged: boolean;
    }
  | { action: "keep"; why: "manual" | "no_asset_manager" | "unchanged" };

/**
 * What to do with a lead when the caller picks a building whose asset manager is `buildingAmId`.
 *  - manual (or legacy) assignment: keep, always.
 *  - no asset manager for the building: keep whatever the lead has (unassigned stays unassigned).
 *  - unassigned, or assigned by building: assign to the building's asset manager.
 */
export function decideBuildingRoute(
  lead: { assignedUserId?: string | null; assignedBy?: LeadAssignedBy | null; assignedPropertyId?: string | null },
  building: { propertyId: string; assetManagerUserId: string | null },
): BuildingRouteDecision {
  const by = effectiveAssignedBy(lead);
  if (by === "manual") return { action: "keep", why: "manual" };
  if (!building.assetManagerUserId) return { action: "keep", why: "no_asset_manager" };
  const sameOwner = lead.assignedUserId === building.assetManagerUserId;
  if (sameOwner && lead.assignedPropertyId === building.propertyId) return { action: "keep", why: "unchanged" };
  return {
    action: "assign",
    userId: building.assetManagerUserId,
    propertyId: building.propertyId,
    ownerChanged: !sameOwner,
  };
}

/**
 * Who gets the "new lead" text, if anyone, once the lead has a name or number.
 *  - first text for this lead: the assignee (if any) and the admins. An unassigned lead texts only the
 *    admins, who are the ones to assign it; nobody else.
 *  - already texted: only a NEW assignee by building (the caller picked or switched buildings), alone.
 *    A manual assignment never texts (the admin made it), nor does an assignee already told.
 */
export function leadTextRecipients(lead: {
  hasContact: boolean;
  notified: boolean;
  notifiedUserId?: string | null;
  assignedUserId?: string | null;
  assignedBy?: LeadAssignedBy | null;
}): { kind: "first"; includeStaff: true; assignee: string | null } | { kind: "new_owner"; assignee: string } | null {
  if (!lead.hasContact) return null;
  const assignee = lead.assignedUserId ?? null;
  if (!lead.notified) return { kind: "first", includeStaff: true, assignee };
  if (assignee && lead.assignedBy === "auto_building" && lead.notifiedUserId !== assignee) {
    return { kind: "new_owner", assignee };
  }
  return null;
}
