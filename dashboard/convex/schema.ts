import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { jobRoleValidator, notifyChannelValidator } from "./jobRoles";
import { propertyAddressValidator } from "./placesApi";
import { auditEntityValidator } from "./auditEntities";
import { sarahConfigValidator } from "./sarahConfigLib";
import {
  accountSystemKeyValidator,
  ledgerSourceValidator,
  paymentMethodValidator,
  rowTypeValidator,
  statementStatusValidator,
} from "./rosValidators";

export default defineSchema({
  // Mirrors Clerk users via the /auth webhook (user.created / session.created / user.updated).
  users: defineTable({
    clerkId: v.string(),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    lastSignInAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"]),

  // --- Teams ---------------------------------------------------------------
  //
  // Organizations live here rather than in Clerk. Clerk still owns identity — sign-in, OAuth,
  // sessions, the user webhook — but a person belongs to exactly one team in this product, and
  // Clerk Organizations is built for the opposite case: several orgs per user with switching.
  // Modelling one-of-one through it meant carrying an "active organization" on the session, a
  // choose-organization task, compact org claims in the token and ticket redemption on invite
  // links — four moving parts to express a single row.
  organizations: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    // When agents.ensure last started setting this team up (agent, property, knowledge). Sign-up
    // schedules it, and the Knowledge tab, a first call and a Settings save all call it as a
    // fallback — this is what keeps overlapping runs from each creating an ElevenLabs agent.
    bootstrapStartedAt: v.optional(v.number()),
    // IANA time zone the property's tours happen in, set by an admin on the Availability page.
    // No default on purpose: guessing one books tours at the wrong hour, so booking stays off
    // (the agent falls back to capturing a preferred time) until someone sets it.
    timeZone: v.optional(v.string()),
  }),

  // One row per person per team. The unique index is what makes "one team per person" a fact
  // about the data rather than a convention: authz.currentOrg reads a single membership and
  // there is nothing to disambiguate.
  memberships: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    // Deliberately a plain union and not a Clerk permission catalog — the finer-grained limits
    // discussed for later are a change to this column, not a new authorization system.
    role: v.union(v.literal("admin"), v.literal("member")),
    // What the person does for the business (PRD §4), separate from `role` above, which is only
    // team administration. A person can hold several (Pat may also be an asset manager). All
    // optional so rows written before job roles existed stay valid; absent reads as none.
    jobRoles: v.optional(v.array(jobRoleValidator)),
    phone: v.optional(v.string()), // E.164, for SMS
    notifyBy: v.optional(v.array(notifyChannelValidator)),
    unavailableUntil: v.optional(v.number()), // out-of-office flag for AM fallback
    // Admin-entered profile extras (Asset Managers profile). The work email is the Clerk sign-in
    // identity and is never editable here; these are contact/notes only.
    personalEmail: v.optional(v.string()),
    internalNotes: v.optional(v.string()), // admin-only, never shown to the member
    // Where Sarah tells tenants to email photos/video of a repair, for units this person is the
    // asset manager of. May be a shared team inbox (Gold: goldteam@…). Lowercased and checked as
    // speakable on save (sarahReplies.speakablePhotoEmail); absent = Sarah gives no address and
    // says the asset manager will follow up. Seeded by photoEmails.seedDefaults.
    photoEmail: v.optional(v.string()),
    // The asset manager who gets READ access to this person's units while they are out of
    // office (see amScope.ts). Cleared together with unavailableUntil.
    coveringUserId: v.optional(v.id("users")),
    // Free-text speciality shown as the subtitle on Team and the dashboard, and matched against
    // the issue type when suggesting a technician (workOrders.suggestTechnician).
    skill: v.optional(v.string()),
    // Admin-chosen: receives new leasing leads and is the ONLY pool tours are booked from (also
    // needs the asset_manager job role, a connected calendar, tours on, and not out of office).
    leadAssignee: v.optional(v.boolean()),
    // Admin-chosen: receives callback contacts for callers Sarah could not match to a unit.
    unmatchedAssignee: v.optional(v.boolean()),
    // Round-robin tie-breakers: when this person was last handed a lead / unmatched caller.
    lastLeadAssignedAt: v.optional(v.number()),
    lastUnmatchedAssignedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"]),

  // Pending invitations.
  //
  // Only a SHA-256 of the token is stored. The raw token exists in the invite email and in the
  // invitee's URL, never at rest here, so a leak of this table cannot be replayed into
  // somebody's team. Expiry and single-use (acceptedAt/revokedAt) are enforced on redemption.
  invites: defineTable({
    orgId: v.id("organizations"),
    email: v.string(), // always lowercased, so lookups cannot miss on casing
    role: v.union(v.literal("admin"), v.literal("member")),
    // Copied onto the membership when the invite is redeemed.
    jobRoles: v.optional(v.array(jobRoleValidator)),
    phone: v.optional(v.string()),
    // Display name typed on the Asset Managers invite form. Not an identity: the real name
    // comes from Clerk once the invitee signs up.
    fullName: v.optional(v.string()),
    tokenHash: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_org", ["orgId"])
    .index("by_email", ["email"]),

  // --- Google Calendar -------------------------------------------------------
  //
  // One connection per person, not per team: tours go into the calendar of whoever gives them.
  // Deliberately no orgId — which team someone is on is read from memberships at booking time,
  // so removing a member from a team cannot leave their calendar attached to it.
  googleCalendarConnections: defineTable({
    userId: v.id("users"),
    googleEmail: v.string(),
    // Both tokens are AES-GCM ciphertext (googleApi.encryptToken), never the raw token. The
    // key lives only in the deployment's environment.
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    connectedAt: v.number(),
    updatedAt: v.number(),
    // Set when Google rejects the refresh token (revoked, or a Testing-mode app's 7-day expiry).
    // Kept rather than deleted so the page can ask them to reconnect.
    invalidAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // In-flight OAuth attempts. Only a SHA-256 of the state is stored, for the same reason as
  // invites.tokenHash; a row is deleted the moment Google redirects back with it.
  googleOAuthStates: defineTable({
    stateHash: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  })
    .index("by_state_hash", ["stateHash"])
    .index("by_user", ["userId"]),

  // Throttle for assetManagers.sendPasswordReset: one row per email sent, so "max 3 per target
  // per day" is a count over the last 24h. Holds no secret and no token.
  passwordResetRequests: defineTable({
    orgId: v.string(),
    targetUserId: v.id("users"),
    requestedBy: v.id("users"),
    at: v.number(),
  })
    .index("by_target_and_at", ["targetUserId", "at"])
    .index("by_org", ["orgId"]),

  // Each person's own tour hours. No row means the defaults in tourSchedule.ts (available,
  // Monday to Friday 9 to 5), so a new teammate is bookable the moment their calendar connects.
  tourAvailability: defineTable({
    userId: v.id("users"),
    availableForTours: v.boolean(),
    // day: 0 = Sunday … 6 = Saturday; start/end "HH:MM" in the team's time zone. A day that
    // is not listed is a day off.
    weeklyHours: v.array(v.object({ day: v.number(), start: v.string(), end: v.string() })),
    // Specific dates ("YYYY-MM-DD", team-local) this person is off — a one-off exception on top
    // of weeklyHours, for things a recurring schedule can't express (a holiday, an appointment).
    // Sarah skips these days entirely regardless of weeklyHours. Kept as a plain array: a person
    // has at most a handful of these upcoming at once, never enough to need its own table.
    daysOff: v.optional(v.array(v.string())),
    // When they last saved their own hours. Separate from the row existing, because an admin
    // switching someone's tours off creates the row too — and that person should still be asked
    // for their hours the first time they open the Calendar page.
    hoursSavedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // The times find_tour_times last gave the agent on one call. request_tour may only book one of
  // these: a small model on a phone call will otherwise book a slot from an earlier list after the
  // caller has asked for something else (a caller asked for 9am and was booked at 2pm).
  tourTimeChecks: defineTable({
    elevenLabsConversationId: v.string(),
    starts: v.array(v.string()), // "YYYY-MM-DDTHH:MM", as returned to the agent
    updatedAt: v.number(),
  })
    .index("by_conversation", ["elevenLabsConversationId"])
    .index("by_updated", ["updatedAt"]),

  // Tours Sarah booked into someone's calendar.
  tours: defineTable({
    orgId: v.string(), // same string form as the other per-team tables, for deleteOrgRows
    assignedUserId: v.id("users"),
    start: v.number(), // epoch ms; the event itself, not including the buffer
    end: v.number(),
    timeZone: v.string(), // the team's zone when booked, so the time reads right if it changes
    status: v.union(v.literal("booked"), v.literal("cancelled")),
    // Absent only for the instant between reserving the slot and Google creating the event.
    googleEventId: v.optional(v.string()),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    elevenLabsConversationId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_start", ["orgId", "start"])
    .index("by_assignee_and_start", ["assignedUserId", "start"])
    .index("by_conversation", ["elevenLabsConversationId"]),

  agents: defineTable({
    // The Clerk organization this row belongs to. Every dashboard table is keyed by org rather
    // than by user: a team shares one agent, one property, one knowledge base and one lead
    // list, so ownership has to sit on the team, not on whoever happened to create it.
    //
    // Required: every row is backfilled and every insert path stamps it.
    orgId: v.string(),
    // Kept alongside orgId as "who created this", not as an access key. Nothing scopes on it
    // any more — see convex/authz.ts.
    userId: v.id("users"),
    elevenLabsAgentId: v.string(),
    name: v.string(),
    prompt: v.string(),
    firstMessage: v.string(),
    voiceId: v.string(),
    // Set by agents.createDedicatedAgent: the ElevenLabs agent this row pointed at before it was
    // re-created. Kept for reference/rollback only; nothing resolves an org from it.
    previousElevenLabsAgentId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_elevenlabs_id", ["elevenLabsAgentId"])
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"]),

  conversations: defineTable({
    // Absent for the public landing-page demo (never signed in) and, briefly, for a phone
    // call before the post-call webhook resolves and backfills it — see ingestFromWebhook.
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.string()),
    agentId: v.id("agents"),
    elevenLabsConversationId: v.optional(v.string()),
    channel: v.union(v.literal("browser"), v.literal("phone")),
    callerNumber: v.optional(v.string()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("ended"),
      v.literal("failed"),
    ),
    intent: v.optional(
      v.union(
        v.literal("leasing"),
        v.literal("maintenance"),
        v.literal("escalation"),
        v.literal("unclear"),
      ),
    ),
    outcome: v.optional(
      v.union(
        v.literal("tour_booked"),
        v.literal("disqualified"),
        v.literal("escalated"),
        v.literal("logged_only"),
      ),
    ),
    escalatedTo: v.optional(v.string()),
    summary: v.optional(v.string()),
    // Follow-up queue (failed or unclear calls nobody has called back yet). Set by
    // conversations.markFollowedUp; absent means nobody has dealt with it.
    followedUpAt: v.optional(v.number()),
    followedUpBy: v.optional(v.id("users")),
  })
    .index("by_agent", ["agentId"])
    .index("by_started", ["startedAt"])
    // Powers the Leads page: one signed-in user's calls, newest first, without scanning
    // every other user's rows to find them.
    .index("by_user_and_started", ["userId", "startedAt"])
    .index("by_org_and_started", ["orgId", "startedAt"])
    .index("by_elevenlabs_conversation_id", ["elevenLabsConversationId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("agent")),
    text: v.string(),
    // The SDK emits tentative transcripts that are later superseded. Tentative rows are
    // overwritten in place rather than appended, otherwise the transcript stutters.
    isFinal: v.boolean(),
    at: v.number(),
  }).index("by_conversation", ["conversationId"]),

  docs: defineTable({
    // Required: every row is backfilled (orgMigration.backfill) and every insert path stamps
    // it, so allowing undefined here would only reintroduce a "which rows are unowned?" branch
    // that no longer has a real case behind it.
    orgId: v.string(),
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    kbDocumentId: v.optional(v.string()),
    ragIndexId: v.optional(v.string()),
    syncState: v.union(
      v.literal("pending"),
      v.literal("indexing"),
      v.literal("synced"),
      v.literal("failed"),
    ),
    syncError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_sync_state", ["syncState"])
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"]),

  // Team to-dos on the Tasks tab. Grouped in the UI by `status`; `order` is not tracked since
  // the page doesn't support drag reordering.
  tasks: defineTable({
    // Required, same reasoning as docs/properties/screeningQuestions above: every insert path
    // stamps it, so there is no "unowned row" case to make optional for.
    orgId: v.string(),
    userId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("completed")),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    // Free text rather than a union: this mirrors tenantIssues.category above — a label like
    // "Leasing" or "HR" is just a display tag, not something the app branches logic on.
    category: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    // Task as follow-up work: who owns it and which record it is about. All optional so tasks
    // created before maintenance existed stay valid. Links are verified against the creator's
    // org on write, never trusted from the client.
    assigneeUserId: v.optional(v.id("users")),
    unitId: v.optional(v.id("units")),
    requestId: v.optional(v.id("maintenanceRequests")),
    workOrderId: v.optional(v.id("workOrders")),
    // Set when Sarah created the task from a resident call (log_task_request); upsert key.
    elevenLabsConversationId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_assignee", ["assigneeUserId"])
    .index("by_conversation", ["elevenLabsConversationId"]),

  // Files attached to a task from the Create task modal or the detail panel's Attach files
  // button. `taskId` is optional because the create modal uploads to storage (so the file picks
  // up an id immediately) before the task itself exists — tasks.create attaches these rows to
  // the new task right after inserting it, the same two-step shape docs.ts uses for uploads.
  taskAttachments: defineTable({
    taskId: v.optional(v.id("tasks")),
    orgId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    uploadedByUserId: v.id("users"),
    // Denormalized like screeningQuestions.question: the uploader's name at the time they
    // uploaded it, so a later name change doesn't rewrite history.
    uploadedByName: v.string(),
    createdAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_org", ["orgId"]),

  usage: defineTable({
    monthKey: v.string(), // "2026-07"
    secondsUsed: v.number(),
  }).index("by_month", ["monthKey"]),

  // One thread per (channel, customer phone) pair — the same person texting and WhatsApp-ing
  // are two separate threads. "bot" means the bot auto-replies; "escalated" means a human has
  // taken over and the bot stops replying until the thread is handed back.
  threads: defineTable({
    channel: v.union(v.literal("sms"), v.literal("whatsapp")),
    customerPhone: v.string(),
    status: v.union(v.literal("bot"), v.literal("escalated")),
    escalationReason: v.optional(v.string()),
    lastMessageAt: v.number(),
    // Owning team. Optional only for rows predating it; threads without one are hidden from the
    // inbox until threads.backfillOrgId runs.
    orgId: v.optional(v.id("organizations")),
  })
    .index("by_channel_and_phone", ["channel", "customerPhone"])
    .index("by_org_and_last_message", ["orgId", "lastMessageAt"]),

  // DEPRECATED: no longer written to (raw post-call payloads contained PII). Kept so existing
  // rows still validate; delete the table once its data has been cleared.
  debugWebhookLogs: defineTable({
    body: v.string(),
    at: v.number(),
  }),

  smsMessages: defineTable({
    threadId: v.id("threads"),
    sender: v.union(v.literal("customer"), v.literal("bot"), v.literal("staff")),
    text: v.string(),
    at: v.number(),
    twilioSid: v.optional(v.string()), // dedupes Twilio's occasional webhook retries
  }).index("by_thread", ["threadId"]),

  // SINGLE-TENANT ROW: no orgId, one row for the whole deployment (read with .first()). The
  // forwarding fields below inherit that assumption; add an orgId + index before a second
  // customer shares this deployment.
  orgSettings: defineTable({
    staffPhoneNumber: v.string(),
    // Optional "Business line forwarding" (convex/orgSettings.ts). The customer's own office
    // number that they forward to our Twilio number at THEIR carrier; nothing here sets
    // forwarding anywhere. Not part of the Sarah draft/publish flow.
    forwardingNumber: v.optional(v.string()), // E.164
    forwardingLineType: v.optional(
      v.union(
        v.literal("verizon_mobile"),
        v.literal("other_mobile"),
        v.literal("landline_office"),
        v.literal("phone_system"),
        v.literal("unknown"),
      ),
    ),
    forwardingSetUpAt: v.optional(v.number()), // number saved
    forwardingConfirmedAt: v.optional(v.number()), // admin said "I've set it up"
    forwardingLastSeenAt: v.optional(v.number()), // start of the latest phone call Sarah took
    forwardingLastSeenFrom: v.optional(v.string()), // last 4 digits of that caller ONLY
  }),

  properties: defineTable({
    // Required: every row is backfilled (orgMigration.backfill) and every insert path stamps
    // it, so allowing undefined here would only reintroduce a "which rows are unowned?" branch
    // that no longer has a real case behind it.
    orgId: v.string(),
    userId: v.id("users"),
    name: v.string(),
    units: v.array(
      v.object({
        bedrooms: v.string(), // "studio" | "1br" | "2br" | "3br+"
        rentMin: v.number(),
        rentMax: v.number(),
        available: v.boolean(),
      }),
    ),
    // Optional since the roster import (B2): the client rosters say nothing about pets or a
    // move-in window, so an imported building leaves both unset rather than carrying a made-up
    // default. Absent means "not provided": every reader (Sarah's tools, the SMS/WhatsApp bots,
    // the KB doc) must then state no policy, and qualification never fails on an unset value.
    petsAllowed: v.optional(v.boolean()),
    moveInWindowDays: v.optional(v.number()),
    // Picked from Google Places on the Property page. Becomes the location of every tour event
    // and what Sarah tells a renter when she books. Never cloned from the template: it is one
    // specific building, not a sensible default for someone else's.
    address: v.optional(propertyAddressValidator),
    // Multi-property: a team can now hold several rows here. `properties.current` (Sarah's
    // tools) still returns the oldest one, so adding buildings never changes what she reads.
    isPilot: v.optional(v.boolean()), // pilot buildings get maintenance intake first
    utilityGasPhone: v.optional(v.string()), // E.164, the gas company's emergency line
    // Default asset manager: prefills new units and can be bulk-applied to units without an
    // override. Units still store their own AM (units.ts is the only writer of that column).
    defaultAssetManagerUserId: v.optional(v.id("users")),
    // Display only (Property page, owner statements later).
    ownerName: v.optional(v.string()),
    // The first of ownerEmails when the roster gives several; existing readers keep using it.
    ownerEmail: v.optional(v.string()),
    // Every owner email, trimmed, lowercased and validated (roster "Owners Email Address", two
    // owners in one cell split on ", "). Lowercase so a later "is this caller an owner?" lookup
    // can compare an email spoken on a call against EITHER address with a plain equality check.
    // Convex can't index array members; a lookup reads the org's properties via by_org (a few
    // hundred rows) and checks `ownerEmails.includes(email.toLowerCase())`.
    ownerEmails: v.optional(v.array(v.string())),
    // --- Roster fields (B2, docs/rosters/unit-fields-spec.md). All optional: buildings created
    // by hand have none of them. Written by convex/rosterImport.ts.
    // Which client roster / team the building is on.
    category: v.optional(v.union(v.literal("gold"), v.literal("silver"), v.literal("make_up"))),
    // Owned by the company's owners ("Delia - Rentals") or managed for other owners (Gold,
    // Silver, "Delia Management Properties"); client answer 2026-10-30.
    ownership: v.optional(v.union(v.literal("company_owned"), v.literal("managed"))),
    // The roster marks the building "selling" (Gold only so far). Absent = not stated.
    selling: v.optional(v.boolean()),
    // City as the roster / asset manager gave it, spelling kept. Also inside address.formatted.
    city: v.optional(v.string()),
    // Make Up page title ("Delia - Rentals" / "Delia Management Properties"), verbatim.
    sourceSection: v.optional(v.string()),
    // The asset manager the client named for this building, by name, while that person has no
    // account yet (Silver = Nikki, Make Up = Delia). defaultAssetManagerUserId holds who is assigned today; this
    // is what lets the units be bulk-moved to the right person once they join.
    intendedAssetManagerName: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_and_category", ["orgId", "category"]),

  // Feedback from the landing page's "Try yourself" demo only — never from the dashboard's
  // own /call, where a customer testing their own agent has no reason to rate it.
  //
  // Written in two steps so a rating is never lost to someone abandoning the email prompt:
  // ratings.submit inserts the star rating alone, ratings.attachEmail later patches an email
  // onto that same row if and only if they go on to give one — which also triggers sending
  // the transcript to it (convex/transcriptEmail.ts).
  callRatings: defineTable({
    // sessionStorage-scoped, not a signed-in identity: ties a rating back to one browser tab
    // for this visit only, so a second "try" in the same tab can be told apart from a
    // stranger's first one.
    sessionId: v.string(),
    conversationId: v.optional(v.id("conversations")),
    rating: v.number(), // 1-5
    email: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_conversation", ["conversationId"]),

  // Keyed by the ElevenLabs conversation id, not a Convex conversations._id: phone calls have
  // no browser to create a conversations row up front, so tool calls write here first and the
  // post-call webhook links this row to conversations once the call ends.
  qualifications: defineTable({
    elevenLabsConversationId: v.string(),
    conversationId: v.optional(v.id("conversations")),
    bedrooms: v.optional(v.string()),
    moveInDate: v.optional(v.string()),
    budget: v.optional(v.number()),
    petsWanted: v.optional(v.boolean()),
    petType: v.optional(v.string()),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    // The city or area they want to rent in, in their own words ("albany ny", "anywhere"), and the
    // cities in the team's data it matched (labels as stored; empty for no preference or an area
    // we have no building in). Set by log_lead.
    preferredArea: v.optional(v.string()),
    preferredCities: v.optional(v.array(v.string())),
    qualifies: v.optional(v.boolean()),
    disqualifyReason: v.optional(v.string()),
    // Set alongside a false qualifies when the miss was small (see qualifyRules.NEAR_MISS_BAND)
    // — Sarah is told to mention this lead to the team for a possible follow-up rather than
    // treating it as a flat no. Never changes the qualifies decision itself.
    nearMiss: v.optional(v.boolean()),
    tourSlot: v.optional(v.string()),
    tourConfirmed: v.boolean(),

    // Lead routing (leads.ts). Kept here rather than on conversations because a phone call has
    // no conversations row until it ends, while this row exists from the first tool call.
    callerEmail: v.optional(v.string()),
    assignedUserId: v.optional(v.id("users")),
    assignedAt: v.optional(v.number()),
    assignmentReason: v.optional(v.string()),
    leadNotifiedAt: v.optional(v.number()), // staff were texted about this lead
    // Capture-and-flag: staff-facing only, NEVER relayed to the caller.
    leadClass: v.optional(v.string()), // "ready" | "partial"
    leadFlags: v.optional(v.array(v.string())),

    // Set by route_owner_prospect: someone who owns property and wants 518 to manage it, not a
    // renter. Lives on the call's qualifications row because that is the one per-call capture
    // record the lead/call views already join to.
    ownerProspect: v.optional(
      v.object({
        name: v.string(),
        phone: v.string(),
        email: v.optional(v.string()),
        propertyAddress: v.optional(v.string()),
        propertyDetails: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),

    // Answers to the property manager's own pre-screening questions (see screeningQuestions).
    // `question` is denormalized on purpose: a manager who later rewrites or deletes a
    // question must not retroactively change what an old lead is recorded as having answered.
    screeningAnswers: v.optional(
      v.array(
        v.object({
          key: v.string(),
          question: v.string(),
          value: v.union(v.string(), v.number(), v.boolean()),
        }),
      ),
    ),
    updatedAt: v.number(),
  }).index("by_elevenlabs_conversation_id", ["elevenLabsConversationId"]),

  // Extra questions this property manager wants Sarah to ask every leasing caller, on top of
  // the five that are built in. Data, not prompt text: `key` becomes a property on that
  // manager's own check_qualification tool schema, so the model normalizes the spoken answer
  // into a real boolean/number/string exactly the way it already does for pets_wanted.
  //
  // `criterion` absent means capture-only — the answer is recorded on the lead and can never
  // affect qualification. Present means evaluateQualification applies it as a real rule. That
  // toggle is per question, deliberately: most managers want a mix of both.
  screeningQuestions: defineTable({
    // Required: every row is backfilled (orgMigration.backfill) and every insert path stamps
    // it, so allowing undefined here would only reintroduce a "which rows are unowned?" branch
    // that no longer has a real case behind it.
    orgId: v.string(),
    userId: v.id("users"),
    // Stable snake_case identifier, generated once at creation and never rewritten. It is the
    // tool-schema property name AND the join key on qualifications.screeningAnswers, so
    // editing a question's wording must not change it or old answers orphan themselves.
    key: v.string(),
    question: v.string(),
    answerKind: v.union(
      v.literal("yes_no"),
      v.literal("number"),
      v.literal("choice"),
      v.literal("text"),
    ),
    // Only meaningful for answerKind "choice".
    choices: v.optional(v.array(v.string())),
    // "text" answers can never carry a criterion — free prose is not something a pure
    // function can judge, and qualification must stay a code decision. Enforced in
    // screening.save, not just here.
    criterion: v.optional(
      v.union(
        v.object({ kind: v.literal("yes_no"), mustBe: v.boolean() }),
        v.object({
          kind: v.literal("number"),
          op: v.union(v.literal("gte"), v.literal("lte")),
          value: v.number(),
        }),
        v.object({ kind: v.literal("choice"), allowed: v.array(v.string()) }),
      ),
    ),
    order: v.number(),
    enabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"]),

  // Which of the five built-in questions this manager has switched off. One row per user,
  // holding only the exceptions — no row, or an empty array, means all five are asked, so a
  // fresh account behaves exactly as it did before any of this existed.
  //
  // Only the keys listed in coreQuestions.DISABLEABLE_KEYS can appear here. `bedrooms` and
  // `contact` are structural and are filtered out on write; see convex/coreQuestions.ts.
  screeningBuiltins: defineTable({
    // Required: every row is backfilled (orgMigration.backfill) and every insert path stamps
    // it, so allowing undefined here would only reintroduce a "which rows are unowned?" branch
    // that no longer has a real case behind it.
    orgId: v.string(),
    userId: v.id("users"),
    disabled: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"]),

  // Keyed by the ElevenLabs conversation id for the same reason as qualifications above.
  //
  // `category` is deliberately v.string() and not a union: the agent fills it freehand, and a
  // single off-script value ("plumbing" instead of "maintenance") against a union would throw
  // inside the mutation, fail the tool call, and leave Sarah telling the caller that something
  // broke mid-call. Normalize for display, store what was said.
  tenantIssues: defineTable({
    // Resolved from the call's conversations row where possible (see tenants.logIssue) and
    // backfilled at webhook time otherwise — same story as conversations.userId above. The
    // Tenants page reads this table directly rather than through a conversation, so unlike
    // qualifications (access-controlled via its parent conversation) this needs its own
    // indexed column to scope the list itself.
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.string()),
    elevenLabsConversationId: v.string(),
    conversationId: v.optional(v.id("conversations")),

    callerName: v.optional(v.string()),
    unit: v.optional(v.string()),
    // Two different facts, kept apart on purpose. callerNumber is where the call came FROM
    // (telephony caller ID, automatic, always correct). callbackNumber is what the resident
    // asked us to reach them on, spoken aloud — more intentional, but transcribed digits get
    // misheard, so it must never overwrite the one we know is right.
    callerNumber: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),

    reason: v.string(),
    category: v.optional(v.string()),
    severity: v.number(), // 1-10, clamped server-side by clampSeverity
    severityReason: v.optional(v.string()),
    // What kind of non-maintenance resident call this was (rent, portal_login, application, ...).
    // A free string on purpose: the allowed set lives in http.ts, so a new call type needs no migration.
    callType: v.optional(v.string()),
    // Set the first time staff overrides the score, so the agent's original call is never lost.
    originalSeverity: v.optional(v.number()),
    status: v.union(v.literal("open"), v.literal("resolved")),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_elevenlabs_conversation_id", ["elevenLabsConversationId"])
    .index("by_created", ["createdAt"])
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"]),

  // --- WhatsApp automation ------------------------------------------------
  //
  // Deliberately a self-contained island. Nothing here references conversations,
  // qualifications, tenantIssues, threads or smsMessages, and nothing there references this.
  // The voice agent (ElevenLabs) and the SMS bot (Twilio) keep working exactly as they did
  // even if WhatsApp is switched off entirely.
  //
  // The only things shared are read-only business data both channels need: the `docs`
  // knowledge base and the `properties` row.

  // Singleton — the editable WhatsApp system prompt. Kept in its own table rather than in
  // orgSettings so the WhatsApp feature stays a self-contained island: nothing outside these
  // wa* tables has to know it exists. Empty/missing means "use the default from
  // convex/waPrompt.ts", so a fresh install works before anyone visits Settings.
  waConfig: defineTable({
    systemPrompt: v.string(),
    updatedAt: v.number(),
  }),

  // Singleton — one connected WhatsApp number for the property. Mirrors WAHA's own session
  // state rather than owning it: WAHA is the source of truth, this is the last thing we saw
  // so the page can render without a round trip on every load.
  waSession: defineTable({
    sessionName: v.string(),
    status: v.string(), // raw WAHA status: STARTING | SCAN_QR_CODE | WORKING | FAILED | STOPPED
    phoneNumber: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }),

  // One thread per WhatsApp chat.
  //
  // chatId is bare phone digits, OR a full JID like "123@lid" when WhatsApp gave us a LID
  // identifier we could not resolve to a real number. Storing the full JID in that case is
  // deliberate: a bare LID with "@c.us" appended is undeliverable, so replies would silently
  // vanish. See infra/waha/README.md.
  waThreads: defineTable({
    chatId: v.string(),
    displayName: v.string(),
    status: v.union(v.literal("bot"), v.literal("escalated"), v.literal("closed")),
    escalationReason: v.optional(v.string()),
    unreadCount: v.number(),
    lastMessageAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_chat_id", ["chatId"])
    .index("by_last_message", ["lastMessageAt"]),

  waMessages: defineTable({
    threadId: v.id("waThreads"),
    sender: v.union(v.literal("customer"), v.literal("bot"), v.literal("staff")),
    text: v.string(),
    at: v.number(),
    deliveryStatus: v.optional(v.union(v.literal("sent"), v.literal("failed"))),
  }).index("by_thread", ["threadId"]),

  // What the bot captured from a leasing conversation. Same five fields the voice agent
  // gathers, but stored separately and shown only on the WhatsApp page.
  waLeads: defineTable({
    threadId: v.id("waThreads"),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    bedrooms: v.optional(v.string()),
    moveInDate: v.optional(v.string()),
    budget: v.optional(v.number()),
    petsWanted: v.optional(v.boolean()),
    petType: v.optional(v.string()),
    qualifies: v.optional(v.boolean()),
    disqualifyReason: v.optional(v.string()),
    tourSlot: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_thread", ["threadId"]),

  // Resident maintenance reported over WhatsApp. Same 1-10 severity rubric the voice agent
  // uses (convex/severity.ts) so a 7 means the same thing on both channels.
  waIssues: defineTable({
    threadId: v.id("waThreads"),
    callerName: v.optional(v.string()),
    unit: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    reason: v.string(),
    category: v.optional(v.string()),
    severity: v.number(),
    severityReason: v.optional(v.string()),
    originalSeverity: v.optional(v.number()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_created", ["createdAt"]),

  // One row per rentable unit. Separate from the `properties.units` array (unit *types* Sarah
  // quotes from), which stays as is.
  //
  // assetManagerUserId is required, not optional: every unit has exactly one designated asset
  // manager, because maintenance intake routes to that person and a unit without one would have
  // requests nobody owns. Making it a required field turns the rule into a fact about the data.
  // All writes must go through convex/units.ts, the only module that inserts or patches this
  // table; it validates the AM and audits changes. Never ctx.db.insert("units") anywhere else.
  units: defineTable({
    orgId: v.string(),
    propertyId: v.id("properties"),
    unitNumber: v.string(),
    unitNumberKey: v.string(), // normalizeUnitKey(unitNumber), for matching what callers say
    floor: v.optional(v.number()),
    isTopFloor: v.optional(v.boolean()), // drives the roof/leak script
    // "studio" | "1br" | "2br" | "3br+" (what Sarah's bedrooms filter matches), plus two values
    // the roster import writes: "-" when the roster gives no bedroom count (commercial, garage,
    // office) and "room" for a unit rented as one room of a shared apartment (rentedAs below).
    bedrooms: v.string(),
    bathrooms: v.optional(v.number()),
    parking: v.optional(v.string()),
    rent: v.optional(v.number()), // dollars a month; absent when not stated, never 0
    available: v.boolean(), // Sarah offers ONLY when true
    availableFrom: v.optional(v.string()),
    leasingFacts: v.optional(v.string()),
    assetManagerUserId: v.id("users"),
    maintenanceIntakeActive: v.boolean(),
    // --- Roster fields (B2, docs/rosters/unit-fields-spec.md). All optional so units entered by
    // hand stay valid; absent = "-" (not stated in the roster). Written by convex/rosterImport.ts
    // through units.upsertRosterUnit.
    unitType: v.optional(
      v.union(
        v.literal("residential"),
        v.literal("commercial"),
        v.literal("storefront"),
        v.literal("garage"),
        v.literal("office"),
        v.literal("other"),
        v.literal("unknown"),
      ),
    ),
    // Text floor label when the roster's floor is not a plain number: "Basement" (stored with
    // floor = 0, so it sorts below the first floor and is never a top floor) or anything else
    // ("Carriage house", stored with no floor number).
    floorRaw: v.optional(v.string()),
    // Numeric bedroom count (0 = studio). On a unit rented as a room it is the bedroom count of
    // the shared apartment the room is in, not of the room.
    bedroomsCount: v.optional(v.number()),
    // "room" = one room of a shared apartment, rented on its own (687 State Street B1-B4).
    // Absent = the whole unit.
    rentedAs: v.optional(v.literal("room")),
    occupancy: v.optional(
      v.union(
        v.literal("occupied"),
        v.literal("occupied_leaving"),
        v.literal("vacant"),
        v.literal("vacant_not_ready"),
      ),
    ),
    // At-will was merged into month-to-month (client, 2026-10-30), so there is no at_will value.
    leaseType: v.optional(
      v.union(v.literal("fixed"), v.literal("month_to_month"), v.literal("vacant"), v.literal("unknown")),
    ),
    leaseEnd: v.optional(v.string()), // YYYY-MM-DD, the roster's lease end for the unit
    rentPaidTo: v.optional(
      v.union(v.literal("company"), v.literal("owner_direct"), v.literal("included_in_other_unit")),
    ),
    heatingFuel: v.optional(v.union(v.literal("gas"), v.literal("electric"), v.literal("both"))),
    gasPaidBy: v.optional(v.union(v.literal("tenant"), v.literal("landlord"))),
    electricPaidBy: v.optional(v.union(v.literal("tenant"), v.literal("landlord"))),
    laundry: v.optional(
      v.union(
        v.literal("none"),
        v.literal("shared_building"),
        v.literal("hookups"),
        v.literal("provided"),
        v.literal("unknown"),
      ),
    ),
    // Rental Owner Statement: the security deposit currently held for this unit, integer cents >= 0.
    // undefined = not recorded (counts as 0 with a warning). docs/specs/ros-build-spec.md 3.9.
    securityDepositHeldCents: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_property", ["propertyId"])
    .index("by_property_and_unit_key", ["propertyId", "unitNumberKey"])
    .index("by_asset_manager", ["assetManagerUserId"])
    .index("by_org_and_asset_manager", ["orgId", "assetManagerUserId"]),

  // Append-only history, written in the same mutation as the change it describes so a change
  // never exists without its trail. convex/audit.ts exports no update or delete.
  auditEvents: defineTable({
    orgId: v.string(),
    entity: auditEntityValidator,
    entityId: v.string(),
    action: v.string(), // "am_changed", "unit_created", "job_roles_set", ...
    actorUserId: v.optional(v.id("users")), // absent = Sarah/system
    actorLabel: v.string(), // the person's name at that time, or "System"
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_entity", ["entity", "entityId", "at"])
    .index("by_org_and_at", ["orgId", "at"]),

  // --- Residents (F3) --------------------------------------------------------
  //
  // The tenant directory Sarah's caller-ID match runs against. One person, one unit; roommates
  // are separate rows that may share a phone, which is why lookup yields a list, not a row.
  residents: defineTable({
    orgId: v.string(),
    unitId: v.id("units"),
    fullName: v.string(),
    phones: v.array(v.string()), // E.164. Source of truth; residentPhones mirrors it for lookup.
    email: v.optional(v.string()),
    leaseEnd: v.optional(v.string()), // YYYY-MM-DD
    active: v.boolean(), // false = moved out / removed. Never hard-deleted, history points at it.
    // roster_import = a tenant name from the client unit rosters (names only, no phones).
    source: v.union(v.literal("manual"), v.literal("buildium_csv"), v.literal("roster_import")),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_unit", ["unitId"])
    .index("by_org_and_email", ["orgId", "email"]),

  // Import provenance for the client unit rosters (docs/rosters/518-unit-rosters-normalized.xlsx):
  // one row per roster row, so every imported value can be traced back to the sheet. Holds every
  // "Source: ..." cell verbatim (absent = empty cell), Notes and the manager's feedback. Never
  // holds "Please check", "Correct? (Y/N)" or "Corrections" (review workflow only). The importer
  // keys on (orgId, category, rowId), which is what makes a re-run update instead of duplicate.
  unitSourceRows: defineTable({
    orgId: v.string(),
    category: v.union(v.literal("gold"), v.literal("silver"), v.literal("make_up")),
    rowId: v.string(), // "S-001": our row number in the roster, not a business key
    page: v.number(), // Source: Page
    propertyId: v.id("properties"),
    unitId: v.id("units"),
    // The sheet's Property / Unit / Asset manager / Notes cells at import time.
    property: v.string(),
    unit: v.string(),
    assetManager: v.string(),
    notes: v.optional(v.string()),
    sourceUnit: v.optional(v.string()),
    sourceCom: v.optional(v.string()), // Source: COM (unlabeled column)
    sourceFloor: v.optional(v.string()),
    sourceTenants: v.optional(v.string()),
    sourceLeaseEnd: v.optional(v.string()), // Source: Lease End/Exp
    sourceBedBath: v.optional(v.string()),
    sourceRent: v.optional(v.string()),
    sourceGeTl: v.optional(v.string()), // Source: G/E & T/L
    sourceLmat: v.optional(v.string()),
    sourceLaundry: v.optional(v.string()),
    sourceGasPaid: v.optional(v.string()),
    sourceElectricPaid: v.optional(v.string()),
    sourceGasElectric: v.optional(v.string()),
    sourceWho: v.optional(v.string()),
    sourceWd: v.optional(v.string()), // Source: W/D
    sourcePropertyHeading: v.optional(v.string()),
    sourceLayoutNotes: v.optional(v.string()),
    sourceSection: v.optional(v.string()),
    managerFeedback: v.optional(v.string()), // Source: Manager feedback, word for word
    updatedAt: v.number(),
  })
    .index("by_org_category_row", ["orgId", "category", "rowId"])
    .index("by_unit", ["unitId"])
    .index("by_property", ["propertyId"]),

  // Convex cannot index the elements of an array, so each phone gets its own row. Caller ID ->
  // resident is then one indexed read. Rows exist only for ACTIVE residents (removed on
  // deactivate), so a moved-out tenant's number never routes a call to their old unit.
  residentPhones: defineTable({
    orgId: v.string(),
    residentId: v.id("residents"),
    phone: v.string(),
  })
    .index("by_org_and_phone", ["orgId", "phone"])
    .index("by_resident", ["residentId"]),

  // --- Maintenance requests (F4) ---------------------------------------------
  //
  // The intake record, deliberately separate from a work order: no work order exists until a
  // human decides one should (PRD 6.3).
  maintenanceRequests: defineTable({
    orgId: v.string(),
    number: v.number(), // MR-1042, from orgCounters
    source: v.union(v.literal("phone"), v.literal("manual")),
    elevenLabsConversationId: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),

    // Caller and location
    callerName: v.optional(v.string()),
    callerNumber: v.optional(v.string()), // telephony caller ID (trusted)
    callbackNumber: v.optional(v.string()), // spoken (may be misheard)
    // E.164, read back by Sarah digit by digit and confirmed by the caller (log_maintenance_request
    // confirmed_phone). Never filled from caller ID alone. Kept for the planned confirmation text;
    // nothing sends to it yet.
    smsConfirmPhone: v.optional(v.string()),
    spokenAddress: v.optional(v.string()),
    spokenUnit: v.optional(v.string()),
    residentId: v.optional(v.id("residents")),
    propertyId: v.optional(v.id("properties")),
    unitId: v.optional(v.id("units")),
    matchConfidence: v.union(v.literal("exact"), v.literal("caller_id"), v.literal("none")),

    callerEmail: v.optional(v.string()),
    // Legacy (find_resident was removed): kept so old rows still validate. No longer written.
    identityConfirmed: v.optional(v.boolean()),
    // Server-side comparison of the spoken name against the residents of the matched unit.
    // Shown to the AM only; never told to the caller.
    nameMatchesResident: v.optional(v.union(v.literal("true"), v.literal("false"), v.literal("unknown"))),
    // "Photo request from the call": the caller agreed to send photos. Sarah texts nobody; the
    // unit's asset manager decides what to do (see maintenance.photoRequestFromCall).
    photosRequestedByCaller: v.optional(v.boolean()),
    photosRequestNote: v.optional(v.string()), // the caller's words / limits
    photosRequestedAt: v.optional(v.number()),

    // Issue (work-order format: title + category (issueType) + description + answers + severity)
    title: v.optional(v.string()),
    issueType: v.string(), // electrical | water_leak | broken_item | gas | fire | flooding | tenant_responsibility | other
    description: v.string(),
    firstNoticed: v.optional(v.string()),
    answers: v.array(v.object({ key: v.string(), question: v.string(), value: v.string() })),
    pets: v.optional(v.string()),
    preferredAccessTimes: v.optional(v.string()),
    severity: v.union(
      v.literal("emergency"),
      v.literal("urgent"),
      v.literal("routine"),
      v.literal("informational"),
    ),
    severityScore: v.optional(v.number()), // 1-10, continuity with tenantIssues
    severityReason: v.optional(v.string()),
    originalSeverity: v.optional(v.string()), // preserved when staff override
    mediaRequested: v.boolean(),
    // Photos/video were asked for and none has arrived yet.
    photosPending: v.optional(v.boolean()),

    // Routing
    assignedAssetManagerUserId: v.optional(v.id("users")),
    routeReason: v.optional(v.string()),
    inExceptionQueue: v.boolean(),

    status: v.union(
      v.literal("new"),
      v.literal("under_review"),
      v.literal("more_info_needed"),
      v.literal("forwarded_to_pat"),
      v.literal("work_order_created"),
      v.literal("closed_out_of_scope"),
      v.literal("closed_duplicate"),
    ),
    // "Validate" keeps the status at under_review and sets this; forwarding requires it.
    validatedAt: v.optional(v.number()),
    validatedBy: v.optional(v.id("users")),
    closeReason: v.optional(v.string()),
    // Written explanation required when rejecting (closeOutOfScope / closeNoWorkOrder).
    closeExplanation: v.optional(v.string()),
    possibleDuplicateOf: v.optional(v.id("maintenanceRequests")),
    nextAction: v.optional(v.string()),
    // Unread indicator: set the first time the ASSIGNED asset manager opens it.
    firstViewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_org_and_created", ["orgId", "createdAt"])
    .index("by_assigned_am_and_status", ["assignedAssetManagerUserId", "status"])
    .index("by_unit_and_created", ["unitId", "createdAt"])
    .index("by_exception", ["orgId", "inExceptionQueue"])
    .index("by_conversation", ["elevenLabsConversationId"]),

  maintenanceMedia: defineTable({
    orgId: v.string(),
    requestId: v.id("maintenanceRequests"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("photo"), v.literal("video")),
    uploadedBy: v.union(v.literal("tenant"), v.literal("staff")),
    // Who uploaded a staff photo (absent on older rows and tenant uploads); drives "remove your own".
    uploadedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_request", ["requestId"])
    .index("by_org", ["orgId"])
    // Refuses attaching one stored file twice (or one that another record already claimed).
    .index("by_storage", ["storageId"]),

  // Per-org monotonic sequences (MR-n, WO-n). Read-modify-write inside the creating mutation,
  // which Convex serialises, so two concurrent creates cannot receive the same number.
  orgCounters: defineTable({
    orgId: v.string(),
    name: v.string(), // "maintenanceRequest" | "workOrder"
    value: v.number(),
  }).index("by_org_and_name", ["orgId", "name"]),

  // --- Work orders (F5) ------------------------------------------------------
  workOrders: defineTable({
    orgId: v.string(),
    number: v.number(), // WO-2051
    requestId: v.optional(v.id("maintenanceRequests")), // absent for manual WOs
    unitId: v.id("units"),
    propertyId: v.id("properties"),
    title: v.string(),
    scope: v.string(),
    priority: v.union(v.literal("emergency"), v.literal("urgent"), v.literal("routine")),
    // DEPRECATED (checklist feature removed 2026-10-16): always [] on new rows; kept so old data stays valid.
    checklist: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        required: v.boolean(),
        done: v.boolean(),
        doneAt: v.optional(v.number()),
        doneBy: v.optional(v.id("users")),
      }),
    ),
    technicianUserId: v.optional(v.id("users")),
    accessNotes: v.optional(v.string()),
    // What the technician must provide before "submit completed" is accepted (PRD 6.5).
    requiredOnSubmit: v.object({
      photos: v.boolean(),
      hours: v.boolean(),
      receipts: v.boolean(),
      notes: v.boolean(),
    }),
    status: v.union(
      v.literal("created"),
      v.literal("assigned"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("reviewed_closed"),
      v.literal("cancelled"),
    ),
    dueDate: v.optional(v.number()),
    // Appointment window for the technician visit. windowStart/windowEnd (epoch ms) are set by the
    // picker, and `window` holds their absolute label ("Tue, Nov 3, 1:00–3:00 PM"). Older rows have
    // only `window`, as free text that may be relative ("Today 2-4pm").
    window: v.optional(v.string()),
    windowStart: v.optional(v.number()),
    windowEnd: v.optional(v.number()),
    // What the tenant said suits them for a visit, in their own words ("next week Monday"), copied
    // from the request at creation. Free text: never parsed, and never the scheduled time (that is
    // window / windowStart / windowEnd, set by staff).
    tenantPreferredTime: v.optional(v.string()),
    cancelReason: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    // --- Owner-statement billing (docs/specs/ros-build-spec.md 3.9). All optional so existing rows
    // stay valid. unitId stays required: property-level billing is the billPropertyLevel flag.
    workCompletedDescription: v.optional(v.string()), // tech writes on submit; office edits; = ROS memo (<= 2000 chars)
    billAmountCents: v.optional(v.number()), // what the owner is charged; = ROS amount; integer > 0
    costCents: v.optional(v.number()), // internal only: never on the ROS, never to owners or technicians
    rosAccountId: v.optional(v.id("ledgerAccounts")), // default Repairs, picked on close
    billPropertyLevel: v.optional(v.boolean()), // true = ROS row shows "Property level"; WO keeps its unit
    noOwnerCharge: v.optional(v.boolean()), // true = never billed to the owner (ASSUMPTION A2)
    billedStatementId: v.optional(v.id("ownerStatements")), // set at finalize; WO can never be billed twice
    billedLedgerEntryId: v.optional(v.id("ledgerEntries")),
    billedAt: v.optional(v.number()),
    // true = closed (reviewed_closed), chargeable and not billed yet: the ROS build reads only these
    // (index by_property_and_rosPending). Set by reviewClose / updateBilling, false once billed.
    // Rows from before this field have it undefined until workOrderBilling.backfillRosPending runs;
    // the build also reads those (rosBuild.loadBuildData), so nothing is missed meanwhile.
    rosPending: v.optional(v.boolean()),
  })
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_technician_and_status", ["technicianUserId", "status"])
    .index("by_request", ["requestId"])
    .index("by_unit", ["unitId"])
    .index("by_property_and_status", ["propertyId", "status"])
    .index("by_ros_account", ["rosAccountId"])
    .index("by_property_and_rosPending", ["propertyId", "rosPending"]),

  workOrderFiles: defineTable({
    orgId: v.string(),
    workOrderId: v.id("workOrders"),
    unitId: v.id("units"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("completion_photo"), v.literal("completion_video"), v.literal("receipt"), v.literal("other")),
    uploadedByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_work_order", ["workOrderId"])
    .index("by_org", ["orgId"])
    .index("by_storage", ["storageId"]),

  workOrderTime: defineTable({
    orgId: v.string(),
    workOrderId: v.id("workOrders"),
    technicianUserId: v.id("users"),
    date: v.string(), // YYYY-MM-DD
    hours: v.number(),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_work_order", ["workOrderId"])
    .index("by_org", ["orgId"]),

  // Money is integer cents everywhere (ROS totals later must not accumulate float error).
  workOrderExpenses: defineTable({
    orgId: v.string(),
    workOrderId: v.id("workOrders"),
    technicianUserId: v.id("users"),
    kind: v.union(v.literal("material"), v.literal("expense")),
    description: v.string(),
    amountCents: v.number(),
    quantity: v.optional(v.number()),
    receiptFileId: v.optional(v.id("workOrderFiles")),
    reimbursable: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_work_order", ["workOrderId"])
    .index("by_org", ["orgId"]),

  workOrderNotes: defineTable({
    orgId: v.string(),
    workOrderId: v.id("workOrders"),
    authorUserId: v.id("users"),
    body: v.string(),
    createdAt: v.number(),
  })
    .index("by_work_order", ["workOrderId"])
    .index("by_org", ["orgId"]),

  // DEPRECATED (checklist feature removed 2026-10-16): no longer read or written; table kept to avoid data loss.
  checklistTemplates: defineTable({
    orgId: v.string(),
    issueType: v.string(),
    items: v.array(v.string()),
  }).index("by_org_and_issue_type", ["orgId", "issueType"]),

  // --- Notifications (F7) ----------------------------------------------------
  // One row per send attempt so failures are visible. The phone is stored as its last four
  // digits only: the log needs to say "who", not become a second copy of the contact list.
  notificationLog: defineTable({
    orgId: v.string(),
    userId: v.optional(v.id("users")),
    phoneLast4: v.optional(v.string()),
    template: v.string(),
    channel: v.literal("sms"),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org_and_created", ["orgId", "createdAt"]),

  // --- Public token links (F8) -----------------------------------------------
  // Same pattern as invites: only a SHA-256 of the token is stored, so a dump of this table
  // cannot be replayed. Expiry and a use cap are enforced when a link is consumed.
  publicLinks: defineTable({
    orgId: v.string(),
    purpose: v.union(v.literal("maintenance_media"), v.literal("payment")),
    tokenHash: v.string(),
    targetId: v.string(), // maintenanceRequests id or payment id
    expiresAt: v.number(),
    maxUses: v.number(),
    useCount: v.number(),
    usedAt: v.optional(v.number()), // set when the cap is reached
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_org", ["orgId"]),
  // --- Unmatched callers --------------------------------------------------------
  // A resident-type caller Sarah could not match to a unit. No maintenance request exists for
  // them: this is a callback to-do for the "unmatched caller" asset manager.
  callbackContacts: defineTable({
    orgId: v.string(),
    elevenLabsConversationId: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    callerName: v.optional(v.string()),
    callerNumber: v.optional(v.string()), // telephony caller ID
    callbackNumber: v.optional(v.string()), // spoken
    callerEmail: v.optional(v.string()),
    reason: v.string(), // why no match
    issueSummary: v.string(),
    assignedUserId: v.optional(v.id("users")),
    status: v.union(v.literal("open"), v.literal("called_back"), v.literal("closed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_conversation", ["elevenLabsConversationId"])
    .index("by_org_and_created", ["orgId", "createdAt"])
    .index("by_assignee_and_status", ["assignedUserId", "status"]),

  // --- Owner verification (owner call menu, B36) --------------------------------
  // One row per call per property an existing owner tried to verify with verify_owner (property +
  // email on file). check_staff_availability only returns a transfer number while this call has a
  // verified row (ownerVerifyLib.hasLiveVerification). Never holds an email. Rows are purged after
  // ownerVerifyLib.VERIFICATION_RETENTION_MS (crons.ts); the audit trail keeps the history.
  ownerVerifications: defineTable({
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    propertyId: v.id("properties"),
    verified: v.boolean(),
    attempts: v.number(), // email checks on this property in this call
    failures: v.number(),
    verifiedAt: v.optional(v.number()),
    lastAttemptAt: v.number(),
    createdAt: v.number(),
    // transfer_owner_call (TRANSFER_MECHANISM "twilio_dial"): when this call was handed to Twilio to
    // ring a staff member, and who. One transfer per call; the Dial result reads the label back.
    transferStartedAt: v.optional(v.number()),
    transferTo: v.optional(v.string()),
  })
    .index("by_conversation", ["elevenLabsConversationId"])
    .index("by_property_and_last_attempt", ["propertyId", "lastAttemptAt"])
    .index("by_created", ["createdAt"]),

  // Legacy per-call counters (find_resident / send_photo_link caps). Nothing writes them any
  // more; the table stays so existing rows still validate.
  sarahAttempts: defineTable({
    orgId: v.string(),
    key: v.string(), // `${tool}:${elevenLabsConversationId}`
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_updated", ["updatedAt"])
    .index("by_org", ["orgId"]),

  // --- Sarah configuration (P17) ---------------------------------------------
  // One row per org. `draft` is what /sarah edits; `published` is what the live agent was last
  // composed from. Approval stamps inside the config are written only by sarahConfig.approve.
  sarahConfig: defineTable({
    orgId: v.string(),
    draft: sarahConfigValidator,
    published: v.optional(sarahConfigValidator),
    publishedAt: v.optional(v.number()),
    publishedBy: v.optional(v.id("users")),
    version: v.number(), // 0 = never published
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Every publish, for rollback and history.
  sarahConfigVersions: defineTable({
    orgId: v.string(),
    version: v.number(),
    config: sarahConfigValidator,
    publishedBy: v.id("users"),
    publishedAt: v.number(),
    note: v.optional(v.string()),
  }).index("by_org_and_version", ["orgId", "version"]),

  // Approval workflow per "Missing from Pat" item (draft -> pending_approval -> approved |
  // changes_requested). `fingerprint` is a hash of the content the status applies to: if the
  // content changes (here or on a tab) the status no longer applies and the item reads as draft.
  sarahConfigItems: defineTable({
    orgId: v.string(),
    itemId: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_approval"),
      v.literal("changes_requested"),
      v.literal("approved"),
    ),
    fingerprint: v.string(),
    text: v.optional(v.string()), // proposal text for the two decision items only
    lastEditedBy: v.optional(v.id("users")),
    lastEditedByLabel: v.optional(v.string()),
    lastEditedAt: v.optional(v.number()),
    note: v.optional(v.string()), // the approver's change request, max 1000 chars
    noteBy: v.optional(v.string()),
    noteAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_org_and_item", ["orgId", "itemId"])
    .index("by_org", ["orgId"]),

  // Append-only history shown in the item modal (created / edited / submitted / approved /
  // changes requested). Org-scoped; written inside the same mutation as the change.
  sarahConfigAudit: defineTable({
    orgId: v.string(),
    itemId: v.string(),
    action: v.string(),
    actorUserId: v.optional(v.id("users")),
    actorLabel: v.string(),
    note: v.optional(v.string()),
    at: v.number(),
  }).index("by_org_and_item", ["orgId", "itemId", "at"]),

  // --- Rental Owner Statements (ROS) ---------------------------------------------------------
  //
  // docs/specs/ros-build-spec.md section 3. Money is integer cents; dates are YYYY-MM-DD business
  // dates in America/New_York; months are YYYY-MM.

  // The rental owner entity (an LLC or a person); one statement per entity per month.
  owners: defineTable({
    orgId: v.string(),
    legalName: v.string(), // "Nye Properties LLC"
    // normalizeNameKey(legalName). NOT unique: owners with the same name are told apart by email
    // (ownerIdentity.ts: same name + a shared email = one owner). Owners typed in by hand
    // (owners.create / update) still refuse a name another non-merged owner already has.
    nameKey: v.string(),
    contactFirstName: v.optional(v.string()),
    contactLastName: v.optional(v.string()),
    emails: v.array(v.string()), // trimmed, lowercased, validated; [] allowed
    // DEPRECATED (2026-11-11): no longer read or written. The fee is per property now:
    // ownerProperties.managementFeeBps (own fee) ?? financeSettings.rosDefaultFeeBps (default 5.00%).
    // Kept optional so existing rows stay valid; feeMigration.copyOwnerFeesToLinks copies a
    // non-default value onto the owner's links.
    managementFeeBps: v.optional(v.number()),
    payeeName: v.optional(v.string()), // owner draw "Name"; undefined = derived (rosCalc.effectivePayee)
    active: v.boolean(),
    source: v.union(v.literal("manual"), v.literal("sheet_import")),
    importKey: v.optional(v.string()), // = nameKey for imported rows; makes re-import idempotent
    // Owner identity (ownerIdentity.ts): set when this owner was merged into another one
    // (owners.merge). A merged owner is inactive, has no links and is never matched again.
    mergedIntoOwnerId: v.optional(v.id("owners")),
    mergedAt: v.optional(v.number()),
    // Set when the owner was created automatically from a property's owner name + email
    // (ownerLinking.linkOwnerForProperty) or from the "Needs an owner" list.
    createdFromPropertyId: v.optional(v.id("properties")),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_name_key", ["orgId", "nameKey"])
    .index("by_org_and_import_key", ["orgId", "importKey"]),

  // "Not the same owner" decisions (owners.dismissIdentityFlag): an identity flag the accountant
  // has looked at and rejected, so it is not raised again. Two kinds:
  //   owner_pair     - two owners are different people (key = ownerIdentity.ownerPairKey);
  //   property_owner - the owner a property page names is not this owner (key =
  //                    ownerIdentity.propertyOwnerKey, including the property's owner name +
  //                    emails at the time, so editing them brings the question back).
  ownerIdentityDismissals: defineTable({
    orgId: v.string(),
    kind: v.union(v.literal("owner_pair"), v.literal("property_owner")),
    key: v.string(),
    ownerId: v.id("owners"),
    otherOwnerId: v.optional(v.id("owners")),
    propertyId: v.optional(v.id("properties")),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_key", ["orgId", "key"]),

  // Owner-property link and per-link settings. A property can go on a statement only when it has
  // exactly one link; two or more = co-owned (paused, ASSUMPTION A10).
  ownerProperties: defineTable({
    orgId: v.string(),
    ownerId: v.id("owners"),
    propertyId: v.id("properties"),
    openingBalanceCents: v.optional(v.number()), // signed integer; beginning cash of the FIRST statement; undefined = 0 + warning
    startMonth: v.optional(v.string()), // "YYYY-MM": first statement month; set at first finalize if empty
    propertyReserveCents: v.optional(v.number()), // >= 0; default prefill for each statement; undefined = 0
    // This property's own management fee (500 = 5.00%, integer 0..10000). undefined = the org
    // default (financeSettings.rosDefaultFeeBps). On the link, so a sold building's new owner
    // starts from the default. Changing it only affects drafts (finals are frozen snapshots).
    managementFeeBps: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_property", ["propertyId"])
    .index("by_org", ["orgId"]),

  // Org-wide owner-statement settings (one row per org, created on first change; feeSettings.ts).
  financeSettings: defineTable({
    orgId: v.string(),
    // Default management fee for every property without its own fee. undefined = 500 (5.00%).
    rosDefaultFeeBps: v.optional(v.number()),
    updatedBy: v.optional(v.id("users")),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Chart of accounts for the owner ledger. Seeded by ledgerAccountSeed.ensureDefaultAccounts.
  ledgerAccounts: defineTable({
    orgId: v.string(),
    name: v.string(),
    nameKey: v.string(), // normalizeNameKey(name), unique per org
    kind: rowTypeValidator, // immutable after create
    systemKey: v.optional(accountSystemKeyValidator),
    feeBase: v.boolean(), // counts toward the management fee base; only kind "income" may be true
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_name_key", ["orgId", "nameKey"])
    .index("by_org_and_system_key", ["orgId", "systemKey"]),

  // The owner ledger: the record of money. A row with statementId is billed on that FINAL
  // statement and can never change. Rows are never hard-deleted; only unbilled manual rows can be voided.
  ledgerEntries: defineTable({
    orgId: v.string(),
    ownerId: v.id("owners"),
    propertyId: v.id("properties"),
    unitId: v.optional(v.id("units")), // absent = "Property level"
    date: v.string(), // YYYY-MM-DD business date
    type: rowTypeValidator, // always = account.kind at write time
    accountId: v.id("ledgerAccounts"),
    counterparty: v.string(), // tenant / vendor / payee; the Name column is built from it
    memo: v.string(),
    amountCents: v.number(), // integer > 0; direction comes from type
    source: ledgerSourceValidator,
    sourceId: v.optional(v.string()), // WO id; "<statementId>:<propertyId>" for fee/draw; "<statementId>:<unitId>" for (historical) roster_rent; none for rent_payment; Stripe id later
    statementId: v.optional(v.id("ownerStatements")), // set = billed on that FINAL statement -> immutable
    voided: v.optional(v.boolean()),
    voidedAt: v.optional(v.number()),
    voidedBy: v.optional(v.id("users")),
    voidReason: v.optional(v.string()),
    // Set at finalize on every billed row: the date it shows on the statement (a carried-forward
    // row posts on the period's first day). `date` keeps the original date.
    postedDate: v.optional(v.string()),
    // --- Rent payments (source "rent_payment", Payments page, convex/rentPayments.ts). `date` is the
    // day the rent was RECEIVED (cash basis: it lands on that month's statement); rentForMonth is the
    // month the rent is for ("YYYY-MM"). At most one non-voided rent_payment per unit per rentForMonth.
    rentForMonth: v.optional(v.string()),
    paymentMethod: v.optional(paymentMethodValidator),
    paymentNote: v.optional(v.string()), // <= 200 chars, e.g. a check number
    createdBy: v.optional(v.id("users")), // absent = system (finalize)
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_property_statement_date", ["propertyId", "statementId", "date"]) // unbilled = statementId undefined
    .index("by_statement", ["statementId"])
    .index("by_source", ["source", "sourceId"])
    .index("by_owner_and_date", ["ownerId", "date"])
    .index("by_org_and_date", ["orgId", "date"])
    .index("by_account", ["accountId"])
    .index("by_owner_and_posted", ["ownerId", "postedDate"])
    .index("by_org_and_posted", ["orgId", "postedDate"])
    // Rent payments: a unit's payment for a rent month (uniqueness), the org's payments for a month
    // (Payments page), and a unit's rows by date (rent entered by hand in the ledger before payments).
    .index("by_unit_and_rent_month", ["unitId", "rentForMonth"])
    .index("by_org_and_rent_month", ["orgId", "rentForMonth"])
    .index("by_unit_and_date", ["unitId", "date"]),

  // One statement per owner per month (draft -> final, or discarded).
  ownerStatements: defineTable({
    orgId: v.string(),
    ownerId: v.id("owners"),
    month: v.string(), // "YYYY-MM"
    periodStart: v.string(), // "YYYY-MM-01"
    periodEnd: v.string(), // last day of month
    propertyIds: v.array(v.id("properties")), // column order (sorted at create)
    status: statementStatusValidator,
    excludedKeys: v.array(v.string()), // "entry:<ledgerEntryId>" | "wo:<workOrderId>" ("rent:<unitId>" only on old drafts; ignored)
    // Lines that are left off by default (dated before the owner's first statement month) and that
    // the accountant put back on. Same key format as excludedKeys.
    includedKeys: v.optional(v.array(v.string())),
    adjustments: v.array(
      v.object({
        propertyId: v.id("properties"),
        earlyPaymentsCents: v.number(), // >= 0, default 0
        unpaidBillsCents: v.number(), // >= 0, default 0
        propertyReserveCents: v.optional(v.number()), // undefined = use ownerProperties.propertyReserveCents
      }),
    ),
    overrides: v.array(
      v.object({
        propertyId: v.id("properties"),
        feeAmountCents: v.optional(v.number()), // undefined = computed
        feeMemo: v.optional(v.string()), // undefined = standard memo
        feeExcluded: v.optional(v.boolean()),
        drawAmountCents: v.optional(v.number()), // undefined = suggested
        drawExcluded: v.optional(v.boolean()),
      }),
    ),
    // DEPRECATED (2026-11-12, rent moved to the Payments page): no longer read or written. Was the
    // roster-rent prefill's edits to a unit's prefilled rent line (key "rent:<unitId>"). Kept
    // optional so existing rows stay valid.
    rentOverrides: v.optional(
      v.array(
        v.object({
          unitId: v.id("units"),
          amountCents: v.optional(v.number()), // integer > 0
          date: v.optional(v.string()), // YYYY-MM-DD inside the period
          counterparty: v.optional(v.string()),
          memo: v.optional(v.string()),
        }),
      ),
    ),
    // DEPRECATED (2026-11-12): the old "I've checked the rent lines" confirmation. No longer read or
    // written (final statements keep what they had). Kept optional so existing rows stay valid.
    rentCheckedAt: v.optional(v.number()),
    rentCheckedBy: v.optional(v.id("users")),
    rentCheckedHash: v.optional(v.string()),
    statementDate: v.optional(v.string()), // set at finalize (business date)
    endingCashCents: v.optional(v.number()), // set at finalize ("All properties")
    availableCents: v.optional(v.number()), // set at finalize ("All properties")
    finalizedAt: v.optional(v.number()),
    finalizedBy: v.optional(v.id("users")),
    discardedAt: v.optional(v.number()),
    discardedBy: v.optional(v.id("users")),
    emailedAt: v.optional(v.number()), // DELIVERY HOOK (not written in v1)
    emailedTo: v.optional(v.array(v.string())), // DELIVERY HOOK
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_month", ["orgId", "month"])
    .index("by_owner_and_month", ["ownerId", "month"]),

  // One row per statement x property, for idempotency, locking and carry-forward.
  ownerStatementProperties: defineTable({
    orgId: v.string(),
    statementId: v.id("ownerStatements"),
    ownerId: v.id("owners"),
    propertyId: v.id("properties"),
    month: v.string(),
    status: statementStatusValidator, // always equal to the parent's status (same mutation)
    endingCashCents: v.optional(v.number()), // this property's ending cash, set at finalize = next month's beginning
  })
    .index("by_property_and_month", ["propertyId", "month"])
    .index("by_property_and_status", ["propertyId", "status", "month"])
    .index("by_statement", ["statementId"]),

  // The immutable final content: JSON.stringify(StatementSnapshot) (rosCalc.ts).
  ownerStatementSnapshots: defineTable({
    orgId: v.string(),
    statementId: v.id("ownerStatements"),
    version: v.literal(1),
    json: v.string(), // < 900 KB, else finalize refuses
    createdAt: v.number(),
  }).index("by_statement", ["statementId"]),
});
