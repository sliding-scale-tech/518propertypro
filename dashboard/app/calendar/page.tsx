"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  PawPrint,
  Phone,
  RefreshCw,
  Settings,
  Sun,
  Trash2,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { WeekView } from "@/convex/calendarView";
import * as sched from "@/convex/tourSchedule";
import { TourHoursEditor, type TourHours } from "@/components/tour-hours-editor";
import { useToast } from "@/components/toast";

// What googleCalendar.handleOAuthCallback sends back in `?google=` after the consent redirect.
const OAUTH_RESULTS: Record<string, { message: string; variant: "success" | "error" | "info" }> = {
  connected: { message: "Google Calendar connected", variant: "success" },
  denied: { message: "Google Calendar was not connected", variant: "info" },
  missing_scopes: {
    message: "Allow both calendar permissions on Google's screen so tours can be booked",
    variant: "error",
  },
  expired: { message: "That attempt took too long. Try connecting again.", variant: "error" },
  error: { message: "Could not connect Google Calendar. Try again.", variant: "error" },
};

const BEDROOM_LABELS: Record<string, string> = {
  studio: "Studio",
  "1br": "1 Bedroom",
  "2br": "2 Bedrooms",
  "3br+": "3+ Bedrooms",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    value,
  );
}

const HOUR_PX = 44;
const HOUR_MS = 60 * 60 * 1000;
const FIRST_VISIBLE_HOUR = 7;
const MAX_VISIBLE_PER_DAY = 3;

const BLOCK_STYLES = {
  event: "border-blue-200 bg-blue-50 text-blue-900",
  busy: "border-border bg-muted text-muted-foreground",
  tour: "border-primary/40 bg-primary/15 text-primary",
} as const;

type ViewMode = "week" | "month";

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function thisMonday(): string {
  const tz = browserTimeZone();
  return sched.localDateKey(sched.weekBounds(Date.now(), tz).start, tz);
}

function thisMonthKey(): string {
  return sched.monthKeyOf(sched.localDateKey(Date.now(), browserTimeZone()));
}

/** The Monday of the week a date key falls in, in a given time zone. */
function mondayOf(day: string, timeZone: string): string {
  return sched.localDateKey(sched.weekBounds(sched.startOfLocalDay(day, timeZone), timeZone).start, timeZone);
}

/** Formats a calendar date (not an instant) — UTC on both sides so no zone can shift the day. */
function formatDate(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

export default function CalendarPage() {
  const settings = useQuery(api.tours.availabilitySettings);
  const googleStatus = useQuery(api.googleCalendar.status);
  const loadWeek = useAction(api.calendarView.week);
  const loadMonth = useAction(api.calendarView.month);
  const toast = useToast();

  // Read from window rather than useSearchParams, which would need a Suspense boundary around
  // the whole page. The param is stripped straight away so a reload does not repeat the toast.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = OAUTH_RESULTS[url.searchParams.get("google") ?? ""];
    if (!result) return;
    toast(result.message, result.variant);
    url.searchParams.delete("google");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [toast]);

  const [mode, setMode] = useState<ViewMode>("week");
  const [weekStart, setWeekStart] = useState(thisMonday);
  const [monthKey, setMonthKey] = useState(thisMonthKey);
  const [userId, setUserId] = useState<Id<"users"> | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const [openTourId, setOpenTourId] = useState<Id<"tours"> | null>(null);
  const [result, setResult] = useState<{ key: string; view?: WeekView; error?: string } | null>(null);

  // Actions are not live queries, so the view is fetched whenever what is being looked at
  // changes. The key lets the page tell a finished fetch for the current view from a stale one.
  const key = mode === "week" ? `week|${weekStart}|${userId ?? "me"}|${refreshes}` : `month|${monthKey}|${userId ?? "me"}|${refreshes}`;
  useEffect(() => {
    let stale = false;
    const promise =
      mode === "week"
        ? loadWeek({ weekStart, userId: userId ?? undefined, fallbackTimeZone: browserTimeZone() })
        : loadMonth({ month: monthKey, userId: userId ?? undefined, fallbackTimeZone: browserTimeZone() });
    promise
      .then((view) => !stale && setResult({ key, view }))
      .catch((err) => !stale && setResult({ key, error: err instanceof Error ? err.message : "Could not load the calendar." }));
    return () => {
      stale = true;
    };
  }, [key, loadWeek, loadMonth, mode, weekStart, monthKey, userId]);

  const loading = result?.key !== key;
  const view = result?.view;
  const lastDay = sched.addDays(weekStart, 6);

  const goPrev = () => (mode === "week" ? setWeekStart(sched.addDays(weekStart, -7)) : setMonthKey(sched.addMonths(monthKey, -1)));
  const goNext = () => (mode === "week" ? setWeekStart(sched.addDays(weekStart, 7)) : setMonthKey(sched.addMonths(monthKey, 1)));
  const goToday = () => (mode === "week" ? setWeekStart(thisMonday()) : setMonthKey(thisMonthKey()));
  const openDay = (day: string, timeZone: string) => {
    setWeekStart(mondayOf(day, timeZone));
    setMode("week");
  };

  // First visit: until someone has saved their tour hours once, the editor opens by itself.
  // Closing it without saving only hides it for this visit, so it asks again next time. Guarded
  // on selfConnected below it — hours mean nothing before a calendar is even connected.
  const [editingHours, setEditingHours] = useState(false);
  const [dismissedPrompt, setDismissedPrompt] = useState(false);
  const firstTime = settings ? !settings.mine.saved : false;
  const [managingDaysOff, setManagingDaysOff] = useState(false);

  // Self view goes through three stages in order: connect Google, set tour hours, see the
  // calendar. A teammate's calendar (admin viewing someone else) skips this entirely — it is
  // that person's own connection being checked, and calendarView.week/month already reports it
  // as a Notice rather than blocking the page.
  const viewingSelf = userId === null;
  const selfConnected = googleStatus?.connected === true && !googleStatus.needsReconnect;
  const disconnect = useAction(api.googleCalendar.disconnect);
  const [disconnecting, setDisconnecting] = useState(false);
  const showHours = viewingSelf && selfConnected && (editingHours || (firstTime && !dismissedPrompt));

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect();
      toast("Google Calendar disconnected");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not disconnect.", "error");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Calendar</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
          Google Calendar events next to the tours Sarah booked. Only you see your own events&apos; details
          {settings?.isAdmin
            ? " — when you open a teammate's calendar, their events show only as busy."
            : " — team admins see them only as busy."}
        </p>
        {viewingSelf && selfConnected ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Connected to Google Calendar as {googleStatus.googleEmail}.{" "}
            <button
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
              className="font-medium text-foreground underline disabled:opacity-50"
            >
              Disconnect
            </button>
          </p>
        ) : null}
      </header>

      {viewingSelf && googleStatus === undefined ? (
        <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
          Loading…
        </p>
      ) : viewingSelf && googleStatus === null ? (
        <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
          Sign in again to connect a calendar.
        </p>
      ) : viewingSelf && !selfConnected ? (
        <ConnectCalendarCard needsReconnect={googleStatus?.connected === true} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={goPrev}
              aria-label={mode === "week" ? "Previous week" : "Previous month"}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-input hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={goToday} className="h-10 rounded-lg border border-input px-4 text-sm font-medium hover:bg-accent">
              {mode === "week" ? "This week" : "This month"}
            </button>
            <button
              onClick={goNext}
              aria-label={mode === "week" ? "Next week" : "Next month"}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-input hover:bg-accent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="px-2 text-sm font-semibold">
              {mode === "week" ? (
                <>
                  {formatDate(weekStart, { month: "short", day: "numeric" })} –{" "}
                  {formatDate(lastDay, { month: "short", day: "numeric", year: "numeric" })}
                </>
              ) : (
                formatDate(`${monthKey}-01`, { month: "long", year: "numeric" })
              )}
            </span>

            <div className="ml-auto flex items-center gap-2">
              {settings && viewingSelf ? (
                <button
                  onClick={() => setEditingHours(true)}
                  className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Clock className="h-4 w-4" />
                  Edit Availability
                </button>
              ) : null}

              <div className="flex items-center gap-0.5 rounded-full border border-input bg-muted/40 p-1">
                <button
                  onClick={() => setMode("week")}
                  aria-pressed={mode === "week"}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    mode === "week" ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Week
                </button>
                <button
                  onClick={() => setMode("month")}
                  aria-pressed={mode === "month"}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    mode === "month" ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Month
                </button>
              </div>

              {settings?.isAdmin ? (
                <select
                  value={userId ?? ""}
                  onChange={(e) => setUserId(e.target.value ? (e.target.value as Id<"users">) : null)}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
                  aria-label="Whose calendar"
                >
                  {settings.team.map((m) => (
                    <option key={m.userId} value={m.isSelf ? "" : m.userId}>
                      {m.isSelf ? `${m.name} (you)` : m.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                onClick={() => setRefreshes((n) => n + 1)}
                aria-label="Refresh"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-input hover:bg-accent"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {result?.error && !loading ? (
            <Notice>{result.error}</Notice>
          ) : view ? (
            <>
              <StatusNotices view={view} />
              <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
                {mode === "week" ? (
                  <WeekGrid view={view} onOpenTour={setOpenTourId} />
                ) : (
                  <MonthGrid
                    view={view}
                    monthKey={monthKey}
                    onOpenTour={setOpenTourId}
                    onOpenDay={(day) => openDay(day, view.timeZone)}
                  />
                )}
              </div>
              <Legend isSelf={view.isSelf} showTourHours={mode === "week"} />
            </>
          ) : (
            <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
              Loading the calendar…
            </p>
          )}

          {settings && viewingSelf ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sun className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold">Need a day off?</p>
                <p className="text-sm text-muted-foreground">You can turn off days that don&apos;t have any tour bookings.</p>
              </div>
              <button
                onClick={() => setManagingDaysOff(true)}
                className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Settings className="h-4 w-4" />
                Manage availability
              </button>
            </div>
          ) : null}
        </>
      )}

      <AnimatePresence>
        {managingDaysOff && settings ? (
          <DaysOffModal
            daysOff={settings.mine.daysOff}
            onClose={() => setManagingDaysOff(false)}
            onChanged={() => setRefreshes((n) => n + 1)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showHours && settings ? (
          <HoursModal
            saved={settings.mine}
            firstTime={firstTime}
            onClose={() => {
              setEditingHours(false);
              setDismissedPrompt(true);
            }}
            onSaved={() => {
              setEditingHours(false);
              setDismissedPrompt(true);
              // The week/month view is an action, not a live query — refetch so it follows.
              setRefreshes((n) => n + 1);
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {openTourId ? (
          <TourModal
            tourId={openTourId}
            onClose={() => setOpenTourId(null)}
            onCancelled={() => {
              setOpenTourId(null);
              setRefreshes((n) => n + 1);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * The Calendar page's very first screen for anyone who hasn't connected Google yet — replaces
 * the whole nav-and-grid area, since none of it means anything before a calendar exists to show.
 * Once connected, the page moves straight on to asking for tour hours (the existing first-time
 * HoursModal), then shows the calendar itself.
 */
function ConnectCalendarCard({ needsReconnect }: { needsReconnect: boolean }) {
  const startConnect = useAction(api.googleCalendar.startConnect);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await startConnect();
      window.location.assign(url);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start connecting.", "error");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-16 text-center shadow-sm">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CalendarDays className="h-7 w-7" />
      </span>
      <div className="max-w-sm">
        <h2 className="text-lg font-semibold">
          {needsReconnect ? "Reconnect your Google Calendar" : "Connect your Google Calendar"}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {needsReconnect
            ? "Google stopped accepting your connection, so Sarah can't book tours for you until you reconnect."
            : "Sarah books tours straight into your calendar, only when you're actually free. Connect it to get started."}
        </p>
      </div>
      <button
        onClick={() => void connect()}
        disabled={busy}
        className="flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
      >
        <CalendarDays className="h-4 w-4" />
        {busy ? "Opening Google…" : needsReconnect ? "Reconnect Google Calendar" : "Connect Google Calendar"}
      </button>
    </div>
  );
}

function HoursModal({
  saved,
  firstTime,
  onClose,
  onSaved,
}: {
  saved: TourHours;
  firstTime: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-hours-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="tour-hours-title" className="text-lg font-bold">
              {firstTime ? "When can you give tours?" : "Your tour hours"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {firstTime
                ? "Sarah only books tours for you inside these hours, and never over anything busy in your calendar. You can change them any time from this page."
                : "Sarah only books tours for you inside these hours, in the team's time zone."}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <TourHoursEditor saved={saved} confirmUnchanged={firstTime} onSaved={onSaved} />
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Turning off a specific date — a one-off exception on top of the recurring weekly hours edited
 * in "Edit Availability" above. Sarah will not book that day at all, regardless of what your
 * weekly hours say.
 */
function DaysOffModal({
  daysOff,
  onClose,
  onChanged,
}: {
  daysOff: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const addDayOff = useMutation(api.tours.addDayOff);
  const removeDayOff = useMutation(api.tours.removeDayOff);
  const toast = useToast();
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleAdd = async () => {
    if (!date) return;
    setBusy(true);
    try {
      await addDayOff({ date });
      toast(`${formatDate(date, { weekday: "long", month: "long", day: "numeric" })} turned off`);
      setDate("");
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not turn that day off.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (day: string) => {
    setBusy(true);
    try {
      await removeDayOff({ date: day });
      toast(`${formatDate(day, { weekday: "long", month: "long", day: "numeric" })} turned back on`);
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change that day.", "error");
    } finally {
      setBusy(false);
    }
  };

  // The date input needs no timezone precision — it only stops picking a day already gone in
  // the browser's own clock. The server has the real, team-timezone-aware check.
  const todayForInput = new Date().toISOString().slice(0, 10);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="days-off-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="days-off-title" className="text-lg font-bold">
              Days off
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn off a specific date — a holiday, an appointment — on top of your weekly hours. You can only
              turn off a day with no tour booked on it.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="mb-1.5 block text-sm font-medium">Turn off a day</span>
              <input
                type="date"
                value={date}
                min={todayForInput}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
              />
            </label>
            <button
              onClick={() => void handleAdd()}
              disabled={!date || busy}
              className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Turn off
            </button>
          </div>

          <div className="mt-5 space-y-2">
            {daysOff.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No days off scheduled.
              </p>
            ) : (
              daysOff.map((day) => (
                <div key={day} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                  <span className="text-sm font-medium">
                    {formatDate(day, { weekday: "long", month: "long", day: "numeric" })}
                  </span>
                  <button
                    onClick={() => void handleRemove(day)}
                    disabled={busy}
                    aria-label={`Turn ${day} back on`}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function StatusNotices({ view }: { view: WeekView }) {
  return (
    <>
      {/* Not reachable for your own calendar any more — CalendarPage shows ConnectCalendarCard
          instead before this ever renders. Only a teammate's calendar reaches here. */}
      {view.calendar !== "connected" ? (
        <Notice>
          {view.calendar === "needs_reconnect"
            ? `${view.name} needs to reconnect Google Calendar, so only Simplr tours are shown.`
            : `${view.name} has not connected Google Calendar, so only Simplr tours are shown.`}
        </Notice>
      ) : null}
      {!view.hours.availableForTours ? (
        <Notice>
          {view.isSelf ? "Your tours are" : `${view.name}'s tours are`} switched off, so Sarah will not book any
          {view.isSelf ? " for you" : ""}. Tours are switched on and off on the{" "}
          <Link href="/team" className="font-medium underline">
            Team page
          </Link>
          .
        </Notice>
      ) : null}
      {!view.teamTimeZoneSet ? (
        <Notice>
          Times are in your browser&apos;s time zone ({view.timeZone.replace(/_/g, " ")}) until an admin sets the
          team time zone on the{" "}
          <Link href="/team" className="font-medium underline">
            Team page
          </Link>
          .
        </Notice>
      ) : null}
    </>
  );
}

type Block = {
  key: string;
  kind: keyof typeof BLOCK_STYLES;
  title: string;
  detail: string;
  top: number;
  height: number;
  lane: number;
  lanes: number;
};

/** Everything that lands on one day, clipped to it, with overlapping items side by side. */
function layoutDay(day: string, view: WeekView): Block[] {
  const tz = view.timeZone;
  const dayStart = sched.startOfLocalDay(day, tz);
  const dayEnd = sched.startOfLocalDay(sched.addDays(day, 1), tz);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

  const raw: Array<{ key: string; kind: Block["kind"]; title: string; detail: string; start: number; end: number }> = [];
  view.items.forEach((item, i) => {
    if (item.kind === "allDay") return;
    raw.push({
      key: `i${i}`,
      kind: item.kind,
      title: item.kind === "event" ? item.title : "Busy",
      detail: `${time.format(item.start)} – ${time.format(item.end)}`,
      start: item.start,
      end: item.end,
    });
  });
  for (const tour of view.tours) {
    raw.push({
      key: tour.id,
      kind: "tour",
      title: `Tour: ${tour.callerName || "Prospective renter"}`,
      detail: [`${time.format(tour.start)} – ${time.format(tour.end)}`, tour.callerPhone].filter(Boolean).join(" · "),
      start: tour.start,
      end: tour.end,
    });
  }

  const clipped = raw
    .map((r) => ({ ...r, start: Math.max(r.start, dayStart), end: Math.min(r.end, dayEnd) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const laneEnds: number[] = [];
  const placed = clipped.map((r) => {
    let lane = laneEnds.findIndex((end) => end <= r.start);
    if (lane === -1) lane = laneEnds.push(r.end) - 1;
    else laneEnds[lane] = r.end;
    return { ...r, lane };
  });

  return placed.map((r) => ({
    key: r.key,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    lane: r.lane,
    lanes: laneEnds.length,
    top: ((r.start - dayStart) / HOUR_MS) * HOUR_PX,
    height: Math.max(20, ((r.end - r.start) / HOUR_MS) * HOUR_PX - 2),
  }));
}

/** Hour ranges on one day that fall outside someone's tour hours, as [fromHour, toHour]. */
function outsideTourHours(day: string, hours: WeekView["hours"]): Array<[number, number]> {
  if (!hours.availableForTours || hours.daysOff.includes(day)) return [[0, 24]];
  const [y, m, d] = day.split("-").map(Number);
  const today = hours.weeklyHours.find((h) => h.day === new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  if (!today) return [[0, 24]];
  const toHours = (hhmm: string) => {
    const [h, min] = hhmm.split(":").map(Number);
    return h + min / 60;
  };
  return [
    [0, toHours(today.start)],
    [toHours(today.end), 24],
  ];
}

function WeekGrid({ view, onOpenTour }: { view: WeekView; onOpenTour: (id: Id<"tours">) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = FIRST_VISIBLE_HOUR * HOUR_PX;
  }, []);

  const days = useMemo(
    () => Array.from({ length: view.rangeDays }, (_, i) => sched.addDays(view.rangeStart, i)),
    [view.rangeStart, view.rangeDays],
  );
  const columns = useMemo(() => days.map((day) => layoutDay(day, view)), [days, view]);
  // Read once per mount rather than every render, which the purity rule rightly flags.
  const [now] = useState(() => Date.now());
  const today = sched.localDateKey(now, view.timeZone);
  const hourLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" });

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border">
          <div />
          {days.map((day) => {
            const allDay = view.items.filter(
              (item) => item.kind === "allDay" && item.startDate <= day && day < item.endDate,
            );
            return (
              <div key={day} className="min-w-0 border-l border-border px-1.5 py-2 text-center">
                <div className="text-xs text-muted-foreground">{formatDate(day, { weekday: "short" })}</div>
                <div
                  className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                    day === today ? "bg-primary text-primary-foreground" : ""
                  }`}
                >
                  {formatDate(day, { day: "numeric" })}
                </div>
                {allDay.map((item, i) => (
                  <div
                    key={i}
                    className={`mt-1 truncate rounded border px-1 py-0.5 text-left text-[11px] ${BLOCK_STYLES.event}`}
                  >
                    {item.kind === "allDay" ? item.title : ""}
                  </div>
                ))}
                {view.hours.daysOff.includes(day) ? (
                  <div className="mt-1 truncate rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">
                    Day off
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div ref={scrollRef} className="max-h-[65vh] overflow-y-auto">
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
            <div className="relative">
              {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground"
                  style={{ top: hour * HOUR_PX }}
                >
                  {hourLabel.format(Date.UTC(2000, 0, 1, hour))}
                </span>
              ))}
            </div>
            {columns.map((blocks, i) => (
              <div key={days[i]} className="relative border-l border-border">
                {outsideTourHours(days[i], view.hours).map(([from, to]) =>
                  to > from ? (
                    <div
                      key={from}
                      className="absolute inset-x-0 bg-muted/70"
                      style={{ top: from * HOUR_PX, height: (to - from) * HOUR_PX }}
                    />
                  ) : null,
                )}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="absolute inset-x-0 border-t border-border/60" style={{ top: hour * HOUR_PX }} />
                ))}
                {blocks.map((b) => {
                  const clickable = b.kind === "tour";
                  return (
                    <div
                      key={b.key}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      title={`${b.title}\n${b.detail}`}
                      onClick={clickable ? () => onOpenTour(b.key as Id<"tours">) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => (e.key === "Enter" || e.key === " ") && onOpenTour(b.key as Id<"tours">)
                          : undefined
                      }
                      className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight ${BLOCK_STYLES[b.kind]} ${
                        b.kind === "tour" ? "z-10 cursor-pointer font-medium hover:brightness-95" : ""
                      }`}
                      style={{
                        top: b.top,
                        height: b.height,
                        left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / b.lanes}% - 4px)`,
                      }}
                    >
                      <div className="truncate font-medium">{b.title}</div>
                      {b.height > 30 ? <div className="truncate opacity-80">{b.detail}</div> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type DayEntry = { key: string; kind: keyof typeof BLOCK_STYLES; title: string; time: string; start: number };

/** Month-at-a-glance: one row per week, each day listing its items with no hour positioning. */
function MonthGrid({
  view,
  monthKey,
  onOpenTour,
  onOpenDay,
}: {
  view: WeekView;
  monthKey: string;
  onOpenTour: (id: Id<"tours">) => void;
  onOpenDay: (day: string) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: view.rangeDays }, (_, i) => sched.addDays(view.rangeStart, i)),
    [view.rangeStart, view.rangeDays],
  );
  // Read once per mount rather than every render, which the purity rule rightly flags.
  const [now] = useState(() => Date.now());
  const today = sched.localDateKey(now, view.timeZone);

  const itemsByDay = useMemo(() => {
    const time = new Intl.DateTimeFormat("en-US", { timeZone: view.timeZone, hour: "numeric", minute: "2-digit" });
    const map = new Map<string, DayEntry[]>();
    const push = (day: string, entry: DayEntry) => {
      const list = map.get(day);
      if (list) list.push(entry);
      else map.set(day, [entry]);
    };

    view.items.forEach((item, i) => {
      if (item.kind === "allDay") {
        // An all-day item can span several days; list it on every day it covers.
        for (const day of days) {
          if (item.startDate <= day && day < item.endDate) {
            push(day, { key: `ad${i}-${day}`, kind: "event", title: item.title, time: "", start: -1 });
          }
        }
        return;
      }
      const day = sched.localDateKey(item.start, view.timeZone);
      push(day, {
        key: `i${i}`,
        kind: item.kind,
        title: item.kind === "event" ? item.title : "Busy",
        time: time.format(item.start),
        start: item.start,
      });
    });
    for (const tour of view.tours) {
      const day = sched.localDateKey(tour.start, view.timeZone);
      push(day, {
        key: tour.id,
        kind: "tour",
        title: `Tour: ${tour.callerName || "Prospective renter"}`,
        time: time.format(tour.start),
        start: tour.start,
      });
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start);
    return map;
  }, [view, days]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div key={label} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = sched.monthKeyOf(day) === monthKey;
          const dayOff = view.hours.daysOff.includes(day);
          const entries = itemsByDay.get(day) ?? [];
          const visible = entries.slice(0, MAX_VISIBLE_PER_DAY);
          const overflow = entries.length - visible.length;
          return (
            <div
              key={day}
              className={`min-h-[104px] border-r border-b border-border p-1.5 last:border-r-0 ${
                dayOff ? "bg-muted/40" : inMonth ? "" : "bg-muted/20"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <button
                  onClick={() => onOpenDay(day)}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold hover:bg-accent ${
                    day === today ? "bg-primary text-primary-foreground" : inMonth ? "" : "text-muted-foreground"
                  }`}
                >
                  {formatDate(day, { day: "numeric" })}
                </button>
                {dayOff ? (
                  <span className="truncate rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Day off
                  </span>
                ) : null}
              </div>
              <div className="space-y-1">
                {visible.map((e) => {
                  const clickable = e.kind === "tour";
                  return (
                    <div
                      key={e.key}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      title={e.time ? `${e.time} · ${e.title}` : e.title}
                      onClick={clickable ? () => onOpenTour(e.key as Id<"tours">) : undefined}
                      onKeyDown={
                        clickable
                          ? (ev) => (ev.key === "Enter" || ev.key === " ") && onOpenTour(e.key as Id<"tours">)
                          : undefined
                      }
                      className={`truncate rounded border px-1 py-0.5 text-[10.5px] leading-tight ${BLOCK_STYLES[e.kind]} ${
                        clickable ? "cursor-pointer font-medium hover:brightness-95" : ""
                      }`}
                    >
                      {e.time ? `${e.time} ` : ""}
                      {e.title}
                    </div>
                  );
                })}
                {overflow > 0 ? (
                  <button
                    onClick={() => onOpenDay(day)}
                    className="w-full truncate rounded px-1 py-0.5 text-left text-[10.5px] text-muted-foreground hover:bg-accent"
                  >
                    +{overflow} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ isSelf, showTourHours }: { isSelf: boolean; showTourHours: boolean }) {
  const items = [
    isSelf
      ? { style: BLOCK_STYLES.event, label: "Your Google Calendar events" }
      : { style: BLOCK_STYLES.busy, label: "Busy in Google Calendar" },
    { style: BLOCK_STYLES.tour, label: "Tours booked by Sarah" },
    ...(showTourHours ? [{ style: "border-border bg-muted/70", label: "Outside tour hours" }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-4">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`h-3 w-3 rounded border ${item.style}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** What a property manager needs about one booked tour: contact details and what Sarah learned. */
function TourModal({
  tourId,
  onClose,
  onCancelled,
}: {
  tourId: Id<"tours">;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const details = useQuery(api.tours.tourDetails, { tourId });
  const cancelBookedTour = useAction(api.tours.cancelBookedTour);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelBookedTour({ tourId });
      toast("Tour cancelled");
      onCancelled();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not cancel the tour.", "error");
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-details-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <h2 id="tour-details-title" className="text-lg font-bold">
            Tour details
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {details === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : details === null ? (
            <p className="text-sm text-muted-foreground">
              This tour could not be found — it may have just been cancelled or moved.
            </p>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-base font-semibold">{sched.spokenLabel(details.start, details.timeZone)}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  With {details.memberName}
                  {details.status === "cancelled" ? " · Cancelled" : ""}
                </p>
              </div>

              <div className="space-y-2.5 rounded-xl border border-border p-4">
                <div className="flex items-center gap-2.5 text-sm">
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{details.callerName || "Not given"}</span>
                </div>
                <div className="flex items-center gap-2.5 text-sm">
                  <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {details.callerPhone ? (
                    <a href={`tel:${details.callerPhone}`} className="font-medium text-primary hover:underline">
                      {details.callerPhone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Not given</span>
                  )}
                </div>
              </div>

              {details.fromCall ? (
                <div>
                  <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    What they told Sarah
                  </h3>
                  <div className="space-y-2 text-sm">
                    {details.fromCall.bedrooms ? (
                      <Row label="Looking for" value={BEDROOM_LABELS[details.fromCall.bedrooms] ?? details.fromCall.bedrooms} />
                    ) : null}
                    {details.fromCall.budget !== undefined ? (
                      <Row label="Budget" value={`${formatCurrency(details.fromCall.budget)}/mo`} />
                    ) : null}
                    {details.fromCall.moveInDate ? <Row label="Move-in" value={details.fromCall.moveInDate} /> : null}
                    {details.fromCall.petsWanted !== undefined ? (
                      <div className="flex items-center gap-2.5">
                        <PawPrint className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span>
                          {details.fromCall.petsWanted
                            ? `Has a pet${details.fromCall.petType ? ` (${details.fromCall.petType})` : ""}`
                            : "No pets"}
                        </span>
                      </div>
                    ) : null}
                    {details.fromCall.screeningAnswers.map((a) => (
                      <Row key={a.key} label={a.question} value={String(a.value)} />
                    ))}
                    {details.fromCall.qualifies !== undefined ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                          details.fromCall.qualifies
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {details.fromCall.qualifies ? "Qualified" : "Did not qualify"}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {details && details.status !== "cancelled" ? (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-6 py-4">
            {confirming ? (
              <>
                <span className="mr-auto text-sm text-muted-foreground">Cancel this tour?</span>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
                >
                  Keep it
                </button>
                <button
                  onClick={() => void handleCancel()}
                  disabled={busy}
                  className="rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40"
                >
                  {busy ? "Cancelling…" : "Yes, cancel it"}
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                <Ban className="h-4 w-4" />
                Cancel tour
              </button>
            )}
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  );
}
