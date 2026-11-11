import { ConvexError, v } from "convex/values";

/**
 * Job roles live in their own dependency-free module so schema.ts (which cannot import authz,
 * since authz imports generated types built from the schema) and the mutation args in team.ts
 * share one definition. authz.ts re-exports these; import them from there in app code.
 */
export const JOB_ROLES = [
  "executive",
  "maintenance_lead",
  "asset_manager",
  "technician",
  "accountant",
  "simplr_admin",
] as const;

export type JobRole = (typeof JOB_ROLES)[number];

export const jobRoleValidator = v.union(
  v.literal("executive"),
  v.literal("maintenance_lead"),
  v.literal("asset_manager"),
  v.literal("technician"),
  v.literal("accountant"),
  v.literal("simplr_admin"),
);

/**
 * The four user types the UI shows. Each maps onto a membership role plus job roles, which the
 * backend keeps using; the mapping lives here (pure, no server imports) so the UI can share it.
 */
export type AppRole = "admin" | "asset_manager" | "technician" | "accountant";

export const APP_ROLES: ReadonlyArray<AppRole> = ["admin", "asset_manager", "technician", "accountant"];

export const appRoleValidator = v.union(
  v.literal("admin"),
  v.literal("asset_manager"),
  v.literal("technician"),
  v.literal("accountant"),
);

/**
 * Server-side check for an app role sent by a client. Mutations take the role as a plain string
 * and run it through this, so a missing or unknown value gets a clear ConvexError instead of the
 * generic failure Convex's argument validator would produce.
 */
export function parseAppRole(value: string | null | undefined): AppRole {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new ConvexError("Pick a role for this person.");
  if (!(APP_ROLES as ReadonlyArray<string>).includes(trimmed)) {
    throw new ConvexError("Pick a valid role: Admin, Asset manager, Technician or Accountant.");
  }
  return trimmed as AppRole;
}

const ADMIN_JOB_ROLES: ReadonlyArray<string> = ["executive", "maintenance_lead", "simplr_admin"];

/** Reverse mapping, for display and filtering. null means no role has been assigned yet. */
export function appRoleOf(role: string, jobRoles: ReadonlyArray<string>): AppRole | null {
  if (role === "admin" || jobRoles.some((r) => ADMIN_JOB_ROLES.includes(r))) return "admin";
  if (jobRoles.includes("asset_manager")) return "asset_manager";
  if (jobRoles.includes("technician")) return "technician";
  if (jobRoles.includes("accountant")) return "accountant";
  return null;
}

/** Forward mapping: the membership role and job roles an app role is stored as. */
export function jobRolesFor(appRole: AppRole): { role: "admin" | "member"; jobRoles: JobRole[] } {
  switch (appRole) {
    case "admin":
      return { role: "admin", jobRoles: ["executive", "maintenance_lead"] };
    case "asset_manager":
      return { role: "member", jobRoles: ["asset_manager"] };
    case "technician":
      return { role: "member", jobRoles: ["technician"] };
    case "accountant":
      return { role: "member", jobRoles: ["accountant"] };
  }
}

export const notifyChannelValidator = v.union(
  v.literal("sms"),
  v.literal("email"),
  v.literal("push"),
);
