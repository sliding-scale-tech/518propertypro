import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Last-resort net for conversation logging (see conversations.reconcileStaleActive): closes out
// any call still marked "active" long past when it must have actually ended, so a dropped
// connection or missed webhook never leaves a call stuck open forever.
crons.interval(
  "reconcile stale active conversations",
  { minutes: 10 },
  internal.conversations.reconcileStaleActive,
  {},
);

export default crons;
