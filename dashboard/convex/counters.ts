import type { MutationCtx } from "./_generated/server";

/**
 * Next number in a per-org sequence (MR-n, WO-n). Starts at 1001 so numbers read as numbers
 * people can say aloud. Convex serialises conflicting writes to the same row, so two creates
 * racing for the counter retry rather than receiving the same value.
 */
export async function nextNumber(
  ctx: MutationCtx,
  orgId: string,
  name: "maintenanceRequest" | "workOrder",
): Promise<number> {
  const row = await ctx.db
    .query("orgCounters")
    .withIndex("by_org_and_name", (q) => q.eq("orgId", orgId).eq("name", name))
    .unique();
  if (!row) {
    await ctx.db.insert("orgCounters", { orgId, name, value: 1001 });
    return 1001;
  }
  const value = row.value + 1;
  await ctx.db.patch(row._id, { value });
  return value;
}
