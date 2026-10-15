import { redirect } from "next/navigation";

// Leasing screening moved into Sarah configuration (build plan P17). The old components stay in
// components/screening-questions.tsx and are embedded on the Leasing tab.
export default function ScreeningPage() {
  redirect("/sarah?tab=leasing");
}
