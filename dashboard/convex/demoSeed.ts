import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Demo data for showing the product to someone, and the matching teardown.
 *
 * Every row this writes is identifiable so `clear` can find it again without touching real
 * data. The convention is the phone number: demo callers are all +1555010xxxx, the 555-0100
 * block reserved for fiction, which nothing real can collide with. Rows that have no phone
 * are tagged instead -- screening keys start "demo_", tasks carry a "demo" tag.
 *
 * Not wired into any page on purpose. It runs from the CLI against a named org:
 *   npx convex run demoSeed:seed '{"orgId":"...","userId":"...","agentId":"..."}' --prod
 *   npx convex run demoSeed:clear '{"orgId":"..."}' --prod
 */

const DEMO_PREFIX = "+1555010";
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Local-midnight-ish anchor so seeded days land on sensible hours rather than "now + n". */
function at(daysFromNow: number, hour: number): number {
  const d = new Date(Date.now() + daysFromNow * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export const seed = internalMutation({
  args: {
    orgId: v.string(),
    userId: v.id("users"),
    agentId: v.id("agents"),
  },
  handler: async (ctx, { orgId, userId, agentId }) => {
    const now = Date.now();
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

    // --- Property -----------------------------------------------------------
    const existingProperty = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!existingProperty) {
      await ctx.db.insert("properties", {
        orgId,
        userId,
        name: "Maple Court Apartments",
        units: [
          { bedrooms: "studio", rentMin: 1150, rentMax: 1350, available: true },
          { bedrooms: "1br", rentMin: 1450, rentMax: 1750, available: true },
          { bedrooms: "2br", rentMin: 1900, rentMax: 2300, available: true },
          { bedrooms: "3br+", rentMin: 2600, rentMax: 2950, available: false },
        ],
        petsAllowed: true,
        moveInWindowDays: 60,
        address: {
          formatted: "1420 Maple Court, Columbus, OH 43215",
        },
        updatedAt: now,
      });
      bump("properties");
    }

    // --- Screening questions ------------------------------------------------
    const screening = [
      {
        key: "demo_income_multiple",
        question: "What is your approximate monthly income?",
        answerKind: "number" as const,
        criterion: { kind: "number" as const, op: "gte" as const, value: 4500 },
        order: 1,
      },
      {
        key: "demo_employment",
        question: "Are you currently employed or do you have a steady source of income?",
        answerKind: "yes_no" as const,
        criterion: { kind: "yes_no" as const, mustBe: true },
        order: 2,
      },
      {
        key: "demo_occupants",
        question: "How many people would be living in the apartment?",
        answerKind: "number" as const,
        order: 3,
      },
      {
        key: "demo_parking",
        question: "Would you need a parking space?",
        answerKind: "yes_no" as const,
        order: 4,
      },
    ];
    for (const q of screening) {
      const dupe = await ctx.db
        .query("screeningQuestions")
        .withIndex("by_org", (i) => i.eq("orgId", orgId))
        .filter((i) => i.eq(i.field("key"), q.key))
        .first();
      if (dupe) continue;
      await ctx.db.insert("screeningQuestions", {
        orgId,
        userId,
        enabled: true,
        updatedAt: now,
        ...q,
      });
      bump("screeningQuestions");
    }

    // --- Leads: conversations + qualifications ------------------------------
    type Lead = {
      name: string;
      phone: string;
      bedrooms: string;
      budget: number;
      moveInDate: string;
      pets: boolean;
      petType?: string;
      qualifies: boolean;
      nearMiss?: boolean;
      disqualifyReason?: string;
      tourConfirmed: boolean;
      daysAgo: number;
      durationSec: number;
      channel: "phone" | "browser";
      outcome: "tour_booked" | "disqualified" | "escalated" | "logged_only";
      summary: string;
      income: number;
      occupants: number;
    };

    const leads: Lead[] = [
      {
        name: "Priya Raman", phone: `${DEMO_PREFIX}0142`, bedrooms: "2br", budget: 2100,
        moveInDate: "2026-10-15", pets: true, petType: "cat", qualifies: true,
        tourConfirmed: true, daysAgo: 1, durationSec: 214, channel: "phone",
        outcome: "tour_booked", income: 7200, occupants: 2,
        summary: "Wants a 2 bedroom for mid-October, has one cat. Qualified and booked a tour.",
      },
      {
        name: "Marcus Webb", phone: `${DEMO_PREFIX}0177`, bedrooms: "1br", budget: 1600,
        moveInDate: "2026-11-01", pets: false, qualifies: true,
        tourConfirmed: true, daysAgo: 2, durationSec: 188, channel: "phone",
        outcome: "tour_booked", income: 5400, occupants: 1,
        summary: "Single professional, 1 bedroom for November 1. Qualified, tour booked.",
      },
      {
        name: "Dana Alvarez", phone: `${DEMO_PREFIX}0119`, bedrooms: "studio", budget: 1200,
        moveInDate: "2026-10-01", pets: false, qualifies: true,
        tourConfirmed: false, daysAgo: 3, durationSec: 141, channel: "phone",
        outcome: "logged_only", income: 4800, occupants: 1,
        summary: "Studio for October 1, wants to think about it before booking a tour.",
      },
      {
        name: "Tyler Brooks", phone: `${DEMO_PREFIX}0155`, bedrooms: "2br", budget: 1750,
        moveInDate: "2026-10-20", pets: false, qualifies: false, nearMiss: true,
        disqualifyReason: "Budget is slightly under the 2 bedroom range",
        tourConfirmed: false, daysAgo: 4, durationSec: 166, channel: "phone",
        outcome: "disqualified", income: 5900, occupants: 2,
        summary: "Wanted a 2 bedroom at 1750, just under range. Near miss, worth a follow up.",
      },
      {
        name: "Sophie Lindqvist", phone: `${DEMO_PREFIX}0163`, bedrooms: "3br+", budget: 2700,
        moveInDate: "2026-12-01", pets: true, petType: "dog", qualifies: false,
        disqualifyReason: "No 3 bedroom units are available",
        tourConfirmed: false, daysAgo: 5, durationSec: 132, channel: "phone",
        outcome: "disqualified", income: 9100, occupants: 4,
        summary: "Family of four wanting a 3 bedroom in December. Nothing available.",
      },
      {
        name: "Ahmed Khalil", phone: `${DEMO_PREFIX}0188`, bedrooms: "1br", budget: 1550,
        moveInDate: "2026-10-05", pets: false, qualifies: true,
        tourConfirmed: false, daysAgo: 6, durationSec: 203, channel: "browser",
        outcome: "escalated", income: 5100, occupants: 1,
        summary: "Asked about the lease break clause. Escalated to the team.",
      },
    ];

    for (const l of leads) {
      const elId = `demo_conv_${l.phone.slice(-4)}`;
      const dupe = await ctx.db
        .query("conversations")
        .withIndex("by_elevenlabs_conversation_id", (i) =>
          i.eq("elevenLabsConversationId", elId),
        )
        .first();
      if (dupe) continue;

      const startedAt = now - l.daysAgo * DAY;
      const conversationId = await ctx.db.insert("conversations", {
        userId,
        orgId,
        agentId,
        elevenLabsConversationId: elId,
        channel: l.channel,
        callerNumber: l.phone,
        startedAt,
        endedAt: startedAt + l.durationSec * 1000,
        durationSec: l.durationSec,
        status: "ended",
        intent: "leasing",
        outcome: l.outcome,
        summary: l.summary,
      });
      bump("conversations");

      await ctx.db.insert("qualifications", {
        elevenLabsConversationId: elId,
        conversationId,
        bedrooms: l.bedrooms,
        moveInDate: l.moveInDate,
        budget: l.budget,
        petsWanted: l.pets,
        petType: l.petType,
        callerName: l.name,
        callerPhone: l.phone,
        qualifies: l.qualifies,
        disqualifyReason: l.disqualifyReason,
        nearMiss: l.nearMiss,
        tourConfirmed: l.tourConfirmed,
        screeningAnswers: [
          { key: "demo_income_multiple", question: screening[0].question, value: l.income },
          { key: "demo_employment", question: screening[1].question, value: true },
          { key: "demo_occupants", question: screening[2].question, value: l.occupants },
          { key: "demo_parking", question: screening[3].question, value: l.occupants > 1 },
        ],
        updatedAt: startedAt,
      });
      bump("qualifications");

      const transcript: Array<{ role: "user" | "agent"; text: string }> = [
        { role: "agent", text: "Thanks for calling Maple Court Apartments, this is Sarah! Are you calling about renting an apartment, or something else?" },
        { role: "user", text: `Hi, I'm looking for a ${l.bedrooms === "studio" ? "studio" : l.bedrooms.replace("br", " bedroom")}.` },
        { role: "agent", text: "Happy to help. What is your budget looking like, and when would you want to move in?" },
        { role: "user", text: `Around ${l.budget} a month, moving in ${l.moveInDate}.` },
        { role: "agent", text: l.qualifies ? "That works nicely. Would you like to come see it?" : "Let me check that for you." },
      ];
      let t = startedAt;
      for (const m of transcript) {
        t += 12_000;
        await ctx.db.insert("messages", {
          conversationId,
          role: m.role,
          text: m.text,
          isFinal: true,
          at: t,
        });
        bump("messages");
      }
    }

    // --- Tours --------------------------------------------------------------
    const tours = [
      { name: "Priya Raman", phone: `${DEMO_PREFIX}0142`, days: 1, hour: 10, status: "booked" as const },
      { name: "Marcus Webb", phone: `${DEMO_PREFIX}0177`, days: 2, hour: 14, status: "booked" as const },
      { name: "Jordan Feng", phone: `${DEMO_PREFIX}0124`, days: 3, hour: 11, status: "booked" as const },
      { name: "Lena Ortiz", phone: `${DEMO_PREFIX}0131`, days: 6, hour: 15, status: "booked" as const },
      { name: "Casey Nolan", phone: `${DEMO_PREFIX}0198`, days: 4, hour: 9, status: "cancelled" as const },
      { name: "Ruth Okonjo", phone: `${DEMO_PREFIX}0173`, days: -2, hour: 13, status: "booked" as const },
    ];
    for (const t of tours) {
      const start = at(t.days, t.hour);
      const dupe = await ctx.db
        .query("tours")
        .withIndex("by_org_and_start", (i) => i.eq("orgId", orgId).eq("start", start))
        .first();
      if (dupe) continue;
      await ctx.db.insert("tours", {
        orgId,
        assignedUserId: userId,
        start,
        end: start + HOUR / 2,
        timeZone: "America/New_York",
        status: t.status,
        callerName: t.name,
        callerPhone: t.phone,
        createdAt: now - 2 * DAY,
        updatedAt: now - 2 * DAY,
      });
      bump("tours");
    }

    // --- Tenant issues ------------------------------------------------------
    const issues = [
      { name: "Grace Whitfield", unit: "2C", phone: `${DEMO_PREFIX}0211`, reason: "No hot water in the shower since last night.", category: "maintenance", severity: 8, severityReason: "no hot water, unlivable but not dangerous", status: "open" as const, daysAgo: 0 },
      { name: "Daniel Osei", unit: "4B", phone: `${DEMO_PREFIX}0222`, reason: "Kitchen sink is leaking under the cabinet.", category: "maintenance", severity: 5, severityReason: "contained leak, unit still livable", status: "open" as const, daysAgo: 1 },
      { name: "Mei Tanaka", unit: "1A", phone: `${DEMO_PREFIX}0233`, reason: "Neighbours playing loud music past midnight again.", category: "noise", severity: 4, severityReason: "repeated noise complaint", status: "open" as const, daysAgo: 2 },
      { name: "Owen Brady", unit: "3F", phone: `${DEMO_PREFIX}0244`, reason: "Locked out of the apartment, keys are inside.", category: "lockout", severity: 7, severityReason: "lockout, needs same day access", status: "resolved" as const, daysAgo: 3 },
      { name: "Fatima Noor", unit: "5D", phone: `${DEMO_PREFIX}0255`, reason: "Question about the water charge on this month's statement.", category: "billing", severity: 2, severityReason: "billing question, no repair needed", status: "resolved" as const, daysAgo: 4 },
      { name: "Victor Hale", unit: "2A", phone: `${DEMO_PREFIX}0266`, reason: "Smoke alarm keeps chirping every few minutes.", category: "maintenance", severity: 3, severityReason: "low battery chirp, schedulable", status: "open" as const, daysAgo: 5 },
    ];
    for (const i of issues) {
      const elId = `demo_issue_${i.phone.slice(-4)}`;
      const dupe = await ctx.db
        .query("tenantIssues")
        .withIndex("by_elevenlabs_conversation_id", (q) =>
          q.eq("elevenLabsConversationId", elId),
        )
        .first();
      if (dupe) continue;
      const createdAt = now - i.daysAgo * DAY - 3 * HOUR;
      await ctx.db.insert("tenantIssues", {
        userId,
        orgId,
        elevenLabsConversationId: elId,
        callerName: i.name,
        unit: i.unit,
        callerNumber: i.phone,
        callbackNumber: i.phone,
        reason: i.reason,
        category: i.category,
        severity: i.severity,
        severityReason: i.severityReason,
        status: i.status,
        createdAt,
        updatedAt: createdAt,
      });
      bump("tenantIssues");
    }

    // --- Tasks --------------------------------------------------------------
    const tasks = [
      { title: "Follow up with Tyler Brooks about the 2 bedroom", description: "Near miss on budget. See if the 1 bedroom at 1750 would work for him.", status: "todo" as const, priority: "high" as const, category: "Leasing", due: 1 },
      { title: "Schedule plumber for unit 4B sink leak", description: "Daniel Osei reported a leak under the kitchen cabinet.", status: "in_progress" as const, priority: "high" as const, category: "Maintenance", due: 0 },
      { title: "Restock lobby key fobs", status: "todo" as const, priority: "low" as const, category: "Operations", due: 9 },
      { title: "Send renewal notices for December leases", description: "Six leases are up in December. Notices need to go out 60 days ahead.", status: "todo" as const, priority: "medium" as const, category: "Leasing", due: 5 },
      { title: "Replace smoke alarm battery in 2A", status: "in_progress" as const, priority: "medium" as const, category: "Maintenance", due: 2 },
      { title: "Post updated pet policy to the knowledge base", status: "completed" as const, priority: "low" as const, category: "Operations", due: -3 },
      { title: "Quarterly boiler inspection", description: "Vendor confirmed for the morning. Needs basement access.", status: "todo" as const, priority: "medium" as const, category: "Maintenance", due: 12 },
      { title: "Resolve noise complaint in 1A", description: "Third report this month. Speak to the upstairs tenant directly.", status: "in_progress" as const, priority: "medium" as const, category: "Resident", due: 3 },
      { title: "Confirm October move-in paperwork for Dana Alvarez", status: "completed" as const, priority: "medium" as const, category: "Leasing", due: -1 },
    ];
    for (const t of tasks) {
      const dupe = await ctx.db
        .query("tasks")
        .withIndex("by_org", (i) => i.eq("orgId", orgId))
        .filter((i) => i.eq(i.field("title"), t.title))
        .first();
      if (dupe) continue;
      await ctx.db.insert("tasks", {
        orgId,
        userId,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        category: t.category,
        dueDate: at(t.due, 17),
        tags: ["demo"],
        createdAt: now - 3 * DAY,
        updatedAt: now - DAY,
      });
      bump("tasks");
    }

    // --- SMS threads (Messages tab) -----------------------------------------
    //
    // threads/smsMessages and every wa* table are global -- they carry no orgId, so these rows
    // are visible to any team on this deployment, not just `orgId`. They are still matched by
    // the DEMO_PREFIX phone on teardown.
    const smsThreads = [
      {
        phone: `${DEMO_PREFIX}0142`, status: "bot" as const, minsAgo: 35,
        msgs: [
          { sender: "customer" as const, text: "Hi, is the 2 bedroom still available?" },
          { sender: "bot" as const, text: "Yes it is! It runs $1,900 to $2,300 depending on the floor. Were you thinking of a particular move-in date?" },
          { sender: "customer" as const, text: "Mid October if possible" },
          { sender: "bot" as const, text: "That works. Would you like to come and see it? I can check what's open this week." },
        ],
      },
      {
        phone: `${DEMO_PREFIX}0244`, status: "escalated" as const, minsAgo: 120,
        escalationReason: "requested_human",
        msgs: [
          { sender: "customer" as const, text: "I'm locked out of 3F, keys are inside" },
          { sender: "bot" as const, text: "I'm sorry about that. I've logged it and someone from the team will call you right back." },
          { sender: "customer" as const, text: "Can someone just call me please" },
          { sender: "staff" as const, text: "Hi Owen, this is Dana from the office. Calling you now." },
        ],
      },
      {
        phone: `${DEMO_PREFIX}0255`, status: "bot" as const, minsAgo: 400,
        msgs: [
          { sender: "customer" as const, text: "What's the water charge on my statement?" },
          { sender: "bot" as const, text: "Water is billed quarterly and split across the building by unit size. I've logged your question so the office can send you the breakdown." },
        ],
      },
    ];
    for (const t of smsThreads) {
      const dupe = await ctx.db
        .query("threads")
        .withIndex("by_channel_and_phone", (i) =>
          i.eq("channel", "sms").eq("customerPhone", t.phone),
        )
        .first();
      if (dupe) continue;
      const lastMessageAt = now - t.minsAgo * 60_000;
      const threadId = await ctx.db.insert("threads", {
        channel: "sms",
        customerPhone: t.phone,
        status: t.status,
        escalationReason: t.escalationReason,
        lastMessageAt,
      });
      bump("threads");
      let when = lastMessageAt - t.msgs.length * 90_000;
      for (const m of t.msgs) {
        when += 90_000;
        await ctx.db.insert("smsMessages", {
          threadId,
          sender: m.sender,
          text: m.text,
          at: when,
        });
        bump("smsMessages");
      }
    }

    // --- WhatsApp -----------------------------------------------------------
    const waChats = [
      {
        chat: `${DEMO_PREFIX}0311`, name: "Elena Fischer", status: "bot" as const,
        unread: 0, minsAgo: 50,
        msgs: [
          { sender: "customer" as const, text: "Hello, do you have any 1 bedrooms open?" },
          { sender: "bot" as const, text: "We do! 1 bedrooms run $1,450 to $1,750. When were you hoping to move in?" },
          { sender: "customer" as const, text: "Start of November. Budget around 1600" },
          { sender: "bot" as const, text: "That fits nicely. Can I take your name so I can pass this to the leasing team?" },
          { sender: "customer" as const, text: "Elena Fischer" },
        ],
        lead: {
          callerName: "Elena Fischer", bedrooms: "1br", budget: 1600,
          moveInDate: "2026-11-01", petsWanted: false, qualifies: true,
        },
      },
      {
        chat: `${DEMO_PREFIX}0322`, name: "Ibrahim Saleh", status: "escalated" as const,
        unread: 2, minsAgo: 15,
        escalationReason: "urgent_tenant_issue",
        msgs: [
          { sender: "customer" as const, text: "There is water coming through my ceiling in 5B" },
          { sender: "bot" as const, text: "That sounds serious. I've logged it as urgent and the team is being notified now." },
          { sender: "customer" as const, text: "It's getting worse" },
          { sender: "customer" as const, text: "Please send someone" },
        ],
        issue: {
          callerName: "Ibrahim Saleh", unit: "5B",
          reason: "Water coming through the ceiling, getting worse.",
          category: "maintenance", severity: 9,
          severityReason: "active flooding from above, safety risk",
        },
      },
      {
        chat: `${DEMO_PREFIX}0333`, name: "Hannah Weiss", status: "closed" as const,
        unread: 0, minsAgo: 1500,
        msgs: [
          { sender: "customer" as const, text: "Are dogs allowed?" },
          { sender: "bot" as const, text: "Yes, pets are welcome. There's a one-time pet fee and a weight limit of 50lbs." },
          { sender: "customer" as const, text: "Perfect, thank you!" },
        ],
      },
    ];
    for (const c of waChats) {
      const dupe = await ctx.db
        .query("waThreads")
        .withIndex("by_chat_id", (i) => i.eq("chatId", c.chat))
        .first();
      if (dupe) continue;
      const lastMessageAt = now - c.minsAgo * 60_000;
      const threadId = await ctx.db.insert("waThreads", {
        chatId: c.chat,
        displayName: c.name,
        status: c.status,
        escalationReason: c.escalationReason,
        unreadCount: c.unread,
        lastMessageAt,
        createdAt: lastMessageAt - 2 * HOUR,
      });
      bump("waThreads");
      let when = lastMessageAt - c.msgs.length * 60_000;
      for (const m of c.msgs) {
        when += 60_000;
        await ctx.db.insert("waMessages", {
          threadId,
          sender: m.sender,
          text: m.text,
          at: when,
          deliveryStatus: m.sender === "customer" ? undefined : "sent",
        });
        bump("waMessages");
      }
      if (c.lead) {
        await ctx.db.insert("waLeads", {
          threadId,
          callerPhone: c.chat,
          ...c.lead,
          updatedAt: lastMessageAt,
        });
        bump("waLeads");
      }
      if (c.issue) {
        await ctx.db.insert("waIssues", {
          threadId,
          callbackNumber: c.chat,
          ...c.issue,
          status: "open",
          createdAt: lastMessageAt,
          updatedAt: lastMessageAt,
        });
        bump("waIssues");
      }
    }

    return { seeded: counts };
  },
});

/** Removes everything `seed` wrote for this org, and nothing else. */
export const clear = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    const isDemo = (p?: string) => !!p && p.startsWith(DEMO_PREFIX);

    const convos = await ctx.db
      .query("conversations")
      .withIndex("by_org_and_started", (i) => i.eq("orgId", orgId))
      .collect();
    for (const c of convos) {
      if (!isDemo(c.callerNumber)) continue;
      for (const m of await ctx.db
        .query("messages")
        .withIndex("by_conversation", (i) => i.eq("conversationId", c._id))
        .collect()) {
        await ctx.db.delete(m._id);
        bump("messages");
      }
      if (c.elevenLabsConversationId) {
        const q = await ctx.db
          .query("qualifications")
          .withIndex("by_elevenlabs_conversation_id", (i) =>
            i.eq("elevenLabsConversationId", c.elevenLabsConversationId!),
          )
          .first();
        if (q) {
          await ctx.db.delete(q._id);
          bump("qualifications");
        }
      }
      await ctx.db.delete(c._id);
      bump("conversations");
    }

    for (const t of await ctx.db
      .query("tenantIssues")
      .withIndex("by_org", (i) => i.eq("orgId", orgId))
      .collect()) {
      if (!isDemo(t.callerNumber) && !isDemo(t.callbackNumber)) continue;
      await ctx.db.delete(t._id);
      bump("tenantIssues");
    }

    for (const t of await ctx.db
      .query("tours")
      .withIndex("by_org_and_start", (i) => i.eq("orgId", orgId))
      .collect()) {
      if (!isDemo(t.callerPhone)) continue;
      await ctx.db.delete(t._id);
      bump("tours");
    }

    for (const t of await ctx.db
      .query("tasks")
      .withIndex("by_org", (i) => i.eq("orgId", orgId))
      .collect()) {
      if (!t.tags?.includes("demo")) continue;
      await ctx.db.delete(t._id);
      bump("tasks");
    }

    for (const q of await ctx.db
      .query("screeningQuestions")
      .withIndex("by_org", (i) => i.eq("orgId", orgId))
      .collect()) {
      if (!q.key.startsWith("demo_")) continue;
      await ctx.db.delete(q._id);
      bump("screeningQuestions");
    }

    for (const t of await ctx.db.query("threads").collect()) {
      if (!isDemo(t.customerPhone)) continue;
      for (const m of await ctx.db
        .query("smsMessages")
        .withIndex("by_thread", (i) => i.eq("threadId", t._id))
        .collect()) {
        await ctx.db.delete(m._id);
        bump("smsMessages");
      }
      await ctx.db.delete(t._id);
      bump("threads");
    }

    for (const t of await ctx.db.query("waThreads").collect()) {
      if (!isDemo(t.chatId)) continue;
      for (const m of await ctx.db
        .query("waMessages")
        .withIndex("by_thread", (i) => i.eq("threadId", t._id))
        .collect()) {
        await ctx.db.delete(m._id);
        bump("waMessages");
      }
      for (const l of await ctx.db
        .query("waLeads")
        .withIndex("by_thread", (i) => i.eq("threadId", t._id))
        .collect()) {
        await ctx.db.delete(l._id);
        bump("waLeads");
      }
      for (const i2 of await ctx.db
        .query("waIssues")
        .withIndex("by_thread", (i) => i.eq("threadId", t._id))
        .collect()) {
        await ctx.db.delete(i2._id);
        bump("waIssues");
      }
      await ctx.db.delete(t._id);
      bump("waThreads");
    }

    return { deleted: counts };
  },
});
