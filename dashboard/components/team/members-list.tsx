"use client";

import type { FunctionReturnType } from "convex/server";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AppRoleBadge } from "@/components/team/member-details";
import { ROLE_FILTERS, inviteTypeLabel, matchesRoleFilter, parseRoleFilter, type RoleFilter } from "@/components/team/invite-panel";
import { MEMBER_SORT_DEFAULT, MEMBER_SORT_KEYS, membersView, type MemberSortKey } from "@/components/team/member-list-view";
import {
  Avatar,
  Card,
  CardHead,
  Chips,
  Pagination,
  SearchBox,
  Select,
  Toggle,
  paginate,
  readSort,
  useUrlPaging,
  useUrlSearch,
} from "@/components/ui";

type Member = NonNullable<FunctionReturnType<typeof api.team.overview>>["members"][number];

const SORT_OPTIONS: Array<{ key: MemberSortKey; dir: "asc" | "desc"; label: string }> = [
  { key: "name", dir: "asc", label: "Name A to Z" },
  { key: "name", dir: "desc", label: "Name Z to A" },
  { key: "role", dir: "asc", label: "Role" },
  { key: "joined", dir: "desc", label: "Newest first" },
  { key: "joined", dir: "asc", label: "Oldest first" },
];

/**
 * The Members card of /team: search, role filter, sort and paging (all kept in the URL). The whole
 * row opens the member drawer; the Tours switch is a sibling of the row button so it works alone.
 * Needs a <Suspense> boundary (URL state).
 */
export function MembersList({
  members,
  isAdmin,
  busy,
  onOpen,
  onToggleTours,
}: {
  members: Member[];
  isAdmin: boolean;
  busy: boolean;
  onOpen: (membershipId: string) => void;
  onToggleTours: (member: Member) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = useUrlSearch();
  const paging = useUrlPaging();
  const roleFilter = parseRoleFilter(params.get("role"));
  const sort = readSort(params.get("sort"), params.get("dir"), MEMBER_SORT_KEYS, MEMBER_SORT_DEFAULT);

  /** Change URL parameters; any filter, search or sort change goes back to page 1. */
  const setParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const visible = membersView(members, {
    q: search.q,
    roleMatches: (m) => matchesRoleFilter(roleFilter, m),
    roleLabel: (m) => inviteTypeLabel(m),
    sort,
  });
  const paged = paginate(visible, paging.page, paging.pageSize);
  const sortValue = `${sort.key}:${sort.dir}`;

  return (
    <Card>
      <CardHead
        title={
          <>
            Members <span className="text-muted-foreground">({members.length})</span>
          </>
        }
        icon={<Shield />}
        hint={`The Tours switch decides whether Sarah books tours for someone. ${
          isAdmin ? "You can switch anyone's." : "You can switch your own; an Admin can switch anyone's."
        }`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
        <SearchBox
          id="members-search"
          label="Search members"
          placeholder="Search by name, email or role"
          value={search.input}
          onChange={search.setInput}
          onClear={search.clear}
        />
        <div>
          <Select
            id="members-sort"
            aria-label="Sort members"
            value={sortValue}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              const isDefault = key === MEMBER_SORT_DEFAULT.key && dir === MEMBER_SORT_DEFAULT.dir;
              setParams({ sort: isDefault ? "" : key, dir: isDefault ? "" : dir });
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={`${o.key}:${o.dir}`} value={`${o.key}:${o.dir}`}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mb-4">
        <Chips
          label="Filter by role"
          value={roleFilter}
          onChange={(next: RoleFilter) => setParams({ role: next === "all" ? "" : next })}
          options={ROLE_FILTERS.map((f) => ({
            value: f.value,
            label: `${f.label} (${members.filter((m) => matchesRoleFilter(f.value, m)).length})`,
          })).filter((o) => o.value !== "none" || roleFilter === "none" || members.some((m) => m.appRole === null))}
        />
      </div>

      <div className="space-y-2">
        {visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {search.q.trim()
              ? `No members match “${search.q.trim()}”${roleFilter === "all" ? "" : " with this role"}.`
              : roleFilter === "all"
                ? "No members yet."
                : "No one with this role yet."}
          </p>
        ) : null}
        {paged.rows.map((member) => {
          const canSwitch = isAdmin || member.isSelf;
          return (
            <motion.div
              key={member.membershipId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center rounded-2xl border border-border transition-colors hover:bg-muted/50"
            >
              {/* The whole row opens the drawer. The Tours switch is a sibling, not a child, so
                  it works on its own without opening it. */}
              <button
                type="button"
                onClick={() => onOpen(member.membershipId)}
                aria-label={`Open details for ${member.name}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                {member.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={member.imageUrl} alt="" className="h-[30px] w-[30px] shrink-0 rounded-full object-cover" />
                ) : (
                  <Avatar
                    name={member.name}
                    tone={
                      member.appRole === "admin"
                        ? "warn"
                        : member.appRole === "technician"
                          ? "ok"
                          : member.appRole === "accountant"
                            ? "vio"
                            : "acc"
                    }
                  />
                )}
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  <span className="truncate">{member.name}</span>
                  {member.isSelf ? <span className="text-xs font-normal text-muted-foreground">you</span> : null}
                  <AppRoleBadge appRole={member.appRole} />
                </span>
              </button>
              <div
                className="flex shrink-0 items-center gap-2 py-3 pr-4"
                title={canSwitch ? undefined : "Only an Admin can change a teammate's tours"}
              >
                <span className="text-xs font-medium text-muted-foreground">Tours</span>
                <Toggle
                  label={`Tours for ${member.name}`}
                  checked={member.takingTours}
                  disabled={busy || !canSwitch}
                  onChange={() => onToggleTours(member)}
                />
              </div>
            </motion.div>
          );
        })}
      </div>

      <Pagination
        label="Member pages"
        page={paged.page}
        pageSize={paging.pageSize}
        total={visible.length}
        onPage={paging.setPage}
        onPageSize={paging.setPageSize}
      />
    </Card>
  );
}
