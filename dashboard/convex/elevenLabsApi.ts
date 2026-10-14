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
};

/** Turn-taking. Governs dead air and how readily the agent talks over the caller. */
export type TurnTuning = {
  /** Seconds of caller silence before the agent prompts again. */
  turnTimeout: number;
  /** "patient" is documented for flows that collect names, numbers, and addresses. */
  eagerness: "eager" | "normal" | "patient";
  /** Seconds of LLM/tool delay before speaking a filler instead of going silent. */
  softTimeoutSeconds: number;
  /** Rotated at random so the same filler isn't repeated within one call. */
  fillerMessages: string[];
  /** Backchannels that should not count as an interruption. */
  interruptionIgnoreTerms: string[];
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
};

/**
 * The shared body for create and update. These two used to be near-identical copies that
 * drifted apart field by field; building one object keeps a new setting from landing on
 * only one of the two paths.
 */
function conversationConfigBody(input: AgentConfig) {
  const [primaryFiller, ...extraFillers] = input.turn.fillerMessages;

  return {
    agent: {
      first_message: input.firstMessage,
      language: "en",
      prompt: {
        prompt: input.prompt,
        // Benchmarked 2026-07-30 against the alternatives: ~1.3s vs ~3.5s for
        // gemini-3.5-flash. Response latency dominates the feel of a voice call.
        llm: "gemini-3.1-flash-lite",
        temperature: 0,
        // Explicitly cleared: PATCH merges rather than replaces, so a stale
        // reasoning_effort left over from a different (auto-routed) model can otherwise
        // persist and 400 against gemini-2.0-flash, which doesn't support that field.
        reasoning_effort: null,
        // Voice replies should be a sentence or two; uncapped generation is a real
        // source of response latency.
        max_tokens: 250,
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
        },
      },
    },
    turn: {
      turn_timeout: input.turn.turnTimeout,
      turn_eagerness: input.turn.eagerness,
      interruption_ignore_terms: input.turn.interruptionIgnoreTerms,
      merge_with_default_ignore_terms: true,
      soft_timeout_config: {
        timeout_seconds: input.turn.softTimeoutSeconds,
        message: primaryFiller,
        additional_soft_timeout_messages: extraFillers,
        randomize_fillers: true,
        // An LLM-generated filler would add exactly the latency the filler exists to cover.
        use_llm_generated_message: false,
      },
    },
    tts: {
      voice_id: input.voiceId,
      model_id: input.voice.modelId,
      stability: input.voice.stability,
      similarity_boost: input.voice.similarityBoost,
      speed: input.voice.speed,
      expressive_mode: input.voice.expressiveMode,
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
      conversation_config: {
        ...conversationConfigBody(input),
        conversation: { text_only: false },
      },
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
    // Forces the agent to speak (e.g. "let me check that") before every call to this tool
    // instead of going silent while it waits — verified enum: 'auto' | 'force' | 'off'.
    pre_tool_speech: "force",
    api_schema: {
      url: def.url,
      method: "POST",
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

// --- Account --------------------------------------------------------------

export function getSubscription() {
  return request<{ tier: string; character_count: number; character_limit: number }>(
    "/user/subscription",
  );
}

export function listVoices() {
  return request<{ voices: Array<{ voice_id: string; name: string }> }>("/voices");
}
