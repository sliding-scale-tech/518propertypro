// The Team page's tabs, kept pure (no React) so scripts/probes/team_tabs.test.mjs can load them.
// This only decides what the page SHOWS; every query and mutation behind a tab re-checks access
// on the server.

export type TeamTab = "members" | "routing" | "settings" | "audit";

export const TEAM_TABS: ReadonlyArray<{ value: TeamTab; label: string; adminOnly: boolean }> = [
  { value: "members", label: "Members", adminOnly: false },
  { value: "routing", label: "Lead routing", adminOnly: true },
  { value: "settings", label: "Settings", adminOnly: false },
  { value: "audit", label: "Audit log", adminOnly: true },
];

export const DEFAULT_TEAM_TAB: TeamTab = "members";

/** The tabs this viewer may open: everyone gets Members and Settings (read-only for non-admins). */
export function visibleTeamTabs(isAdmin: boolean): Array<{ value: TeamTab; label: string }> {
  return TEAM_TABS.filter((t) => isAdmin || !t.adminOnly).map(({ value, label }) => ({ value, label }));
}

/** `?tab=` value to a tab this viewer may open; anything unknown or not allowed falls back to Members. */
export function parseTeamTab(raw: string | null | undefined, isAdmin: boolean): TeamTab {
  const found = visibleTeamTabs(isAdmin).find((t) => t.value === raw);
  return found ? found.value : DEFAULT_TEAM_TAB;
}

/** URL for a tab. Members is the bare path; switching tabs drops the other list parameters. */
export function teamTabHref(tab: TeamTab): string {
  return tab === DEFAULT_TEAM_TAB ? "/team" : `/team?tab=${tab}`;
}
