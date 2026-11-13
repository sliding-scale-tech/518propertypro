"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { LayoutDashboard, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMyRoles } from "@/components/require-view";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

/**
 * Technician layout: mobile-first, no desktop sidebar. app-chrome skips its own shell for
 * /tech so this top bar is the only chrome.
 */
export default function TechLayout({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // A technician who also holds another role (B31) can get back to the rest of the app.
  const roles = useMyRoles();
  const otherRoles = (roles ?? []).filter((r) => r !== "technician");
  const name =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";

  // Close the menu on an outside tap or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/simplr-logo.png" alt="Simplr" className="h-7 w-auto max-w-[60%] object-contain object-left" />
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">
              {initialsOf(name)}
            </span>
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-border bg-card p-2">
              <div className="px-3 py-2">
                <p className="break-words text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">Technician</p>
              </div>
              {otherRoles.length > 0 ? (
                <Link
                  href="/dashboard"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex h-11 w-full items-center gap-2 rounded-[8px] px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <LayoutDashboard aria-hidden className="h-4 w-4" />
                  Dashboard
                </Link>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => void signOut({ redirectUrl: "/" })}
                className="flex h-11 w-full items-center gap-2 rounded-[8px] px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <LogOut aria-hidden className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-6 py-6">{children}</main>
    </div>
  );
}
