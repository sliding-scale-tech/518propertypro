// The Sarah config page's tabs, kept pure (no React) so scripts/probes/sarah_tabs.test.mjs can load them.
// Phone line and Routing directory live on the Team page now (/team?tab=phone).

export const SARAH_TABS = [
  { id: "call-types", label: "Call types" },
  { id: "maintenance", label: "Maintenance questions" },
  { id: "other-calls", label: "Other call types" },
  { id: "severity", label: "Severity" },
  { id: "emergency", label: "Emergency scripts" },
  { id: "escalation", label: "Escalation contacts" },
  { id: "leasing", label: "Leasing" },
  { id: "tenant-messages", label: "Tenant messages" },
  { id: "identity", label: "Identity" },
] as const;
export type SarahTabId = (typeof SARAH_TABS)[number]["id"];

/**
 * The tabs shown by default. Everything else is behind the "Advanced (Simplr only)" switch.
 * One line to change which tabs the client sees (order on screen follows SARAH_TABS).
 */
export const BASIC_TABS: ReadonlyArray<SarahTabId> = ["emergency", "escalation", "identity"];

/** Where the old Phone line / Routing directory tabs went. */
export const PHONE_ROUTING_HREF = "/team?tab=phone";

/** Old `?tab=` values that now live on the Team page. */
const MOVED_TABS: ReadonlyArray<string> = ["routing", "phone-line"];

export const ADVANCED_STORAGE_KEY = "sarah-config-advanced";

export function isBasicTab(id: SarahTabId): boolean {
  return BASIC_TABS.includes(id);
}

/** The tabs on screen: the basic ones, or all of them when Advanced is on. */
export function visibleSarahTabs(advanced: boolean): Array<{ id: SarahTabId; label: string }> {
  return SARAH_TABS.filter((t) => advanced || isBasicTab(t.id)).map(({ id, label }) => ({ id, label }));
}

export function isSarahTab(raw: string | null | undefined): raw is SarahTabId {
  return SARAH_TABS.some((t) => t.id === raw);
}

/** The first tab on screen (the landing tab). */
export function defaultSarahTab(advanced: boolean): SarahTabId {
  return visibleSarahTabs(advanced)[0].id;
}

/**
 * What the page shows on first load, from the URL's `?tab=` and the remembered Advanced switch.
 * - a tab that moved to the Team page asks for a redirect there;
 * - a deep link to a hidden tab switches Advanced on, so the link shows that tab, not a blank page;
 * - anything unknown lands on the first visible tab.
 */
export function initialSarahView(
  rawTab: string | null | undefined,
  storedAdvanced: boolean,
): { tab: SarahTabId; advanced: boolean; redirectTo: string | null } {
  if (rawTab && MOVED_TABS.includes(rawTab)) {
    return { tab: defaultSarahTab(storedAdvanced), advanced: storedAdvanced, redirectTo: PHONE_ROUTING_HREF };
  }
  if (isSarahTab(rawTab)) {
    return { tab: rawTab, advanced: storedAdvanced || !isBasicTab(rawTab), redirectTo: null };
  }
  return { tab: defaultSarahTab(storedAdvanced), advanced: storedAdvanced, redirectTo: null };
}

/** The remembered switch; localStorage can throw or be empty (private window), so it defaults to off. */
export function readStoredAdvanced(): boolean {
  try {
    return window.localStorage.getItem(ADVANCED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeAdvanced(on: boolean): void {
  try {
    window.localStorage.setItem(ADVANCED_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* not remembered; the switch still works for this visit */
  }
}
