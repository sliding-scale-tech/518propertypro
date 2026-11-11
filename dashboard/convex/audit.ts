import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { currentOrg, isAdminView, requireAdminView } from "./authz";
import { auditEntityValidator } from "./auditEntities";

/**
 * Append-only audit trail.
 *
 * Deliberately exports no update or delete: history that can be edited is not history. Callers
 * write through writeAudit from inside the same mutation as the change, so the two commit or
 * roll back together and a change can never exist without its trail.
 */

export type AuditEntity =
  | "request"
  | "work_order"
  | "unit"
  | "payment"
  | "ros"
  | "config"
  | "membership"
  | "resident"
  | "property"
  | "conversation";

export async function writeAudit(
  ctx: MutationCtx,
  event: {
    orgId: string;
    entity: AuditEntity;
    entityId: string;
    action: string;
    actorUserId?: Id<"users">;
    from?: string;
    to?: string;
    note?: string;
  },
): Promise<void> {
  // The name is snapshotted at write time: renaming or deleting the person later must not
  // rewrite who did what.
  let actorLabel = "System";
  if (event.actorUserId) {
    const actor = await ctx.db.get(event.actorUserId);
    const name = [actor?.firstName, actor?.lastName].filter(Boolean).join(" ").trim();
    actorLabel = name || actor?.email || "Unknown";
  }
  await ctx.db.insert("auditEvents", {
    orgId: event.orgId,
    entity: event.entity,
    entityId: event.entityId,
    action: event.action,
    actorUserId: event.actorUserId,
    actorLabel,
    from: event.from,
    to: event.to,
    note: event.note,
    at: Date.now(),
  });
}

/** History of one record, newest first. Any Admin (Pat's "own records" view comes with F5). */
export const forEntity = query({
  args: {
    entity: auditEntityValidator,
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org || !isAdminView(org)) throw new ConvexError("You don't have access to that.");

    const rows = await ctx.db
      .query("auditEvents")
      .withIndex("by_entity", (q) => q.eq("entity", args.entity).eq("entityId", args.entityId))
      .order("desc")
      .take(200);
    // entityId is client-supplied, so scope to this team's rows: another team's record id must
    // read as empty, not leak its history.
    return rows.filter((r) => r.orgId === org.orgId);
  },
});

/**
 * The audit log page: the team's events newest first, optionally narrowed. Admin view only.
 *
 * Paged with an opaque cursor (null for the first page). Filters run after the indexed
 * date-range read, so a heavily filtered page can come back short; keep paging until isDone.
 */
export const list = query({
  args: {
    entity: v.optional(auditEntityValidator),
    actorUserId: v.optional(v.id("users")),
    action: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    // orgId comes from the session, never from args, so another team's events are unreachable.
    const result = await ctx.db
      .query("auditEvents")
      .withIndex("by_org_and_at", (q) => {
        const base = q.eq("orgId", org.orgId);
        if (args.from !== undefined && args.to !== undefined) return base.gte("at", args.from).lte("at", args.to);
        if (args.from !== undefined) return base.gte("at", args.from);
        if (args.to !== undefined) return base.lte("at", args.to);
        return base;
      })
      .order("desc")
      .filter((q) => {
        const conditions = [];
        if (args.entity) conditions.push(q.eq(q.field("entity"), args.entity));
        if (args.actorUserId) conditions.push(q.eq(q.field("actorUserId"), args.actorUserId));
        if (args.action) conditions.push(q.eq(q.field("action"), args.action));
        return conditions.length ? q.and(...conditions) : q.eq(true, true);
      })
      .paginate({ numItems: 50, cursor: args.cursor });
    return result;
  },
});

/**
 * Org-purge only (called from team.deleteOrgRows when a whole team is torn down). This is the
 * ONE place audit rows are deleted, and it is not a registered function, so nothing a client
 * or the scheduler can reach removes history; the "no delete" rule above still holds for the app.
 */
export async function purgeOrgAudit(ctx: MutationCtx, orgId: string): Promise<number> {
  const rows = await ctx.db
    .query("auditEvents")
    .withIndex("by_org_and_at", (q) => q.eq("orgId", orgId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}
