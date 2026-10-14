/**
 * Thin fetch wrapper over the Gemini API, mirroring the style of elevenLabsApi.ts and
 * twilioApi.ts — no SDK, runs on Convex's default runtime. Verified live against a real key
 * (gemini-2.5-flash, generateContent) on 2026-07-30.
 */

const MODEL = "gemini-2.5-flash";

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY. Set it with: npx convex env set GEMINI_API_KEY <key>");
  }
  return key;
}

export type SmsReplyDecision = {
  canAnswer: boolean;
  reply: string;
  escalationReason?: string;
};

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    can_answer: { type: "boolean" },
    reply: { type: "string" },
    escalation_reason: { type: "string" },
  },
  required: ["can_answer", "reply"],
};

/**
 * Structured-output call so escalation is a reliable boolean the code branches on, not
 * something guessed from free text. If Gemini's response fails to parse as the expected
 * shape, the safe default is to escalate rather than silently drop the message.
 */
export async function generateSmsReply(
  systemContext: string,
  history: Array<{ sender: "customer" | "bot" | "staff"; text: string }>,
): Promise<SmsReplyDecision> {
  const contents = history.map((m) => ({
    role: m.sender === "customer" ? "user" : "model",
    parts: [{ text: m.text }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemContext }] },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: REPLY_SCHEMA,
        },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return { canAnswer: false, reply: "", escalationReason: "empty model response" };
  }

  try {
    const parsed = JSON.parse(text);
    return {
      canAnswer: Boolean(parsed.can_answer),
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      escalationReason: parsed.escalation_reason,
    };
  } catch {
    return { canAnswer: false, reply: "", escalationReason: "unparseable model response" };
  }
}


// --- WhatsApp bot ---------------------------------------------------------

export type WaTurn = {
  /** Free-text reply to send back on WhatsApp. Never empty, even when escalating. */
  reply: string;
  /** Who we are talking to, as far as the model can tell so far. */
  audience: "prospect" | "resident" | "unknown";
  /** Hand off to a human and stop auto-replying on this thread. */
  escalate: boolean;
  escalationReason?: string;
  /** Leasing fields, filled in progressively as the conversation reveals them. */
  lead?: {
    callerName?: string;
    callerPhone?: string;
    bedrooms?: string;
    moveInDate?: string;
    budget?: number;
    petsWanted?: boolean;
    petType?: string;
    tourSlot?: string;
  };
  /** Resident maintenance, only once the problem is actually described. */
  issue?: {
    callerName?: string;
    unit?: string;
    callbackNumber?: string;
    reason?: string;
    category?: string;
    severity?: number;
    severityReason?: string;
  };
};

/**
 * One call does everything: writes the reply AND extracts whatever structured facts the
 * conversation has revealed so far.
 *
 * Deliberately not the two-model chat+RAG pipeline used elsewhere. This knowledge base is a
 * handful of short documents, so the whole thing fits in the system prompt — retrieval would
 * add latency and a failure mode for no benefit until the corpus is much larger.
 *
 * The model never decides qualification; it only reports what the person said. The
 * qualify/disqualify decision is made in code by convex/qualifyRules.ts.
 */
const WA_TURN_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    audience: { type: "string", enum: ["prospect", "resident", "unknown"] },
    escalate: { type: "boolean" },
    escalation_reason: { type: "string" },
    lead: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        caller_phone: { type: "string" },
        bedrooms: { type: "string" },
        move_in_date: { type: "string" },
        budget: { type: "number" },
        pets_wanted: { type: "boolean" },
        pet_type: { type: "string" },
        tour_slot: { type: "string" },
      },
    },
    issue: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        unit: { type: "string" },
        callback_number: { type: "string" },
        reason: { type: "string" },
        category: { type: "string" },
        severity: { type: "number" },
        severity_reason: { type: "string" },
      },
    },
  },
  required: ["reply", "audience", "escalate"],
};

export async function generateWaTurn(
  systemContext: string,
  history: Array<{ sender: "customer" | "bot" | "staff"; text: string }>,
): Promise<WaTurn> {
  const contents = history.map((m) => ({
    role: m.sender === "customer" ? "user" : "model",
    parts: [{ text: m.text }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemContext }] },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: WA_TURN_SCHEMA,
        },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return {
      reply: "Sorry — let me get someone to help you with that.",
      audience: "unknown",
      escalate: true,
      escalationReason: "empty model response",
    };
  }

  try {
    const p = JSON.parse(text);
    const lead = p.lead ?? {};
    const issue = p.issue ?? {};
    return {
      reply: typeof p.reply === "string" ? p.reply : "",
      audience: ["prospect", "resident", "unknown"].includes(p.audience) ? p.audience : "unknown",
      escalate: Boolean(p.escalate),
      escalationReason: p.escalation_reason,
      lead: {
        callerName: lead.caller_name,
        callerPhone: lead.caller_phone,
        bedrooms: lead.bedrooms,
        moveInDate: lead.move_in_date,
        budget: typeof lead.budget === "number" ? lead.budget : undefined,
        petsWanted: typeof lead.pets_wanted === "boolean" ? lead.pets_wanted : undefined,
        petType: lead.pet_type,
        tourSlot: lead.tour_slot,
      },
      issue: {
        callerName: issue.caller_name,
        unit: issue.unit,
        callbackNumber: issue.callback_number,
        reason: issue.reason,
        category: issue.category,
        severity: typeof issue.severity === "number" ? issue.severity : undefined,
        severityReason: issue.severity_reason,
      },
    };
  } catch {
    return {
      reply: "Sorry — let me get someone to help you with that.",
      audience: "unknown",
      escalate: true,
      escalationReason: "unparseable model response",
    };
  }
}
