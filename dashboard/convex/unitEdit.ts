import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./audit";
import { currentOrg, hasRole, requireOrg } from "./authz";
import { amScope } from "./amScope";
import { activeResidentsOf, applyTenancy, labelOf, orgToday } from "./leases";
import { cleanPhoneList, firstError } from "./leaseLib";
import { businessToday, monthOf } from "./rosFormat";
import {
  applyDetails,
  assertValidAssetManager,
  canViewUnits,
  reassignUnitWithReason,
  unitRolesOf,
  writeAvailability,
  writeRosterFields,
  type RosterFieldsPatch,
  type UnitDetailsPatch,
} from "./units";
import { cleanReason } from "./bulkReassignLib";
import {
  UNIT_EDIT_MSG,
  deniedSection,
  editSections,
  moveOutField,
  unitEditChanges,
  unitEditOrder,
  unitEditPermissions,
  validateUnitEdit,
  type UnitEditRaw,
  type UnitSnapshot,
} from "./unitEditLib";
import { parseBathroomsInput, parseFloorInput } from "./unitFieldsPolicy";
import { changeRent, rentChangesOf } from "./unitRentLib";
import { rentInEffect, upcomingRentChange } from "./unitRentPolicy";

/**
 * B45 "Edit unit": one dialog, one Save, ONE mutation (saveAll). It diffs what was sent against the
 * unit as it is now (unitEditLib.unitEditChanges), checks the viewer may change every touched
 * section (unitEditLib.deniedSection), validates every field (same rules and messages as the
 * dialog), then applies only what changed, in this order, all in this one transaction:
 *   details -> availability & roster -> rent (unitRentLib.changeRent, history kept) ->
 *   tenancy (leases.applyTenancy: move-outs, new renter, roster sync) -> asset manager
 *   (units.reassignUnitWithReason: open requests move, "am_changed" audit with the reason).
 * Every part writes its usual audit / history rows. A server error names the field it is about
 * ({ message, field }) so the dialog marks it. Nothing changed = "No changes to save.".
 *
 * Every argument is optional and nullable so a missing value gets the specific field message,
 * never the validator's generic failure.
 */

const text = v.optional(v.union(v.string(), v.null()));
const bool = v.optional(v.union(v.boolean(), v.null()));

function fieldError(field: string, message: string): ConvexError<{ message: string; field: string }> {
  return new ConvexError({ message, field });
}

function snapshotOf(unit: Doc<"units">): UnitSnapshot {
  return {
    unitNumber: unit.unitNumber,
    bedrooms: unit.bedrooms,
    floor: unit.floor,
    bathrooms: unit.bathrooms,
    isTopFloor: unit.isTopFloor,
    parking: unit.parking,
    availableFrom: unit.availableFrom,
    leasingFacts: unit.leasingFacts,
    available: unit.available,
    occupancy: unit.occupancy,
    leaseType: unit.leaseType,
    rentPaidTo: unit.rentPaidTo,
    assetManagerUserId: unit.assetManagerUserId,
  };
}

async function unitFor(ctx: Parameters<typeof orgToday>[0], orgId: string, raw: string | null | undefined): Promise<Doc<"units"> | null> {
  const id = raw ? ctx.db.normalizeId("units", raw.trim()) : null;
  const unit = id ? await ctx.db.get(id) : null;
  return unit && unit.orgId === orgId ? unit : null;
}

function userName(u: Doc<"users"> | null): string {
  return [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.email || "Unknown";
}

/**
 * What the Edit unit dialog needs: the team's date and the rent window's month, the active
 * residents, the rent now, the asset manager's name and the viewer's permissions for this unit.
 * Anyone who can see the unit gets it (sections they may not change show read-only); null otherwise.
 */
export const context = query({
  args: { unitId: text },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org || !canViewUnits(org)) return null;
    const unit = await unitFor(ctx, org.orgId, args.unitId);
    if (!unit) return null;
    // An asset manager (without a team-wide role) sees only the units they manage or cover.
    if (hasRole(org, "asset_manager") && !hasRole(org, "admin") && !hasRole(org, "accountant")) {
      const scope = await amScope(ctx, org);
      if (!scope.managed.has(unit._id) && !scope.covering.has(unit._id)) return null;
    }
    const perms = unitEditPermissions(unitRolesOf(org, unit));
    const today = await orgToday(ctx, org);
    const rentToday = businessToday(Date.now());
    const month = monthOf(rentToday);
    const changes = await rentChangesOf(ctx, org, unit._id);
    const now = rentInEffect(unit, changes, month);
    const next = upcomingRentChange(changes, month);
    const residents = await activeResidentsOf(ctx, unit);
    return {
      unitId: unit._id,
      label: await labelOf(ctx, unit),
      today,
      rentToday,
      rent: {
        cents: now.cents,
        fromMonth: now.fromMonth,
        hasHistory: now.hasHistory,
        upcoming: next ? { month: next.effectiveMonth, cents: next.rentCents } : null,
      },
      residents: residents.map((r) => ({ _id: r._id, fullName: r.fullName, leaseEnd: r.leaseEnd ?? null })),
      assetManagerName: userName(await ctx.db.get(unit.assetManagerUserId)),
      perms,
    };
  },
});

const detailsV = v.object({
  unitNumber: text,
  bedrooms: text,
  floor: text,
  bathrooms: text,
  isTopFloor: bool,
  parking: text,
  availableFrom: text,
  leasingFacts: text,
});
const rosterV = v.object({ available: bool, occupancy: text, leaseType: text, rentPaidTo: text });
const rentV = v.object({ rent: text, effectiveMonth: text, note: text });
const moveOutV = v.object({ residentId: text, moveOutDate: text });
const newRenterV = v.object({
  fullName: text,
  phones: v.optional(v.union(v.array(v.union(v.string(), v.null())), v.null())),
  email: text,
  leaseStart: text,
  leaseEnd: text,
});
const managerV = v.object({ assetManagerUserId: text, reason: text });

export const saveAll = mutation({
  args: {
    unitId: text,
    details: v.optional(v.union(detailsV, v.null())),
    roster: v.optional(v.union(rosterV, v.null())),
    rent: v.optional(v.union(rentV, v.null())),
    moveOuts: v.optional(v.union(v.array(moveOutV), v.null())),
    newRenter: v.optional(v.union(newRenterV, v.null())),
    manager: v.optional(v.union(managerV, v.null())),
  },
  handler: async (ctx, args): Promise<{ sections: string[]; info: string[] }> => {
    const org = await requireOrg(ctx);
    const unit = await unitFor(ctx, org.orgId, args.unitId);
    if (!unit) throw new ConvexError("Unit not found.");
    const perms = unitEditPermissions(unitRolesOf(org, unit));

    // 1. Only what really changes, against the unit as it is NOW.
    const raw: UnitEditRaw = {
      details: args.details,
      roster: args.roster,
      rent: args.rent,
      moveOuts: args.moveOuts,
      newRenter: args.newRenter,
      manager: args.manager,
    };
    const c = unitEditChanges(snapshotOf(unit), raw);
    const sections = editSections(c);
    if (sections.length === 0) throw new ConvexError(UNIT_EDIT_MSG.nothing);

    // 2. Permissions, per section.
    const denied = deniedSection(perms, c);
    if (denied) throw fieldError(denied.field, denied.message);

    // 3. Every field, before anything is written.
    const today = await orgToday(ctx, org);
    const rentToday = businessToday(Date.now());
    const residents = await activeResidentsOf(ctx, unit);
    const errs = validateUnitEdit(c, { today, rentToday, residents });
    const first = firstError(errs, unitEditOrder(residents.map((r) => r._id)));
    if (first) throw fieldError(first.field, first.message);

    let to: Id<"users"> | null = null;
    if (c.manager) {
      to = ctx.db.normalizeId("users", (c.manager.assetManagerUserId ?? "").trim());
      if (!to) throw fieldError("assetManagerUserId", UNIT_EDIT_MSG.managerMissing);
      try {
        await assertValidAssetManager(ctx, org.orgId, to);
      } catch {
        throw fieldError("assetManagerUserId", "That person is not an asset manager on this team.");
      }
    }

    // 4. Apply, in order. A throw anywhere rolls the whole save back (one mutation).
    let current = unit;
    const reload = async () => {
      current = (await ctx.db.get(unit._id))!;
    };

    if (c.details) {
      const d = c.details;
      const patch: UnitDetailsPatch = {};
      if (d.unitNumber != null) patch.unitNumber = d.unitNumber;
      if (d.bedrooms != null) patch.bedrooms = d.bedrooms;
      if (d.floor != null) {
        const p = parseFloorInput(d.floor);
        if (p.ok) patch.floor = p.value ?? null;
      }
      if (d.bathrooms != null) {
        const p = parseBathroomsInput(d.bathrooms);
        if (p.ok) patch.bathrooms = p.value ?? null;
      }
      if (typeof d.isTopFloor === "boolean") patch.isTopFloor = d.isTopFloor;
      if (d.parking != null) patch.parking = d.parking.trim() || null;
      if (d.availableFrom != null) patch.availableFrom = d.availableFrom.trim() || null;
      if (d.leasingFacts != null) patch.leasingFacts = d.leasingFacts.trim() || null;
      await applyDetails(ctx, org, current, patch);
      await reload();
    }

    const r = c.roster ?? {};
    if (typeof r.available === "boolean") {
      await writeAvailability(ctx, org, current, r.available, current.availableFrom, "Edit unit");
      await reload();
    }
    const roster: RosterFieldsPatch = {};
    if (r.occupancy !== undefined) roster.occupancy = (r.occupancy ?? null) as RosterFieldsPatch["occupancy"];
    if (r.leaseType !== undefined) roster.leaseType = (r.leaseType ?? null) as RosterFieldsPatch["leaseType"];
    if (r.rentPaidTo !== undefined) roster.rentPaidTo = (r.rentPaidTo ?? null) as RosterFieldsPatch["rentPaidTo"];
    if (Object.keys(roster).length > 0) {
      await writeRosterFields(ctx, org, current, roster, "Edit unit");
      await reload();
    }

    let info: string[] = [];
    if (c.rent) {
      const out = await changeRent(
        ctx,
        org,
        { unitId: unit._id, rent: c.rent.rent, effectiveMonth: c.rent.effectiveMonth, note: c.rent.note },
        rentToday,
        { audit: (event) => writeAudit(ctx, event) },
      );
      info = out.info;
      await reload();
    }

    if (sections.includes("tenancy")) {
      const byId = new Map(residents.map((x) => [x._id as string, x]));
      const moveOuts = (c.moveOuts ?? []).map((m) => {
        const resident = byId.get((m.residentId ?? "").trim());
        if (!resident) throw fieldError(moveOutField(m.residentId ?? ""), UNIT_EDIT_MSG.residentGone);
        return { resident, date: (m.moveOutDate ?? "").trim() };
      });
      const nr = c.newRenter;
      const label = await labelOf(ctx, current);
      await applyTenancy(ctx, org, current, {
        moveOuts,
        newRenter: nr
          ? {
              fullName: (nr.fullName ?? "").trim(),
              phones: cleanPhoneList(nr.phones ?? []).phones,
              email: (nr.email ?? "").trim().toLowerCase() || undefined,
              leaseStart: (nr.leaseStart ?? "").trim() || undefined,
              leaseEnd: (nr.leaseEnd ?? "").trim() || undefined,
            }
          : undefined,
        why: nr ? `New renter ${(nr.fullName ?? "").trim()} for ${label}` : `Move out from ${label}`,
        // What the user set by hand in this save wins over the tenancy sync.
        manual: {
          available: typeof r.available === "boolean",
          occupancy: r.occupancy !== undefined,
          leaseType: r.leaseType !== undefined,
        },
      });
      await reload();
    }

    if (c.manager && to) {
      await reassignUnitWithReason(ctx, org, unit._id, to, cleanReason(c.manager.reason));
    }
    return { sections, info };
  },
});
