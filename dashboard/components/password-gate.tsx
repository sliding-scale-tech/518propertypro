"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { CHANGE_PASSWORD_PATH, mustChangePasswordFromMetadata } from "@/lib/password-gate";

/**
 * Client half of the forced password change (convex/passwordGate.ts): renders the app only once both
 * Clerk (publicMetadata) and Convex (users.passwordGate) agree the person is not on a temporary
 * password; otherwise sends them to /change-password. A courtesy layer: proxy.ts redirects on the
 * server and every Convex data function refuses a flagged person on its own.
 */
export function PasswordGate({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useUser();
  const gate = useQuery(api.users.passwordGate);
  const router = useRouter();
  const flagged = mustChangePasswordFromMetadata(user?.publicMetadata) || gate?.mustChangePassword === true;

  useEffect(() => {
    if (flagged) router.replace(CHANGE_PASSWORD_PATH);
  }, [flagged, router]);

  if (!isLoaded || gate === undefined || flagged) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  return <>{children}</>;
}
