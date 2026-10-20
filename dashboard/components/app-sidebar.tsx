"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useClerk, useUser } from "@clerk/nextjs";
import {
  Phone,
  Building2,
  Menu,
  X,
  BookOpen,
  ClipboardList,
  Users,
  UserRound,
  FileText,
  ChevronDown,
  ChevronRight,
  Home,
  LogOut,
  CalendarRange,
  Sparkles,
  CircleDollarSign,
  Box,
  Target,
  CircleUser,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { AppView } from "@/convex/authz";

type NavLeaf = {
  href: string;
  label: string;
  icon: typeof Phone;
  // Which views see this link. Undefined = every view.
  views?: AppView[];
  // Live count badge: open work (new + waiting + forwarded), with a red dot when exceptions need routing.
  badge?: "workorders";
  // Extra path prefixes that light this link up (detail pages and legacy URLs).
  alsoActive?: string[];
  // When set, the link is active only if this query key matches (Team vs Technicians).
  query?: { key: string; value: string };
};

type NavEntry = NavLeaf | { group: string; icon: typeof Phone; items: NavLeaf[] };

function isActiveLink(pathname: string, search: string, link: NavLeaf): boolean {
  const params = new URLSearchParams(search);
  if (link.query) {
    return pathname === link.href && params.get(link.query.key) === link.query.value;
  }
  if (link.href === "/team" && params.get("role")) return false;
  if (link.href === "/finance" && params.get("view")) return false;
  if (isActiveHref(pathname, link.href)) return true;
  return (link.alsoActive ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Exact match, or a nested route when no other nav link matches it more closely. */
function isActiveHref(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  return !NAV_HREFS.some((h) => h.length > href.length && (pathname === h || pathname.startsWith(`${h}/`)));
}

function isGroup(entry: NavEntry): entry is { group: string; icon: typeof Phone; items: NavLeaf[] } {
  return "group" in entry;
}

/**
 * The sidebar, as the Pat (admin) prototype has it: standalone destinations plus collapsible
 * groups. Asset managers and accountants get flat, trimmed lists of the same destinations.
 *
 * WhatsApp, Messages and Agent settings are deliberately absent rather than hidden behind a
 * flag — each route, page and backend still works and is reachable by URL, they just aren't
 * linked from anywhere while they're off the roadmap.
 *
 * Old URLs (/maintenance, /work-orders/queue, /units, /residents, /audit) now redirect to their
 * new homes; `alsoActive` keeps the right link lit on the detail pages that still live there.
 */
const NAV: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home, views: ["admin", "accountant", "asset_manager"] },
  {
    group: "Maintenance",
    icon: Users,
    items: [
      {
        href: "/work-orders",
        label: "Work Orders",
        icon: ClipboardList,
        views: ["admin", "asset_manager", "accountant"],
        badge: "workorders",
        alsoActive: ["/maintenance"],
      },
      { href: "/asset-managers", label: "Assets Managers", icon: Sparkles, views: ["admin"] },
    ],
  },
  {
    group: "Customers",
    icon: UserRound,
    items: [
      { href: "/leads", label: "Leads", icon: Sparkles, views: ["admin", "asset_manager"] },
      { href: "/tenants", label: "Tenants", icon: FileText, views: ["admin", "asset_manager"], alsoActive: ["/residents"] },
    ],
  },
  {
    group: "Knowledge",
    icon: Box,
    items: [
      { href: "/docs", label: "Knowledge", icon: BookOpen, views: ["admin"] },
      {
        href: "/properties",
        label: "Property",
        icon: Building2,
        views: ["admin", "asset_manager", "accountant"],
        alsoActive: ["/units"],
      },
    ],
  },
  {
    group: "Finance",
    icon: CircleDollarSign,
    items: [
      { href: "/finance", label: "Payment", icon: FileText, views: ["admin"] },
      {
        href: "/finance",
        label: "Owner Reports",
        icon: FileText,
        views: ["admin"],
        query: { key: "view", value: "statements" },
      },
    ],
  },
  {
    group: "Productivity",
    icon: Target,
    items: [
      { href: "/calendar", label: "Calendar", icon: CalendarRange, views: ["admin", "asset_manager"] },
    ],
  },
  { href: "/call", label: "Call", icon: Phone, views: ["admin"] },
  { href: "/sarah", label: "Sarah config", icon: Sparkles, views: ["admin"] },
  { href: "/profile", label: "Profile", icon: CircleUser, views: ["asset_manager"] },
  // The roster: hidden from asset managers, who manage themselves on /profile. The page hides
  // every control a viewer cannot use, and convex/team.ts re-checks the role on every write.
  { href: "/team", label: "Team", icon: Users, views: ["admin", "accountant", "technician"] },
];

const NAV_HREFS = NAV.flatMap((e) => (isGroup(e) ? e.items.map((i) => i.href) : [e.href]));

// The bottom nav only has room for a handful of items; whichever of these the view can see,
// in this order, take the slots. The rest live in the "More" sheet.
const BOTTOM_NAV_ORDER = ["/dashboard", "/work-orders", "/leads", "/properties"];
const BOTTOM_NAV_SLOTS = 3;

/**
 * Narrows a nav entry list to what `view` may see; groups left empty drop out.
 *
 * The role-restricted links are the nav's job, not its security: the server re-checks every
 * query and mutation. `view` is undefined while the query is in flight, and null for someone
 * with no team — neither sees any link, so a restricted tab never flashes into view before we
 * know it belongs there.
 */
function entriesFor(view: AppView | undefined): NavEntry[] {
  if (!view) return [];
  const allowed = (link: NavLeaf) => !link.views || link.views.includes(view);
  return NAV.flatMap((entry): NavEntry[] => {
    if (!isGroup(entry)) return allowed(entry) ? [entry] : [];
    const items = entry.items.filter(allowed);
    return items.length > 0 ? [{ ...entry, items }] : [];
  });
}

/** Every destination the view can see, flattened — what the mobile nav and "More" sheet use. */
function leavesOf(entries: NavEntry[]): NavLeaf[] {
  return entries.flatMap((entry) => (isGroup(entry) ? entry.items : [entry]));
}

/** The signed-in person's view, or undefined while loading / when they have no team. */
function useAppView(): AppView | undefined {
  return useQuery(api.team.myAccess)?.view;
}

function NavBadge() {
  const counts = useQuery(api.board.counts);
  if (!counts) return null;
  const n = counts.review + counts.pat;
  const exceptions = counts.exceptions > 0;
  if (n <= 0 && !exceptions) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {n > 0 ? (
        <span
          className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground"
          aria-label={`${n} open`}
        >
          {n > 99 ? "99+" : n}
        </span>
      ) : null}
      {exceptions ? (
        <span
          className="h-2 w-2 rounded-full bg-danger-ink"
          role="img"
          aria-label={`${counts.exceptions} need routing`}
          title={`${counts.exceptions} need routing`}
        />
      ) : null}
    </span>
  );
}

function linkHref(link: NavLeaf): string {
  if (!link.query) return link.href;
  return `${link.href}?${link.query.key}=${encodeURIComponent(link.query.value)}`;
}

function NavRow({
  link,
  active,
  nested = false,
  onNavigate,
}: {
  link: NavLeaf;
  active: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = link.icon;
  return (
    <Link
      href={linkHref(link)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 text-[14px] leading-5 transition-colors ${
        nested ? "rounded-lg px-3 py-2" : "rounded-xl px-3.5 py-2.5"
      } ${
        active
          ? "bg-[#eff6ff] font-medium text-[#2563eb]"
          : nested
            ? "font-medium text-[#475569] hover:bg-[#f8fafc]"
            : "font-semibold text-[#475569] hover:bg-[#f8fafc]"
      }`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${active ? "text-[#2563eb]" : "text-[#64748b]"}`} />
      <span className="truncate">{link.label}</span>
      {link.badge ? (
        <span className="ml-auto flex items-center gap-1.5">
          <NavBadge />
        </span>
      ) : null}
    </Link>
  );
}

function NavGroup({
  group,
  icon: Icon,
  items,
  pathname,
  search,
  onNavigate,
  open,
  onToggle,
}: {
  group: string;
  icon: typeof Phone;
  items: NavLeaf[];
  pathname: string;
  search: string;
  onNavigate?: () => void;
  open: boolean;
  onToggle: () => void;
}) {

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-[14px] font-medium leading-5 text-[#475569] transition-colors hover:bg-[#f8fafc]"
      >
        <span className="flex items-center gap-3">
          <Icon className="h-5 w-5 shrink-0 text-[#64748b]" />
          {group}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#94a3b8] transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-1 py-1 pl-8 pr-2">
          {items.map((item) => (
            <NavRow
              key={item.label}
              link={item}
              nested
              active={isActiveLink(pathname, search, item)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function useLocationSearch(pathname: string): string {
  const [search, setSearch] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read after mount to avoid hydration mismatch
    setSearch(window.location.search);
  }, [pathname]);
  return search;
}

const GROUPS_KEY = "simplr:sidebar-closed-groups";

/** Which groups the person collapsed, remembered in this browser only (a convenience, never state). */
function useClosedGroups(): [Record<string, boolean>, (group: string) => void] {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GROUPS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed)) if (v === true) next[k] = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate from browser storage
        setClosed(next);
      }
    } catch {
      // storage blocked or corrupt: start with every group open
    }
  }, []);
  const toggle = (group: string) =>
    setClosed((current) => {
      const next = { ...current, [group]: !current[group] };
      try {
        window.localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  return [closed, toggle];
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useLocationSearch(pathname);
  const view = useAppView();
  const [closed, toggleGroup] = useClosedGroups();

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {entriesFor(view).map((entry) => {
        if (isGroup(entry)) {
          return (
            <NavGroup
              key={entry.group}
              group={entry.group}
              icon={entry.icon}
              items={entry.items}
              pathname={pathname}
              search={search}
              onNavigate={onNavigate}
              open={!closed[entry.group]}
              onToggle={() => toggleGroup(entry.group)}
            />
          );
        }
        return (
          <NavRow
            key={entry.label}
            link={entry}
            active={isActiveLink(pathname, search, entry)}
            onNavigate={onNavigate}
          />
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="block h-[45px] w-[123px] shrink-0" aria-label="Simplr — go home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/simplr-logo.png" alt="Simplr" className="h-[45px] w-[123px] object-contain object-left" />
    </Link>
  );
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** The signed-in person, at the foot of the sidebar — and the only way out (Log out). */
function UserProfile({ compact = false }: { compact?: boolean }) {
  const { user, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const view = useAppView();
  const [open, setOpen] = useState(false);

  if (!isSignedIn || !user) return null;

  const name =
    user.fullName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.primaryEmailAddress?.emailAddress ||
    "Account";
  const email = user.primaryEmailAddress?.emailAddress;
  const logout = () => void signOut({ redirectUrl: "/" });

  const roleLabel =
    view === "admin"
      ? "Admin"
      : view === "asset_manager"
        ? "Asset Manager"
        : view === "accountant"
          ? "Accountant"
          : view === "technician"
            ? "Technician"
            : "Member";

  const avatar = (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-[12px] font-bold tracking-[0.3px] text-white">
      {initialsOf(name)}
    </span>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="Account menu"
        className={`flex items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-[#f8fafc] ${
          compact ? "" : "w-full"
        }`}
      >
        {avatar}
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold leading-[17.5px] text-[#1e293b]">{name}</span>
              <span className="block truncate text-[12px] leading-4 text-[#94a3b8]">{roleLabel}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#94a3b8]" />
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close account menu"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className={`absolute z-50 w-56 rounded-[16px] border border-border bg-card p-2 shadow-card ${
                compact ? "right-0 top-11" : "bottom-14 left-0 right-0"
              }`}
            >
              <div className="px-2 py-1.5">
                <div className="truncate text-sm font-medium text-sidebar-foreground">{name}</div>
                {email ? (
                  <div className="truncate text-[11px] text-sidebar-foreground/50">{email}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={logout}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AppSidebar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();
  const view = useAppView();
  const leaves = leavesOf(entriesFor(view));
  const bottomLinks = BOTTOM_NAV_ORDER.flatMap((href) => leaves.filter((l) => l.href === href)).slice(
    0,
    BOTTOM_NAV_SLOTS,
  );
  const moreLinks = leaves.filter((l) => !bottomLinks.includes(l));
  const search = useLocationSearch(pathname);
  const moreActive = moreLinks.some((l) => isActiveLink(pathname, search, l));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[#e2e8f0] bg-white lg:flex">
        <div className="flex min-h-0 flex-1 flex-col gap-8 px-5 pt-5">
          <Brand />
          <NavLinks />
        </div>
        <div className="border-t border-[#f1f5f9] px-3 pb-3 pt-[13px]">
          <UserProfile />
        </div>
      </aside>

      {/* Mobile top bar (brand only — navigation lives in the bottom bar) */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-sidebar-border bg-sidebar/95 px-4 py-3 backdrop-blur-sm lg:hidden">
        <Brand />
        <UserProfile compact />
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-sidebar-border bg-sidebar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden">
        {bottomLinks.map((link) => {
          const active = isActiveLink(pathname, search, link);
          const Icon = link.icon;
          return (
            <Link
              key={link.label}
              href={linkHref(link)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px]"
            >
              <Icon
                className={`h-5 w-5 ${active ? "text-primary" : "text-sidebar-foreground/60"}`}
              />
              <span className={active ? "font-medium text-primary" : "text-sidebar-foreground/60"}>
                {link.label}
              </span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px]"
          aria-label="More"
        >
          <Menu className={`h-5 w-5 ${moreActive ? "text-primary" : "text-sidebar-foreground/60"}`} />
          <span className={moreActive ? "font-medium text-primary" : "text-sidebar-foreground/60"}>
            More
          </span>
        </button>
      </nav>

      {/* "More" sheet — everything the bottom bar has no room for */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-sidebar-border bg-sidebar p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:hidden"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-sidebar-foreground">More</span>
                <button
                  onClick={() => setMoreOpen(false)}
                  className="rounded-lg p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {moreLinks.map((link) => {
                  const active = isActiveLink(pathname, search, link);
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.label}
                      href={linkHref(link)}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${
                        active
                          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
