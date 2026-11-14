import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/change-password-form";

export const metadata: Metadata = { title: "Set your new password" };

/**
 * Forced password change on first login. Signed-in only (not in lib/public-routes.ts); proxy.ts and
 * the app chrome send anyone still on a temporary password here, and nowhere else.
 */
export default function ChangePasswordPage() {
  return <ChangePasswordForm />;
}
