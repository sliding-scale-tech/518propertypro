"use client";

import { Building2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  DataTable,
  Field,
  Pagination,
  Pill,
  SearchBox,
  Select,
  SortHeader,
  ariaSortOf,
  paginate,
  readSort,
  toggleSort,
  useUrlPaging,
  useUrlSearch,
  type Column,
} from "@/components/ui";
import { normalizeSearch } from "@/components/finance/payments-search";
import { TEAM_LABELS, teamLabel, type Team } from "@/convex/rentPaymentsPolicy";
import {
  PROPERTY_SORT_DEFAULT,
  PROPERTY_SORT_KEYS,
  propertiesView,
  type PropertyFinderRow,
  type PropertySortKey,
} from "./property-finders";

const TEAMS = Object.keys(TEAM_LABELS) as Team[];

/**
 * The properties list (`/properties`): search, team filter, sortable headers and paging, all in the
 * URL. A row opens the property (`?property=<id>`); `onOpen` does the navigation.
 */
export function PropertyList<T extends PropertyFinderRow & { _id: string; yourUnits: number }>({
  properties,
  isAm,
  onOpen,
}: {
  properties: readonly T[];
  isAm: boolean;
  onOpen: (p: T) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = useUrlSearch();
  const q = normalizeSearch(search.q);
  const rawTeam = params.get("team") ?? "";
  const team = (TEAMS as string[]).includes(rawTeam) ? rawTeam : "";
  const sort = readSort(params.get("sort"), params.get("dir"), PROPERTY_SORT_KEYS, PROPERTY_SORT_DEFAULT);
  const paging = useUrlPaging();

  /** Set URL params ("" removes one); any change goes back to page 1. */
  const setParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const onSort = (key: PropertySortKey) => {
    const nextSort = toggleSort(sort, key);
    const isDefault = nextSort.key === PROPERTY_SORT_DEFAULT.key && nextSort.dir === PROPERTY_SORT_DEFAULT.dir;
    setParams({ sort: isDefault ? "" : nextSort.key, dir: isDefault ? "" : nextSort.dir });
  };
  const sortable = (key: PropertySortKey, label: string, align: "left" | "right" = "left") => ({
    header: <SortHeader label={label} sortKey={key} sort={sort} onSort={onSort} align={align} />,
    sort: ariaSortOf(sort, key),
  });

  const visible = propertiesView(properties, { q, team, sort });
  const paged = paginate(visible, paging.page, paging.pageSize);
  const filtered = Boolean(q || team);

  const columns: Column<T>[] = [
    { key: "name", ...sortable("name", "Property"), render: (p) => <span className="font-medium">{p.name}</span> },
    {
      key: "address",
      ...sortable("address", "Address"),
      render: (p) => p.address?.formatted ?? <span className="text-faint">No address</span>,
    },
    {
      key: "team",
      ...sortable("team", "Team"),
      render: (p) => (p.category ? <Pill>{teamLabel(p.category)}</Pill> : <span className="text-faint">No team</span>),
    },
    {
      key: "units",
      ...sortable("units", isAm ? "Your units" : "Units", "right"),
      align: "right",
      className: "tabular-nums",
      render: (p) => (isAm ? `${p.yourUnits} of ${p.unitCount}` : p.unitCount),
    },
  ];

  return (
    <Card>
      <div className="mb-3">
        <SearchBox
          id="properties-search"
          label="Search properties"
          value={search.input}
          onChange={search.setInput}
          onClear={search.clear}
          placeholder={isAm ? "Search property or address" : "Search property, address or owner"}
        />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Team" htmlFor="properties-team">
          <Select id="properties-team" value={team} onChange={(e) => setParams({ team: e.target.value || "" })}>
            <option value="">All teams</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {TEAM_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <DataTable
        caption="Properties"
        columns={columns}
        rows={paged.rows}
        rowKey={(p) => p._id}
        onRowClick={onOpen}
        empty={
          properties.length === 0 ? (
            <span className="inline-flex items-center gap-2">
              <Building2 aria-hidden className="h-4 w-4" /> No properties yet.
            </span>
          ) : q ? (
            <span>
              No properties match &ldquo;{search.q.trim()}&rdquo;
              {team ? ` in ${teamLabel(team)}` : ""}.{" "}
              <button type="button" onClick={search.clear} className="font-medium text-primary hover:underline">
                Clear search
              </button>
            </span>
          ) : filtered ? (
            "No properties match these filters."
          ) : (
            "No properties yet."
          )
        }
      />
      <Pagination
        label="Properties pages"
        page={paged.page}
        pageSize={paged.pageSize}
        total={paged.total}
        onPage={paging.setPage}
        onPageSize={paging.setPageSize}
      />
    </Card>
  );
}
