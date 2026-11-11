import { ConvexError } from "convex/values";
import { errorMessage } from "@/components/ui/toast";

/**
 * Turns a caught server error into what a form shows (spec 6, form rules): the message to toast and,
 * for a field-level ConvexError (`new ConvexError({ message, field })`, see convex/financeAccess.ts
 * fieldError), the field to mark red. Anything that isn't a ConvexError gets the generic line from
 * errorMessage(); a non-ConvexError's own `.message` is never shown.
 */
export function serverError(e: unknown): { field?: string; message: string } {
  const message = errorMessage(e);
  // `instanceof` can miss across bundles, so also accept the ConvexError shape ({ data }), as errorMessage does.
  if (e instanceof ConvexError || (e && typeof e === "object" && "data" in e)) {
    const data = (e as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const field = (data as { field?: unknown }).field;
      if (typeof field === "string" && field.trim() !== "") return { field, message };
    }
  }
  return { message };
}
