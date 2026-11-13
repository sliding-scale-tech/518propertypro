/**
 * Thin wrapper over the ElevenLabs REST API.
 *
 * Uses fetch rather than @elevenlabs/elevenlabs-js so these run on Convex's default runtime
 * with no "use node" bundling. Every endpoint here was verified against a live free-tier
 * account on 2026-07-29 — see docs/superpowers/specs/.
 */

const BASE = "https://api.elevenlabs.io/v1";

/** The embedding model free-tier RAG indexing accepts. */
export const RAG_MODEL = "e5_mistral_7b_instruct";

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key?.trim()) {
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Set it with: npx convex env set ELEVENLABS_API_KEY <key>",
    );
  }
  return key;
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "xi-api-key": apiKey(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!res.ok) {
    const detail = await res.text();
    // Surface ElevenLabs' own message verbatim — it is consistently more useful than
    // anything we would synthesise (e.g. "missing the permission convai_read").
    throw new Error(`ElevenLabs ${res.status} on ${path}: ${detail.slice(0, 500)}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Agents ---------------------------------------------------------------

export type KnowledgeBaseEntry = {
  type: "text";
  id: string;
  name: string;
  usage_mode: "auto";
};

/**
 * Voice delivery settings. These used to live only in the ElevenLabs dashboard, which meant
 * they silently drifted from anything we had agreed on — see docs/voice-quality-research.md
 * for the audit that prompted moving them into code.
 */
export type VoiceTuning = {
  /**
   * `eleven_v3_conversational` is the only model that supports expressive mode; it trades
   * ~205ms of latency (~280ms vs ~75ms for flash) for genuine prosody and tone adaptation.
   * Note it does NOT preserve professional voice clone (PVC) characteristics, so it pairs
   * with a premade voice rather than a cloned one.
   */
  modelId: string;
  /** 0.30–0.50 is dynamic and emotional; 0.60+ trends monotonous. */
  stability: number;
  /** Higher tracks the source voice more closely; very high values distort. */
  similarityBoost: number;
  /** 0.9–1.1 is the documented natural conversational range. */
  speed: number;
  /** Only has an effect on eleven_v3_conversational, where it is the whole point. */
  expressiveMode: boolean;
  /**
   * The tags offered to the LLM in expressive mode. Only a suggestion: the API says the agent can
   * still use other tags, so the tone rule in composeStyle is what forbids upbeat ones.
   */
  suggestedAudioTags: Array<{ tag: string; description: string }>;
};

/** Turn-taking. Governs dead air and how readily the agent talks over the caller. */
export type TurnTuning = {
  /** Seconds of caller silence before the agent prompts again. */
  turnTimeout: number;
  /** "patient" is documented for flows that collect names, numbers, and addresses. */
  eagerness: "eager" | "normal" | "patient";
  /** Seconds of LLM/tool delay before speaking a filler instead of going silent. */
  softTimeoutSeconds: number;
  /** Most fillers in one wait. The timer repeats every softTimeoutSeconds up to this limit. */
  maxSoftTimeoutsPerGeneration: number;
  /** Shuffled once per turn by ElevenLabs (randomize_fillers). */
  fillerMessages: string[];
  /** Backchannels that should not count as an interruption. */
  interruptionIgnoreTerms: string[];
  /**
   * Also apply ElevenLabs' curated backchannel list for `interruptionIgnoreTermLanguages`, on
   * top of ours. It has no effect while that language list is empty.
   */
  mergeWithDefaultIgnoreTerms: boolean;
  /** Languages whose curated ignore terms are merged in (see above). */
  interruptionIgnoreTermLanguages: string[];
  /**
   * Stops background noise cutting off the opening greeting. Sent under
   * conversation_config.agent (not turn), where the API keeps it.
   */
  disableFirstMessageInterruptions: boolean;
};

/** Voice activity detection: what counts as the caller speaking. */
export type VadTuning = {
  /** Ignore background voices (a TV, other people) so they don't interrupt or become turns. */
  backgroundVoiceDetection: boolean;
};

/** The LLM behind the voice agent. The values live in agents.ts (LLM_TUNING). */
export type LlmTuning = {
  /** ElevenLabs `llm` enum value. */
  model: string;
  temperature: number;
  /** null clears the field (models without reasoning_effort support). */
  reasoningEffort: "minimal" | "low" | "medium" | "high" | null;
  maxTokens: number;
};

/** The transfer_to_number system tool body (built by ownerRoutingLib.transferToolConfig). */
export type TransferToolConfig = {
  type: "system";
  name: string;
  description: string;
  pre_tool_speech: "off";
  params: {
    system_tool_type: "transfer_to_number";
    transfers: Array<{
      // phone_dynamic_variable: the number comes from a dynamic variable at transfer time (the owner
      // menu's server gate, see ownerRoutingLib.TRANSFER_DESTINATION_MODE).
      transfer_destination: { type: "phone"; phone_number: string } | { type: "phone_dynamic_variable"; phone_number: string };
      condition: string;
      transfer_type: "blind";
      post_dial_digits?: { type: "static"; value: string } | { type: "dynamic"; value: string };
    }>;
    enable_client_message: boolean;
  };
};

export type AgentConfig = {
  name: string;
  prompt: string;
  firstMessage: string;
  voiceId: string;
  knowledgeBase: KnowledgeBaseEntry[];
  toolIds: string[];
  voice: VoiceTuning;
  turn: TurnTuning;
  vad: VadTuning;
  llm: LlmTuning;
  /**
   * The owner call menu's transfer tool. null = no transfer tool (sent as null, so switching the
   * menu off really removes it: PATCH merges). Absent counts as null.
   */
  transfer?: TransferToolConfig | null;
  /**
   * Keypad (DTMF) input for the owner call menu. true = on, false = explicitly off (null), undefined =
   * leave the agent's current setting alone, so a push while the menu is off sends nothing new.
   */
  dtmfInput?: boolean;
  /**
   * Defaults for custom dynamic variables (conversation_config.agent.dynamic_variables). Sent when
   * given; {} clears them. ElevenLabs uses these for dashboard tests only: they are NOT applied on
   * phone calls, so a {{variable}} the agent needs on a call must come from the initiation webhook.
   */
  dynamicVariablePlaceholders?: Record<string, string>;
};

/** ElevenLabs' documented defaults: a key press completes after 2s, or at once on #. */
const DTMF_INPUT_SETTINGS = { dtmf_input_timeout: 2.0, hash_terminator: true, redact_input: false };

/**
 * The shared body for create and update. These two used to be near-identical copies that
 * drifted apart field by field; building one object keeps a new setting from landing on
 * only one of the two paths.
 */
function conversationConfigBody(input: AgentConfig) {
  const [primaryFiller, ...extraFillers] = input.turn.fillerMessages;

  return {
    agent: {
      ...(input.dynamicVariablePlaceholders
        ? { dynamic_variables: { dynamic_variable_placeholders: input.dynamicVariablePlaceholders } }
        : {}),
      first_message: input.firstMessage,
      disable_first_message_interruptions: input.turn.disableFirstMessageInterruptions,
      language: "en",
      prompt: {
        prompt: input.prompt,
        // Model, temperature, reasoning and token cap all come from LLM_TUNING in agents.ts, so
        // create and update can never drift apart. Change the model there, not here.
        llm: input.llm.model,
        temperature: input.llm.temperature,
        // Always sent, null included: PATCH merges rather than replaces, so a stale
        // reasoning_effort left over from a different model can otherwise persist and 400
        // against a model that doesn't support that field (gemini-2.0-flash, for one).
        // null clears it; a value sets it.
        reasoning_effort: input.llm.reasoningEffort,
        // Voice replies are one acknowledgement plus ONE question (25 words at most, see the HARD
        // RULES in the prompt); a lower cap backs that up and keeps latency down. Tool-call
        // arguments count too: the largest is the final log_maintenance_request of a maintenance
        // call (STEP 3), which the prompt keeps small by sending only what the first log did not.
        max_tokens: input.llm.maxTokens,
        knowledge_base: input.knowledgeBase,
        tool_ids: input.toolIds,
        // We pay to RAG-index every synced doc (see computeRagIndex); leaving this off
        // meant those indexes went unused and the documents were injected as raw text.
        rag: { enabled: true, embedding_model: RAG_MODEL },
        built_in_tools: {
          end_call: {
            name: "end_call",
            description:
              "Ends the call once the purpose is accomplished and there is nothing more to help with.",
          },
          // ElevenLabs runs another LLM generation after every tool result, and without this tool
          // the model has no way to stay silent in it, so a result that lands after a question
          // makes Sarah speak again without the caller having answered. The wait matches
          // turnTimeout, so a silent caller still gets a check-in.
          skip_turn: {
            type: "system",
            name: "skip_turn",
            description:
              "Stay silent and wait for the caller. Use it when a tool result arrives while your " +
              "last question is still unanswered, or when the caller asks for a moment.",
            pre_tool_speech: "off",
            params: { system_tool_type: "skip_turn", wait_timeout_secs: input.turn.turnTimeout },
          },
          // Owner call menu only (see ownerRoutingLib.transferToolConfig). Always sent, null included:
          // PATCH merges, so leaving it out would keep a transfer tool after the menu is switched off.
          transfer_to_number: input.transfer ?? null,
        },
      },
    },
    ...(input.dtmfInput !== undefined
      ? { conversation: { dtmf_input_settings: input.dtmfInput ? DTMF_INPUT_SETTINGS : null } }
      : {}),
    turn: {
      turn_timeout: input.turn.turnTimeout,
      turn_eagerness: input.turn.eagerness,
      interruption_ignore_terms: input.turn.interruptionIgnoreTerms,
      merge_with_default_ignore_terms: input.turn.mergeWithDefaultIgnoreTerms,
      interruption_ignore_term_languages: input.turn.interruptionIgnoreTermLanguages,
      soft_timeout_config: {
        timeout_seconds: input.turn.softTimeoutSeconds,
        max_soft_timeouts_per_generation: input.turn.maxSoftTimeoutsPerGeneration,
        message: primaryFiller,
        additional_soft_timeout_messages: extraFillers,
        randomize_fillers: true,
        // An LLM-generated filler would add exactly the latency the filler exists to cover.
        use_llm_generated_message: false,
      },
    },
    vad: {
      background_voice_detection: input.vad.backgroundVoiceDetection,
    },
    tts: {
      voice_id: input.voiceId,
      model_id: input.voice.modelId,
      stability: input.voice.stability,
      similarity_boost: input.voice.similarityBoost,
      speed: input.voice.speed,
      expressive_mode: input.voice.expressiveMode,
      suggested_audio_tags: input.voice.suggestedAudioTags,
      // 3 is "max latency optimizations" with the text normalizer still running. 4 is the
      // same but switches the normalizer off, which mispronounces exactly what a leasing
      // agent says all day — rents, dates, phone numbers. 3 buys correctness for ~nothing.
      optimize_streaming_latency: 3,
      // Normalizes after the LLM rather than instructing the LLM to spell numbers out, so
      // transcripts keep "$1,450" while the audio still says it correctly.
      text_normalisation_type: "elevenlabs",
    },
  };
}

export function createAgent(input: AgentConfig) {
  return request<{ agent_id: string }>("/convai/agents/create", {
    method: "POST",
    body: {
      name: input.name,
      conversation_config: (() => {
        const body = conversationConfigBody(input);
        return { ...body, conversation: { ...("conversation" in body ? body.conversation : {}), text_only: false } };
      })(),
    },
  });
}

export function updateAgent(agentId: string, input: AgentConfig) {
  return request<{ agent_id: string }>(`/convai/agents/${agentId}`, {
    method: "PATCH",
    body: {
      name: input.name,
      conversation_config: conversationConfigBody(input),
    },
  });
}

// --- Server tools (webhook tools) ------------------------------------------

/**
 * A property's schema entry either describes a field for the LLM to fill (`description`) or
 * binds it to an ElevenLabs system variable (`dynamicVariable`), never both — the API 422s if
 * you set more than one. Verified live against a real test tool on 2026-07-30.
 */
export type ToolProperty =
  | { type: "string" | "number" | "boolean"; description: string }
  | { type: "string" | "number" | "boolean"; dynamicVariable: string };

export type ToolDefinition = {
  name: string;
  description: string;
  url: string;
  properties: Record<string, ToolProperty>;
  required: string[];
  // Static headers ElevenLabs sends with every call to this webhook tool (e.g. a shared secret).
  requestHeaders?: Record<string, string>;
  /**
   * Dynamic variables set from this tool's JSON result (ElevenLabs "assignments", source response,
   * dot-notation value_path). A path missing from the result leaves the variable unchanged.
   */
  assignments?: Array<{ dynamicVariable: string; valuePath: string }>;
};

function toApiProperty(p: ToolProperty) {
  if ("dynamicVariable" in p) {
    return { type: p.type, dynamic_variable: p.dynamicVariable };
  }
  return { type: p.type, description: p.description };
}

function toolConfigBody(def: ToolDefinition) {
  return {
    type: "webhook",
    name: def.name,
    description: def.description,
    response_timeout_secs: 20,
    // "off": tools run silently around one spoken reply. "force" asked the LLM to speak with every
    // tool call, so a real reply, often a question, went out in the same step as the tool, and the
    // tool's result then made Sarah speak again with no caller turn (conv_9001m6dzykqte399btbs28d2z4ss
    // and conv_8201m670crm2fvcsaa3cs48pn1h8). The soft-timeout fillers in TURN_TUNING cover a slow
    // tool. Verified enum: 'auto' | 'force' | 'off'.
    pre_tool_speech: "off",
    // Always sent ([] when none): the tool PATCH merges, so omitting it would keep old assignments.
    assignments: (def.assignments ?? []).map((a) => ({
      source: "response",
      dynamic_variable: a.dynamicVariable,
      value_path: a.valuePath,
    })),
    api_schema: {
      url: def.url,
      method: "POST",
      ...(def.requestHeaders ? { request_headers: def.requestHeaders } : {}),
      request_body_schema: {
        type: "object",
        description: def.description,
        required: def.required,
        properties: Object.fromEntries(
          Object.entries(def.properties).map(([k, v]) => [k, toApiProperty(v)]),
        ),
      },
    },
  };
}

export function createTool(def: ToolDefinition) {
  return request<{ id: string }>("/convai/tools", {
    method: "POST",
    body: { tool_config: toolConfigBody(def) },
  });
}

export function updateTool(toolId: string, def: ToolDefinition) {
  return request<{ id: string }>(`/convai/tools/${toolId}`, {
    method: "PATCH",
    body: { tool_config: toolConfigBody(def) },
  });
}

export function listTools() {
  // api_schema.url is what agents.ensureTools matches on: the name is shared across every
  // deployment pointed at this workspace, the URL is what makes a tool this deployment's.
  return request<{
    tools: Array<{
      id: string;
      tool_config: { name: string; api_schema?: { url?: string } };
    }>;
  }>("/convai/tools");
}

export function getWebrtcToken(agentId: string) {
  return request<{ token: string }>(
    `/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
  );
}

// --- Knowledge base -------------------------------------------------------

export function createKbDocFromText(text: string, name: string) {
  return request<{ id: string; name: string }>("/convai/knowledge-base/text", {
    method: "POST",
    body: { text, name },
  });
}

/** True if the knowledge-base document still exists in ElevenLabs; false only on a 404. */
export async function kbDocExists(docId: string): Promise<boolean> {
  try {
    await request<unknown>(`/convai/knowledge-base/${docId}`);
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("ElevenLabs 404")) return false;
    throw err;
  }
}

/**
 * Pulls the missing knowledge-base document id out of a PATCH-agent 404
 * (`document_not_found`, "Document with id X not found."), or null for any other error.
 */
export function missingKbDocId(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  if (!err.message.startsWith("ElevenLabs 404")) return null;
  if (!err.message.includes("document_not_found")) return null;
  const m = /Document with id ([A-Za-z0-9_-]+) not found/.exec(err.message);
  return m ? m[1] : null;
}

/** Read-only: whether keypad (DTMF) input is currently switched on for the agent. */
export async function getAgentDtmfEnabled(agentId: string): Promise<boolean> {
  const a = await request<{ conversation_config?: { conversation?: { dtmf_input_settings?: unknown } } }>(
    `/convai/agents/${agentId}`,
  );
  const d = a.conversation_config?.conversation?.dtmf_input_settings;
  return d !== null && d !== undefined;
}

/** Read-only: the knowledge-base ids the live agent currently references. */
export async function getAgentKbIds(agentId: string): Promise<string[]> {
  const a = await request<{
    conversation_config?: { agent?: { prompt?: { knowledge_base?: Array<{ id: string }> } } };
  }>(`/convai/agents/${agentId}`);
  return (a.conversation_config?.agent?.prompt?.knowledge_base ?? []).map((k) => k.id);
}

export function computeRagIndex(docId: string) {
  return request<{ id: string; status: string; progress_percentage: number }>(
    `/convai/knowledge-base/${docId}/rag-index`,
    { method: "POST", body: { model: RAG_MODEL } },
  );
}

export function getRagIndexes(docId: string) {
  return request<{
    indexes: Array<{ id: string; status: string; progress_percentage: number }>;
  }>(`/convai/knowledge-base/${docId}/rag-index`);
}

/**
 * Deleting a document that still has a RAG index returns 409, so the index goes first.
 * `force=true` is belt-and-braces for indexes we did not record.
 */
export async function deleteKbDoc(docId: string, ragIndexId?: string) {
  if (ragIndexId) {
    await request<void>(`/convai/knowledge-base/${docId}/rag-index/${ragIndexId}`, {
      method: "DELETE",
    }).catch(() => {
      /* index may already be gone; the forced delete below is the real guard */
    });
  }
  await request<void>(`/convai/knowledge-base/${docId}?force=true`, {
    method: "DELETE",
  });
}

/**
 * Deleting an agent is permanent and is not implied by deleting anything in Convex — an agent
 * row removed from the database leaves its ElevenLabs counterpart running and billable. Every
 * teardown path has to call this explicitly.
 */
export function deleteAgent(agentId: string) {
  return request<void>(`/convai/agents/${agentId}`, { method: "DELETE" });
}

// --- Phone numbers --------------------------------------------------------

export type ElevenLabsPhoneNumber = {
  phone_number?: string;
  phone_number_id?: string;
  label?: string;
  assigned_agent?: { agent_id?: string; agent_name?: string } | null;
};

export async function listPhoneNumbers(): Promise<ElevenLabsPhoneNumber[]> {
  // The endpoint returns a bare array; tolerate a wrapped shape in case that changes.
  const res = await request<ElevenLabsPhoneNumber[] | { phone_numbers?: ElevenLabsPhoneNumber[] }>(
    "/convai/phone-numbers",
  );
  return Array.isArray(res) ? res : (res?.phone_numbers ?? []);
}

/**
 * Imports a Twilio number into ElevenLabs. The SID and token are forwarded to ElevenLabs only
 * (it uses them to repoint the number's voice webhook); callers must read them from server-side
 * env and never log or return them.
 */
export function importTwilioPhoneNumber(input: {
  phoneNumber: string;
  label: string;
  sid: string;
  token: string;
}) {
  return request<{ phone_number_id: string }>("/convai/phone-numbers", {
    method: "POST",
    body: {
      provider: "twilio",
      phone_number: input.phoneNumber,
      label: input.label,
      sid: input.sid,
      token: input.token,
    },
  });
}

export function assignPhoneNumberAgent(phoneNumberId: string, agentId: string) {
  return request<unknown>(`/convai/phone-numbers/${encodeURIComponent(phoneNumberId)}`, {
    method: "PATCH",
    body: { agent_id: agentId },
  });
}

// --- Account --------------------------------------------------------------

export function getSubscription() {
  return request<{ tier: string; character_count: number; character_limit: number }>(
    "/user/subscription",
  );
}

export function listVoices() {
  return request<{ voices: Array<{ voice_id: string; name: string }> }>("/voices");
}
