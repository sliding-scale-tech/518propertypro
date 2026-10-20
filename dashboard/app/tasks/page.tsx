import { redirect } from "next/navigation";

/** The Tasks page was removed; work orders are the only page. Old links land here. */
export default function TasksRedirect() {
  redirect("/work-orders");
}
