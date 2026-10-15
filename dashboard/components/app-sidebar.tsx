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
  ClipboardCheck,
  ClipboardList,
  UserPlus,
  UsersRound,
  UserRoundSearch,
  FileText,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  CalendarRange,
  Wrench,
  Sparkles,
  Wallet,
  Box,
  ShieldCheck,
  Target,
  CircleUser,
} from "lucide-react";
import { useState } from "react";
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
};

type NavEntry = NavLeaf | { group: string; icon: typeof Phone; items: NavLeaf[] };

function isActiveLink(pathname: string, link: NavLeaf): boolean {
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
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, views: ["admin", "accountant", "asset_manager"] },
  { href: "/call", label: "Call", icon: Phone, views: ["admin"] },
  // Accountant flat list (admins and asset managers reach the same pages through the groups below).
  {
    href: "/work-orders",
    label: "Work orders",
    icon: ClipboardList,
    views: ["accountant"],
    badge: "workorders",
    alsoActive: ["/maintenance"],
  },
  { href: "/properties", label: "Property", icon: Building2, views: ["accountant"], alsoActive: ["/units"] },
  {
    group: "Customers",
    icon: UsersRound,
    items: [
      { href: "/leads", label: "Leads", icon: UserRoundSearch, views: ["admin", "asset_manager"] },
      { href: "/tenants", label: "Tenants", icon: FileText, views: ["admin", "asset_manager"], alsoActive: ["/residents"] },
    ],
  },
  {
    group: "Knowledge",
    icon: Box,
    items: [
      { href: "/docs", label: "Knowledge", icon: BookOpen, views: ["admin"] },
      { href: "/properties", label: "Property", icon: Building2, views: ["admin", "asset_manager"], alsoActive: ["/units"] },
    ],
  },
  {
    group: "Maintenance",
    icon: Wrench,
    items: [
      {
        href: "/work-orders",
        label: "Work orders",
        icon: ClipboardList,
        views: ["admin", "asset_manager"],
        badge: "workorders",
        alsoActive: ["/maintenance"],
      },
      { href: "/asset-managers", label: "Asset managers", icon: ShieldCheck, views: ["admin"] },
    ],
  },
  { href: "/finance", label: "Finance", icon: Wallet, views: ["admin"] },
  {
    group: "Productivity",
    icon: Target,
    items: [
      { href: "/tasks", label: "Tasks", icon: ClipboardCheck, views: ["admin", "asset_manager"] },
      { href: "/calendar", label: "Calendar", icon: CalendarRange, views: ["admin", "asset_manager"] },
    ],
  },
  { href: "/sarah", label: "Sarah config", icon: Sparkles, views: ["admin"] },
  { href: "/profile", label: "Profile", icon: CircleUser, views: ["asset_manager"] },
  // The roster: hidden from asset managers, who manage themselves on /profile. The page hides
  // every control a viewer cannot use, and convex/team.ts re-checks the role on every write.
  { href: "/team", label: "Team", icon: UserPlus, views: ["admin", "accountant", "technician"] },
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
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-2xl px-[11px] text-sm transition-colors ${
        nested ? "ml-5 py-1.5" : "py-[7px]"
      } ${active ? "bg-accent font-medium text-primary" : "text-sidebar-foreground/80 hover:bg-muted"}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
      <span>{link.label}</span>
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
  onNavigate,
}: {
  group: string;
  icon: typeof Phone;
  items: NavLeaf[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-2xl px-[11px] pb-[5px] pt-[9px] text-sm transition-colors hover:bg-muted"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left font-medium text-sidebar-foreground/80">{group}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-sidebar-foreground/40 transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavRow
              key={item.href}
              link={item}
              nested
              active={isActiveLink(pathname, item)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const view = useAppView();

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
      {entriesFor(view).map((entry) => {
        if (isGroup(entry)) {
          return (
            <NavGroup
              key={entry.group}
              group={entry.group}
              icon={entry.icon}
              items={entry.items}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          );
        }
        return (
          <NavRow
            key={entry.href}
            link={entry}
            active={isActiveLink(pathname, entry)}
            onNavigate={onNavigate}
          />
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/home" className="block px-1" aria-label="Simplr — go home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/simplr-logo.png" alt="Simplr" className="h-9 w-auto" />
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
  const [open, setOpen] = useState(false);

  if (!isSignedIn || !user) return null;

  const name =
    user.fullName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.primaryEmailAddress?.emailAddress ||
    "Account";
  const email = user.primaryEmailAddress?.emailAddress;
  const logout = () => void signOut({ redirectUrl: "/" });

  const avatar = (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
      {user.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="Account menu"
        className={`flex items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-sidebar-accent/60 ${
          compact ? "" : "w-full"
        }`}
      >
        {avatar}
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground">
              {name}
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-sidebar-foreground/40 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
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
  const moreActive = moreLinks.some((l) => isActiveLink(pathname, l));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col gap-5 border-r border-sidebar-border bg-sidebar px-[11px] pb-3 pt-3.5 lg:flex">
        <Brand />
        <NavLinks />
        <div className="mt-auto border-t border-sidebar-border pt-2.5">
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
          const active = isActiveLink(pathname, link);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
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
                  const active = isActiveLink(pathname, link);
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
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
