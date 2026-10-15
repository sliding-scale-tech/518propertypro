"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Technician layout: mobile-first, no desktop sidebar. app-chrome skips its own shell for
 * /tech so this top bar is the only chrome.
 */
export default function TechLayout({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const name =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
        <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
        <button
          onClick={() => void signOut({ redirectUrl: "/" })}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}
