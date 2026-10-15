import { redirect } from "next/navigation";

// Old URL kept alive; the content moved (see the Pat-view redesign plan, §2).
export default function Page() {
  redirect("/properties");
}
