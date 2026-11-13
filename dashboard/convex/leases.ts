import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAudit } from "./audit";
import { currentOrg, hasRole, isAdminView, requireOrg } from "./authz";
import type { OrgContext } from "./authz";
import { amScope } from "./amScope";
import { closeLeaseFollowUps, openLeaseFollowUps } from "./leaseFollowUp";
import {
  NEW_RENTER_ORDER,
  cleanPhoneList,
  firstError,
  leaseTag,
  shortDate,
  teamToday,
  unitWord,
  validateMoveOut,
  validateNewRenter,
  validateRenewal,
} from "./leaseLib";
import type { FieldErrors } from "./leaseLib";
import { syncPhones } from "./residents";
import { unitRolesOf, writeAvailability, writeRosterFields, writeUnitLeaseEnd } from "./units";
import { UNIT_EDIT_MSG, availabilitySync, rosterSync, unitEditPermissions } from "./unitEditLib";
import { changeRent, rentChangesOf } from "./unitRentLib";
import { rentChangeMonthProblem, rentInEffect } from "./unitRentPolicy";
import { parseDollarsToCents } from "./rosFormat";

/**
 * B44 leases: New renter, Move out, and the lease-ended follow-up's resolutions (Renewed,
 * Month-to-month; Moving out = Move out). Each is ONE mutation, so everything it writes commits or
 * rolls back together, and each write is audited (who, when).
 *
 * Permissions (B45):
 *   - New renter, Move out, Renewed and Month-to-month: the admin view, or the asset manager of
 *     that unit (its designated AM; covering is read-only), mirroring setAvailability. The
 *     follow-up task goes to that asset manager, so they can answer it.
 *   - A rent given with New renter is a rent change: admin view + accountant only (unitRent).
 * New renter and Move out share ONE tenancy core, applyTenancy, with B45's unitEdit.saveAll, so
 * the move-outs, the new resident, availability, the unit's lease end, the roster sync and the
 * lease follow-up closing are the same on every path.
 * Nothing here moves anyone out automatically. No text message is sent.
 *
 * Arguments are nullable strings so a missing value gets the specific field message, never the
 * validator's generic failure.
 */

const text = v.optional(v.union(v.string(), v.null()));

function fieldError(field: string, message: string): ConvexError<{ message: string; field: string }> {
  return new ConvexError({ message, field });
}

function throwFirst(errs: FieldErrors, order: readonly string[]): void {
  const first = firstError(errs, order);
  if (first) throw fieldError(first.field, first.message);
}

export async function orgToday(ctx: QueryCtx | MutationCtx, org: OrgContext): Promise<string> {
  return teamToday(Date.now(), (await ctx.db.get(org.orgId))?.timeZone);
}

async function unitOf(ctx: QueryCtx | MutationCtx, org: OrgContext, raw: string | null | undefined): Promise<Doc<"units">> {
  const id = raw ? ctx.db.normalizeId("units", raw.trim()) : null;
  const unit = id ? await ctx.db.get(id) : null;
  if (!unit || unit.orgId !== org.orgId) throw fieldError("unitId", raw ? "Unit not found." : "Select the unit.");
  return unit;
}

async function residentOf(ctx: QueryCtx | MutationCtx, org: OrgContext, raw: string | null | undefined): Promise<Doc<"residents">> {
  const id = raw ? ctx.db.normalizeId("residents", raw.trim()) : null;
  const resident = id ? await ctx.db.get(id) : null;
  if (!resident || resident.orgId !== org.orgId) throw new ConvexError("Resident not found.");
  return resident;
}

export async function activeResidentsOf(ctx: QueryCtx | MutationCtx, unit: Doc<"units">): Promise<Doc<"residents">[]> {
  return (
    await ctx.db
      .query("residents")
      .withIndex("by_unit", (q) => q.eq("unitId", unit._id))
      .collect()
  ).filter((r) => r.active && r.orgId === unit.orgId);
}

export async function labelOf(ctx: QueryCtx | MutationCtx, unit: Doc<"units">): Promise<string> {
  const property = await ctx.db.get(unit.propertyId);
  return `${unitWord(unit.unitNumber)} at ${property?.name ?? "the property"}`;
}

/** Admin view, or the asset manager who manages this unit (covering is read-only). */
async function canResolveLease(ctx: QueryCtx | MutationCtx, org: OrgContext, unitId: Id<"units">): Promise<boolean> {
  if (isAdminView(org)) return true;
  if (!hasRole(org, "asset_manager")) return false;
  return (await amScope(ctx, org)).managed.has(unitId);
}

/** The New renter / Move out permissions for one unit (unitEditLib's matrix). */
function tenancyPerms(org: OrgContext, unit: Doc<"units">) {
  return unitEditPermissions(unitRolesOf(org, unit));
}

/** Deactivates one resident as moved out on `date` (phones leave caller-ID lookup). */
export async function recordMoveOut(ctx: MutationCtx, org: OrgContext, resident: Doc<"residents">, date: string, why: string) {
  await ctx.db.patch(resident._id, { active: false, movedOutOn: date, updatedAt: Date.now() });
  await syncPhones(ctx, { ...resident, active: false }, []);
  await closeLeaseFollowUps(ctx, resident, `Moving out (${why})`, org.user._id);
  await writeAudit(ctx, {
    orgId: org.orgId,
    entity: "resident",
    entityId: resident._id,
    action: "resident_moved_out",
    actorUserId: org.user._id,
    to: date,
    note: why,
  });
}

export type NewRenterFields = {
  fullName: string;
  phones: string[];
  email?: string;
  leaseStart?: string;
  leaseEnd?: string;
};

/**
 * THE tenancy core (leases.newRenter, leases.moveOut and unitEdit.saveAll), all inside the
 * caller's one mutation. The caller has checked permissions and validated every value.
 *   1. Each move-out: the resident becomes inactive on its date, their phones leave caller-ID
 *      lookup, their open lease follow-ups close, audited (recordMoveOut).
 *   2. A new renter: the resident is created (audited); the unit stops being offered; its lease end
 *      follows the new lease. Without one: when nobody is left, the unit's lease end is cleared, and
 *      `makeAvailable` offers the unit again.
 *   3. Roster sync (unitEditLib.rosterSync): new renter -> occupancy "occupied", lease type "fixed"
 *      (or "month_to_month" with no lease end); nobody left -> "vacant" / "vacant".
 * `manual` names the fields the user set by hand in the same save (unitEdit.saveAll): those win,
 * so availability / occupancy / lease type set in the dialog are never overwritten here.
 */
export async function applyTenancy(
  ctx: MutationCtx,
  org: OrgContext,
  unit: Doc<"units">,
  a: {
    moveOuts: Array<{ resident: Doc<"residents">; date: string }>;
    newRenter?: NewRenterFields;
    why: string;
    makeAvailable?: boolean;
    manual?: { available?: boolean; occupancy?: boolean; leaseType?: boolean };
  },
): Promise<{ residentId: Id<"residents"> | null; movedOut: number; madeAvailable: boolean }> {
  const label = await labelOf(ctx, unit);
  for (const m of a.moveOuts) await recordMoveOut(ctx, org, m.resident, m.date, a.why);

  let residentId: Id<"residents"> | null = null;
  const nr = a.newRenter;
  if (nr) {
    residentId = await ctx.db.insert("residents", {
      orgId: org.orgId,
      unitId: unit._id,
      fullName: nr.fullName,
      phones: nr.phones,
      email: nr.email,
      leaseStart: nr.leaseStart,
      leaseEnd: nr.leaseEnd,
      active: true,
      source: "manual",
      updatedAt: Date.now(),
    });
    await syncPhones(ctx, (await ctx.db.get(residentId))!, nr.phones);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "resident",
      entityId: residentId,
      action: "resident_created",
      actorUserId: org.user._id,
      to: unit.unitNumber,
      note: `New renter for ${label}${nr.leaseStart ? `, lease from ${nr.leaseStart}` : ""}${nr.leaseEnd ? ` to ${nr.leaseEnd}` : ""}`,
    });
  }

  let fresh = (await ctx.db.get(unit._id))!;
  const left = nr ? 1 : (await activeResidentsOf(ctx, fresh)).length;
  const avail = availabilitySync({
    newRenter: Boolean(nr),
    makeAvailable: a.makeAvailable === true,
    current: fresh.available,
    manual: a.manual?.available === true,
  });
  let madeAvailable = false;
  if (avail !== null) {
    const who = nr ? `New renter ${nr.fullName}` : a.why;
    await writeAvailability(ctx, org, fresh, avail, undefined, who);
    madeAvailable = avail;
    fresh = (await ctx.db.get(unit._id))!;
  }
  if (nr) {
    await writeUnitLeaseEnd(ctx, org, fresh, nr.leaseEnd, `New renter ${nr.fullName}`);
  } else if (a.moveOuts.length > 0 && left === 0) {
    await writeUnitLeaseEnd(ctx, org, fresh, undefined, a.why);
  }
  fresh = (await ctx.db.get(unit._id))!;

  const roster = rosterSync({
    newRenter: nr ? { leaseEnd: nr.leaseEnd } : null,
    movedOut: a.moveOuts.length,
    leftAfter: left,
    current: fresh,
    manual: a.manual,
  });
  if (Object.keys(roster).length > 0) {
    await writeRosterFields(ctx, org, fresh, roster, nr ? `New renter ${nr.fullName}` : `Nobody left in ${label}`);
  }
  return { residentId, movedOut: a.moveOuts.length, madeAvailable };
}

// --- Reads ----------------------------------------------------------------------------------------

/**
 * What the New renter / Move out dialogs need about a unit: its label, the active residents, the
 * team's date, the rent now and what the viewer may do. The admin view or the unit's own asset
 * manager (the same people who can save these forms); null for anyone else.
 */
export const unitContext = query({
  args: { unitId: text },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return null;
    const id = args.unitId ? ctx.db.normalizeId("units", args.unitId) : null;
    const unit = id ? await ctx.db.get(id) : null;
    if (!unit || unit.orgId !== org.orgId) return null;
    const perms = tenancyPerms(org, unit);
    if (!perms.moveOut && !perms.newRenter) return null;
    const today = await orgToday(ctx, org);
    const current = await activeResidentsOf(ctx, unit);
    const rentNow = rentInEffect(unit, await rentChangesOf(ctx, org, unit._id), today.slice(0, 7));
    return {
      unitId: unit._id,
      label: await labelOf(ctx, unit),
      available: unit.available,
      today,
      rentNowCents: rentNow.cents,
      current: current.map((r) => ({ _id: r._id, fullName: r.fullName, leaseEnd: r.leaseEnd ?? null })),
      canNewRenter: perms.newRenter,
      canMoveOut: perms.moveOut,
      // A rent typed with New renter is a rent change: admin view + accountant.
      canChangeRent: perms.rent,
    };
  },
});

/** The team's date ("YYYY-MM-DD"), for forms that default to today. */
export const today = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    return org ? await orgToday(ctx, org) : null;
  },
});

/**
 * Dashboard card "Leases ending soon": active residents of the viewer's units whose lease has
 * ended or ends within 60 days (not month-to-month). An asset manager gets the units they manage;
 * the admin view the whole team; anyone else null.
 */
export const attention = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return null;
    const admin = isAdminView(org);
    let residents: Doc<"residents">[];
    let managed = new Set<Id<"units">>();
    if (admin) {
      residents = await ctx.db
        .query("residents")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect();
    } else if (hasRole(org, "asset_manager")) {
      managed = (await amScope(ctx, org)).managed;
      residents = [];
      for (const unitId of managed) {
        residents.push(
          ...(await ctx.db
            .query("residents")
            .withIndex("by_unit", (q) => q.eq("unitId", unitId))
            .collect()),
        );
      }
    } else {
      return null;
    }
    const today = await orgToday(ctx, org);
    const hits = residents
      .filter((r) => r.active && r.orgId === org.orgId)
      .map((r) => ({ r, tag: leaseTag(r, today) }))
      .filter((x): x is { r: Doc<"residents">; tag: "ended" | "ending_soon" } => x.tag === "ended" || x.tag === "ending_soon")
      .sort((a, b) => ((a.r.leaseEnd ?? "") < (b.r.leaseEnd ?? "") ? -1 : (a.r.leaseEnd ?? "") > (b.r.leaseEnd ?? "") ? 1 : 0));
    const ended = hits.filter((h) => h.tag === "ended").length;
    const rows = [];
    for (const { r, tag } of hits.slice(0, 8)) {
      const unit = await ctx.db.get(r.unitId);
      if (!unit) continue;
      const open = await openLeaseFollowUps(ctx, r._id);
      rows.push({
        _id: r._id,
        unitId: r.unitId,
        fullName: r.fullName,
        unitLabel: await labelOf(ctx, unit),
        leaseEnd: r.leaseEnd as string,
        leaseEndLabel: shortDate(r.leaseEnd as string, today),
        tag,
        openFollowUpTaskId: open[0]?._id ?? null,
        canResolveLease: admin || managed.has(r.unitId),
        // B45: the unit's asset manager may record the move-out too.
        canMoveOut: admin || managed.has(r.unitId),
      });
    }
    return { today, ended, endingSoon: hits.length - ended, total: hits.length, rows, canMoveOut: admin };
  },
});

// --- Writes ---------------------------------------------------------------------------------------

/**
 * New renter for a unit, all or nothing: the unit's current residents move out on `moveOutDate`,
 * the new resident is created, the unit stops being offered (available = false), its lease end
 * follows the new lease, its roster says occupied (applyTenancy), and when a rent is given it
 * becomes the unit's rent from the lease start month (the existing rent history,
 * unitRentLib.changeRent). The admin view or the unit's own asset manager; a rent only for the
 * admin view + accountant.
 */
export const newRenter = mutation({
  args: {
    unitId: text,
    moveOutDate: text,
    fullName: text,
    phones: v.optional(v.union(v.array(v.string()), v.null())),
    email: text,
    leaseStart: text,
    leaseEnd: text,
    rent: text,
  },
  handler: async (ctx, args): Promise<{ residentId: Id<"residents">; movedOut: number }> => {
    const org = await requireOrg(ctx);
    const unit = await unitOf(ctx, org, args.unitId);
    const perms = tenancyPerms(org, unit);
    if (!perms.newRenter) throw new ConvexError(UNIT_EDIT_MSG.newRenterNotYours);
    const today = await orgToday(ctx, org);
    const current = await activeResidentsOf(ctx, unit);

    throwFirst(validateNewRenter({ ...args, hasCurrent: current.length > 0, today }), NEW_RENTER_ORDER);
    const fullName = (args.fullName ?? "").trim();
    const phones = cleanPhoneList(args.phones ?? []).phones;
    const email = (args.email ?? "").trim().toLowerCase() || undefined;
    const leaseStart = (args.leaseStart ?? "").trim() || undefined;
    const leaseEnd = (args.leaseEnd ?? "").trim() || undefined;
    const rent = (args.rent ?? "").trim();
    const moveOutDate = (args.moveOutDate ?? "").trim();
    if (rent && !perms.rent) throw fieldError("rent", "Only an admin can change the rent. Leave the rent blank, or ask an admin.");

    // The rent's month is checked before anything is written (changeRent's window: 24 months back, 12 ahead).
    const rentMonth = (leaseStart ?? today).slice(0, 7);
    if (rent) {
      const monthProblem = rentChangeMonthProblem(rentMonth, today);
      if (monthProblem) throw fieldError(leaseStart ? "leaseStart" : "rent", monthProblem);
    }

    const label = await labelOf(ctx, unit);
    const out = await applyTenancy(ctx, org, unit, {
      moveOuts: current.map((resident) => ({ resident, date: moveOutDate })),
      newRenter: { fullName, phones, email, leaseStart, leaseEnd },
      why: `New renter ${fullName} for ${label}`,
    });

    if (rent) {
      const fresh = (await ctx.db.get(unit._id))!;
      const before = rentInEffect(fresh, await rentChangesOf(ctx, org, unit._id), rentMonth);
      // The same rent as already set is not an error here: nothing to change.
      if (before.cents !== parseDollarsToCents(rent)) {
        await changeRent(ctx, org, { unitId: unit._id, rent, effectiveMonth: rentMonth, note: `New renter: ${fullName}` }, today, {
          audit: (event) => writeAudit(ctx, event),
        });
      }
    }
    return { residentId: out.residentId!, movedOut: out.movedOut };
  },
});

/**
 * Move out one resident on `moveOutDate`; when `makeAvailable`, the unit is offered again
 * (available = true). When nobody is left, the unit's lease end is cleared and its roster says
 * vacant (applyTenancy). The admin view or the unit's own asset manager.
 */
export const moveOut = mutation({
  args: { residentId: text, moveOutDate: text, makeAvailable: v.optional(v.union(v.boolean(), v.null())) },
  handler: async (ctx, args): Promise<{ madeAvailable: boolean }> => {
    const org = await requireOrg(ctx);
    const resident = await residentOf(ctx, org, args.residentId);
    const unit = await ctx.db.get(resident.unitId);
    if (!unit || unit.orgId !== org.orgId) throw new ConvexError("Unit not found.");
    if (!tenancyPerms(org, unit).moveOut) throw new ConvexError(UNIT_EDIT_MSG.moveOutNotYours);
    if (!resident.active) throw new ConvexError(`${resident.fullName} has already moved out.`);
    const today = await orgToday(ctx, org);
    throwFirst(validateMoveOut({ moveOutDate: args.moveOutDate, today }), ["moveOutDate"]);

    const label = await labelOf(ctx, unit);
    await applyTenancy(ctx, org, unit, {
      moveOuts: [{ resident, date: (args.moveOutDate ?? "").trim() }],
      why: `Move out from ${label}`,
      makeAvailable: args.makeAvailable === true,
    });
    return { madeAvailable: args.makeAvailable === true };
  },
});

/** Renewed: the resident's new lease end (after today and after the old one). Closes the follow-up. */
export const renew = mutation({
  args: { residentId: text, leaseEnd: text },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const resident = await residentOf(ctx, org, args.residentId);
    if (!(await canResolveLease(ctx, org, resident.unitId))) throw new ConvexError("Resident not found.");
    if (!resident.active) throw new ConvexError(`${resident.fullName} has moved out; their lease can't be renewed.`);
    const today = await orgToday(ctx, org);
    throwFirst(validateRenewal({ leaseEnd: args.leaseEnd, oldLeaseEnd: resident.leaseEnd, today }), ["leaseEnd"]);
    const leaseEnd = (args.leaseEnd ?? "").trim();

    await ctx.db.patch(resident._id, { leaseEnd, leaseStatus: undefined, updatedAt: Date.now() });
    await closeLeaseFollowUps(ctx, resident, "Renewed", org.user._id);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "resident",
      entityId: resident._id,
      action: "lease_renewed",
      actorUserId: org.user._id,
      from: resident.leaseEnd,
      to: leaseEnd,
    });
    const unit = await ctx.db.get(resident.unitId);
    if (unit && unit.orgId === org.orgId) await writeUnitLeaseEnd(ctx, org, unit, leaseEnd, `${resident.fullName} renewed`);
  },
});

/** Month-to-month: no more lease-ended reminders for this resident; the tag says Month-to-month. */
export const markMonthToMonth = mutation({
  args: { residentId: text },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const resident = await residentOf(ctx, org, args.residentId);
    if (!(await canResolveLease(ctx, org, resident.unitId))) throw new ConvexError("Resident not found.");
    if (!resident.active) throw new ConvexError(`${resident.fullName} has moved out.`);
    if (resident.leaseStatus !== "month_to_month") {
      await ctx.db.patch(resident._id, { leaseStatus: "month_to_month", updatedAt: Date.now() });
      await writeAudit(ctx, {
        orgId: org.orgId,
        entity: "resident",
        entityId: resident._id,
        action: "lease_month_to_month",
        actorUserId: org.user._id,
        from: resident.leaseEnd,
      });
    }
    await closeLeaseFollowUps(ctx, resident, "Month-to-month", org.user._id);
  },
});
