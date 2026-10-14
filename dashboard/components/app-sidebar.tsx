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
  Package,
  Target,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  CalendarRange,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type NavLeaf = {
  href: string;
  label: string;
  icon: typeof Phone;
  adminOnly?: boolean;
};

type NavEntry = NavLeaf | { group: string; icon: typeof Phone; items: NavLeaf[] };

function isGroup(entry: NavEntry): entry is { group: string; icon: typeof Phone; items: NavLeaf[] } {
  return "group" in entry;
}

/**
 * The sidebar, as the design has it: four standalone destinations and three collapsible
 * groups.
 *
 * WhatsApp, Messages and Agent settings are deliberately absent rather than hidden behind a
 * flag — each route, page and backend still works and is reachable by URL, they just aren't
 * linked from anywhere while they're off the roadmap.
 */
const NAV: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/call", label: "Call", icon: Phone },
  {
    group: "Customers",
    icon: UsersRound,
    items: [
      { href: "/leads", label: "Leads", icon: UserRoundSearch },
      { href: "/tenants", label: "Tenants", icon: FileText },
    ],
  },
  {
    group: "Knowledge",
    icon: Package,
    items: [
      { href: "/docs", label: "Knowledge", icon: BookOpen },
      { href: "/property", label: "Property", icon: Building2 },
    ],
  },
  {
    group: "Productivity",
    icon: Target,
    items: [
      { href: "/tasks", label: "Tasks", icon: ClipboardCheck },
      { href: "/calendar", label: "Calendar", icon: CalendarRange },
    ],
  },
  { href: "/screening", label: "Screening", icon: ClipboardList },
  // Visible to everyone: members get a read-only roster so they can see who they share the
  // dashboard with. The page itself hides every control they cannot use, and convex/team.ts
  // re-checks the role on every write — the nav flag was never the boundary.
  { href: "/team", label: "Team", icon: UserPlus },
];

/** Every destination in NAV, flattened — what the mobile nav and the "More" sheet draw from. */
const ALL_LEAVES: NavLeaf[] = NAV.flatMap((entry) => (isGroup(entry) ? entry.items : [entry]));

// The bottom nav only has room for a handful of items; the rest live in the "More" sheet.
const BOTTOM_NAV_LINKS = ALL_LEAVES.filter((l) =>
  ["/dashboard", "/call", "/leads"].includes(l.href),
);
const MORE_LINKS = ALL_LEAVES.filter((l) => !BOTTOM_NAV_LINKS.includes(l));

/**
 * Hides admin-only tabs from members.
 *
 * Nothing is marked adminOnly today — Team is visible to everyone and restricts itself — but
 * the mechanism stays for the finer-grained limits planned later.
 *
 * Undefined while the query is in flight, and null for someone with no team — both resolve to
 * "not an admin", so an admin-only tab never flashes into view before we know it belongs there.
 */
function useIsOrgAdmin() {
  return useQuery(api.team.overview)?.isAdmin ?? false;
}

function visible(links: NavLeaf[], isAdmin: boolean) {
  return links.filter((link) => !link.adminOnly || isAdmin);
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
      className={`relative flex items-center rounded-xl transition-colors ${
        nested ? "gap-3 px-3 py-2 text-sm" : "gap-3 px-3.5 py-2.5 text-sm"
      } ${active ? "" : "hover:bg-sidebar-accent/60"}`}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-xl bg-sidebar-accent"
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        />
      )}
      <Icon
        className={`relative z-10 h-4 w-4 shrink-0 ${
          active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/55"
        }`}
      />
      <span
        className={`relative z-10 ${
          active
            ? "font-semibold text-sidebar-accent-foreground"
            : "font-medium text-sidebar-foreground/80"
        }`}
      >
        {link.label}
      </span>
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
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-colors hover:bg-sidebar-accent/60"
      >
        <Icon className="h-4 w-4 shrink-0 text-sidebar-foreground/55" />
        <span className="flex-1 text-left font-medium text-sidebar-foreground/80">{group}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-sidebar-foreground/40 transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-1 py-1 pl-6">
          {items.map((item) => (
            <NavRow
              key={item.href}
              link={item}
              nested
              active={pathname === item.href}
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
  const isAdmin = useIsOrgAdmin();

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
      {NAV.map((entry) => {
        if (isGroup(entry)) {
          const items = visible(entry.items, isAdmin);
          if (items.length === 0) return null;
          return (
            <NavGroup
              key={entry.group}
              group={entry.group}
              icon={entry.icon}
              items={items}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          );
        }
        if (entry.adminOnly && !isAdmin) return null;
        return (
          <NavRow
            key={entry.href}
            link={entry}
            active={pathname === entry.href}
            onNavigate={onNavigate}
          />
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="block px-1" aria-label="Simplr — go to dashboard">
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
              className={`absolute z-50 w-56 rounded-xl border border-sidebar-border bg-card p-2 shadow-lg ${
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
  const isAdmin = useIsOrgAdmin();
  const moreActive = MORE_LINKS.some((l) => l.href === pathname);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3.5 py-5 lg:flex">
        <Brand />
        <NavLinks />
        <div className="mt-auto border-t border-sidebar-border pt-3">
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
        {BOTTOM_NAV_LINKS.map((link) => {
          const active = pathname === link.href;
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
                {visible(MORE_LINKS, isAdmin).map((link) => {
                  const active = pathname === link.href;
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
