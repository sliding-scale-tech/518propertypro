// The Team page's member list: search, role filter and sort in one pure step (no React, so the
// node tests load it directly: scripts/probes/list_views.test.mjs).
import { sortRows, type SortState } from "../ui/table-sort";

export const MEMBER_SORT_KEYS = ["name", "role", "joined"] as const;
export type MemberSortKey = (typeof MEMBER_SORT_KEYS)[number];
export const MEMBER_SORT_DEFAULT: SortState<MemberSortKey> = { key: "name", dir: "asc" };

export type ViewMember = { name: string; email: string; appRole: string | null; joinedAt: number };

/** Admins first, then asset managers, technicians, accountants, and people with no role last. */
const ROLE_RANK: Record<string, number> = { admin: 0, asset_manager: 1, technician: 2, accountant: 3 };
export const roleRank = (appRole: string | null): number => (appRole === null ? 99 : (ROLE_RANK[appRole] ?? 98));

/** Lower-cased, trimmed, inner whitespace collapsed ("  Jo   SMITH " -> "jo smith"). */
export const normalizeMemberSearch = (raw: string): string => raw.trim().replace(/\s+/g, " ").toLowerCase();

/** Every word typed must appear in the member's name, email or role label. */
export function matchesMemberSearch(m: ViewMember, roleLabel: string, q: string): boolean {
  const terms = normalizeMemberSearch(q).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${m.name} ${m.email} ${roleLabel}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function membersView<M extends ViewMember>(
  members: readonly M[],
  opts: { q: string; roleMatches: (m: M) => boolean; roleLabel: (m: M) => string; sort: SortState<MemberSortKey> },
): M[] {
  const kept = members.filter((m) => opts.roleMatches(m) && matchesMemberSearch(m, opts.roleLabel(m), opts.q));
  // Ties fall back to name A-Z whatever the direction, so the order never jumps around.
  const byName = sortRows(kept, (m) => m.name, "asc");
  switch (opts.sort.key) {
    case "name":
      return sortRows(kept, (m) => m.name, opts.sort.dir);
    case "role":
      return sortRows(byName, (m) => roleRank(m.appRole), opts.sort.dir);
    case "joined":
      return sortRows(byName, (m) => m.joinedAt, opts.sort.dir);
  }
}
