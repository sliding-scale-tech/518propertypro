/**
 * Multi-role members (B31): the role SET a person holds, and the rules for picking roles.
 *
 * Pure: no Convex imports, erasable TypeScript only, so the server (authz, team), the client
 * (sidebar, route guards, team forms) and the node tests all share one definition.
 *
 * Roles: Admin, Asset manager, Technician, Accountant. Admin is exclusive (it already sees
 * everything, finance included). The other three combine in any mix, and a person's permissions
 * are the UNION of the roles they hold, nothing beyond it.
 *
 * Stored as before: memberships.role ("admin" | "member") plus memberships.jobRoles. The team
 * admin flag, or any of the admin-flavoured job roles (executive, maintenance_lead,
 * simplr_admin), makes a person an Admin; otherwise each of asset_manager, technician and
 * accountant in jobRoles is one role held.
 */

export type AppRole = "admin" | "asset_manager" | "technician" | "accountant";

/** Display / priority order. Also the order roles are stored in. */
export const APP_ROLES: ReadonlyArray<AppRole> = ["admin", "asset_manager", "technician", "accountant"];

/** The roles that can be held together (everything except Admin). */
export const COMBINABLE_ROLES: ReadonlyArray<Exclude<AppRole, "admin">> = ["asset_manager", "technician", "accountant"];

export const ADMIN_JOB_ROLES: ReadonlyArray<string> = ["executive", "maintenance_lead", "simplr_admin"];

/**
 * The set of roles a person holds. An Admin holds exactly {"admin"}: the admin flag wins over any
 * other job role, as it always has (an Admin was never treated as an asset manager, technician or
 * accountant by the old single-view rule). Empty set = no role yet ("Waiting for access").
 */
export function rolesFor(isAdmin: boolean, jobRoles: ReadonlyArray<string> | null | undefined): ReadonlySet<AppRole> {
  const held = jobRoles ?? [];
  if (isAdmin || held.some((r) => ADMIN_JOB_ROLES.includes(r))) return new Set<AppRole>(["admin"]);
  const out = new Set<AppRole>();
  for (const r of COMBINABLE_ROLES) if (held.includes(r)) out.add(r);
  return out;
}

/** True if the person (team admin flag + job roles) holds `role`. */
export function hasRole(
  org: { isAdmin: boolean; jobRoles?: ReadonlyArray<string> | null },
  role: AppRole,
): boolean {
  return rolesFor(org.isAdmin, org.jobRoles).has(role);
}

/** True if the person holds at least one of `roles`. */
export function hasAnyRole(
  org: { isAdmin: boolean; jobRoles?: ReadonlyArray<string> | null },
  ...roles: AppRole[]
): boolean {
  const held = rolesFor(org.isAdmin, org.jobRoles);
  return roles.some((r) => held.has(r));
}

/** The roles held, in APP_ROLES order, from a stored membership / invite (role + jobRoles). */
export function appRolesOf(role: string, jobRoles: ReadonlyArray<string> | null | undefined): AppRole[] {
  const held = rolesFor(role === "admin", jobRoles);
  return APP_ROLES.filter((r) => held.has(r));
}

/**
 * The ONE view a person lands in by default (UI only: the home redirect and default screens).
 * Priority admin, asset_manager, technician, accountant; "none" for no role. No server permission
 * may depend on this; use the role set.
 */
export type PrimaryView = AppRole | "none";
export function primaryView(roles: ReadonlySet<AppRole>): PrimaryView {
  for (const r of APP_ROLES) if (roles.has(r)) return r;
  return "none";
}

export const ROLE_MESSAGES = {
  none: "Pick at least one role for this person.",
  invalid: "Pick a valid role: Admin, Asset manager, Technician or Accountant.",
  adminCombined: "Admin already includes every role — remove the others or untick Admin.",
} as const;

/**
 * Checks a role selection sent by a client (Team page, invite form). Returns the roles in
 * APP_ROLES order with duplicates removed, or the user-facing error. Rules: at least one role; only
 * the four known roles; Admin cannot be combined with another role.
 */
export function checkRoles(values: unknown): { ok: true; roles: AppRole[] } | { ok: false; error: string } {
  const list = Array.isArray(values) ? values : values === null || values === undefined ? [] : [values];
  const picked = new Set<AppRole>();
  for (const raw of list) {
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === "" || value === null || value === undefined) continue;
    if (typeof value !== "string" || !(APP_ROLES as ReadonlyArray<string>).includes(value)) {
      return { ok: false, error: ROLE_MESSAGES.invalid };
    }
    picked.add(value as AppRole);
  }
  if (picked.size === 0) return { ok: false, error: ROLE_MESSAGES.none };
  if (picked.has("admin") && picked.size > 1) return { ok: false, error: ROLE_MESSAGES.adminCombined };
  return { ok: true, roles: APP_ROLES.filter((r) => picked.has(r)) };
}

/**
 * Forward mapping: the membership role and job roles a (checked) role selection is stored as.
 * Admin keeps its historical storage (executive + maintenance_lead); the others are stored as-is.
 */
export function storageForRoles(roles: ReadonlyArray<AppRole>): {
  role: "admin" | "member";
  jobRoles: Array<"executive" | "maintenance_lead" | "asset_manager" | "technician" | "accountant">;
} {
  if (roles.includes("admin")) return { role: "admin", jobRoles: ["executive", "maintenance_lead"] };
  return { role: "member", jobRoles: COMBINABLE_ROLES.filter((r) => roles.includes(r)) };
}
