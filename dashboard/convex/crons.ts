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

// Owner verification rows (verify_owner, B36) are only needed during and just after a call; the
// audit trail keeps the history. Drops rows older than ownerVerifyLib.VERIFICATION_RETENTION_MS.
crons.daily(
  "purge old owner verifications",
  { hourUTC: 8, minuteUTC: 15 },
  internal.ownerRouting.purgeOldVerifications,
  {},
);

// B44: lease-ended follow-ups. One task per active resident whose lease end has passed (team date)
// and who has no open follow-up yet, for the unit's asset manager; batched, and a re-run is a
// no-op. 11:30 UTC = 6:30 / 7:30 am in Albany, before the workday. Never moves anyone out.
crons.daily(
  "lease-ended follow-ups",
  { hourUTC: 11, minuteUTC: 30 },
  internal.leaseFollowUp.run,
  {},
);

export default crons;
