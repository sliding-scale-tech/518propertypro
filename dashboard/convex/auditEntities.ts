import { v } from "convex/values";

/**
 * Dependency-free so schema.ts (which cannot import audit.ts, since audit imports authz and so
 * the generated types built from the schema) and the audit query args share one definition.
 */
export const auditEntityValidator = v.union(
  v.literal("request"),
  v.literal("work_order"),
  v.literal("unit"),
  v.literal("payment"),
  v.literal("ros"),
  v.literal("config"),
  v.literal("membership"),
  v.literal("resident"),
  v.literal("property"),
  v.literal("conversation"),
  v.literal("owner"),
  v.literal("ledger_entry"),
  v.literal("ledger_account"),
);
