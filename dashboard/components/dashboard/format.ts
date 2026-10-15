/** Small date/time helpers shared by the dashboard and Asset managers pages. */

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function greeting(at: Date): string {
  const hour = at.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Today" / "Yesterday" / "Tomorrow" / "Sep 12". */
export function relativeDay(at: number): string {
  const then = new Date(at);
  const today = new Date();
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(then, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(then, yesterday)) return "Yesterday";
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (same(then, tomorrow)) return "Tomorrow";
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatTime(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(at);
}
