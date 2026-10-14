# ElevenLabs Voice Agent + Dashboard — Design

**Date:** 2026-07-29
**Status:** Approved, scaffolding in progress

## Goal

A browser-based voice agent (customer support / FAQ) with a self-hosted dashboard that
operates it end to end: place calls, watch live transcripts, browse call history, edit the
agent's prompt and voice, manage the FAQ/docs the agent answers from, and track usage against
the free-tier cap.

Single user, runs on localhost, no login.

## Decisions

| Question | Decision |
|---|---|
| Call channel | Browser mic only (WebRTC). No phone number, no Twilio. |
| Dashboard | Self-hosted Next.js app, not ElevenLabs' UI. |
| Backend + DB | Convex. |
| Knowledge source | Convex is source of truth; docs synced up to the ElevenLabs knowledge base. |
| Transcripts | Streamed client-side from the React SDK into Convex during the call. |
| Architecture | Convex-centric: Convex actions are the only caller of the ElevenLabs API. |
| Doc sync trigger | On save, immediately. |

## Constraints

- **ElevenLabs Free tier: 15 agent-minutes per month**, 4 concurrent calls. Not per-day —
  15 total. Build and verify text-side first; spend real minutes only on final smoke checks.
- **No commercial license on free tier.** Demo/portfolio only.
- LLM (`gemini-2.0-flash`) and TTS are bundled into those minutes. No OpenAI key needed.
- **The API key must carry `convai` read+write scope.** A default-scoped key returns 401
  `missing_permissions` on every Agents endpoint. Also needs User→Read for the usage meter
  and TTS→Read for the voice picker.

## Stack

Pinned from `elevenlabs/examples` → `agents/nextjs/quickstart/example` (620★, actively
maintained; all community ElevenLabs starters are ~1.5 years stale and still import the
pre-rename `@11labs/react` package).

- Next.js 16.1.6, React 19.2.3
- Tailwind v4 + shadcn
- `@elevenlabs/react` ^1.1.0 — browser WebRTC session
- `@elevenlabs/elevenlabs-js` ^2.43.0 — server SDK, used inside Convex actions
- Convex — DB, actions, scheduler
- pnpm, with the quickstart's `livekit-client@2.16.1` override retained (WebRTC breaks without it)

## Architecture

Three processes, one secret.

**Browser (Next.js client)** — holds no secrets. Talks to Convex via `useQuery`/`useMutation`,
and to ElevenLabs directly over WebRTC using a short-lived conversation token. Audio never
transits Convex.

**Convex** — sole holder of `ELEVENLABS_API_KEY`, stored via `npx convex env set` (never in
`.env.local`). Actions wrap the ElevenLabs SDK: `mintToken`, `createAgent`, `updateAgent`,
`syncDoc`. Queries and mutations serve the dashboard.

**ElevenLabs** — agent config, bundled LLM, TTS, knowledge base.

Next.js has **no `app/api` routes**. The quickstart's two route handlers
(`api/agent`, `api/conversation-token`) are deleted and their bodies ported into Convex actions.

### Call flow

```
browser → convex action mintToken(agentId)
        → conversationalAi.conversations.getWebrtcToken()
        → token returned to browser
        → useConversation() opens direct WebRTC session to ElevenLabs
        → SDK emits UserTranscript / AgentResponse events
        → each written to Convex via mutation
        → history page (subscribed to same table) updates live
```

## Data model

```
agents        elevenLabsAgentId, name, prompt, firstMessage, voiceId, updatedAt
conversations elevenLabsConversationId, agentId, startedAt, endedAt, durationSec, status
messages      conversationId, role ("user"|"agent"), text, isFinal, at
docs          title, body, kbDocumentId (nullable), syncState, syncError, updatedAt
usage         monthKey ("2026-07"), secondsUsed
```

`messages.isFinal` exists because the SDK emits tentative transcripts that are later
superseded. The UI renders tentative text greyed and **overwrites** rather than appends when
the final arrives — without this the transcript duplicates and stutters.

## Features

| Feature | Implementation |
|---|---|
| Call + live transcript | `useConversation()` + the quickstart's `live-waveform.tsx`; messages streamed to Convex |
| Call history | Convex query over `conversations` → `messages`; live-updating by default |
| Edit prompt / voice | Form → `updateAgent` action → SDK `agents.update` → mirrored into `agents` table |
| FAQ/docs editing + sync | Editor writes `docs`; mutation schedules `syncDoc` action → `POST /v1/convai/knowledge-base/text` → stores `kbDocumentId`, attaches to agent |
| Usage meter | Month-to-date seconds vs the 15-minute cap; warn at 12 minutes |

## Error handling

Doc sync is the only thing that can fail invisibly, so `docs` carries an explicit `syncState`
(`pending` / `synced` / `failed`) plus `syncError`, rendered as a per-row badge. Convex actions
retry on 5xx; 4xx surfaces the ElevenLabs message verbatim. Mic-permission denial and
token-mint failure render inline on the call screen rather than throwing.

## Testing

Convex functions are plain TypeScript — unit-test `syncDoc` and the usage rollup against a
mocked SDK. The WebRTC path cannot be meaningfully unit-tested; it gets one manual smoke
check. Given the 15-minute monthly budget, everything text-side is verified first and real
minutes are spent only on a final end-to-end run.

## Resolved: RAG works on the free tier

Verified 2026-07-29 by probing the live account with a correctly-scoped key. All returned 200:

- `GET /v1/user/subscription` → `tier: free`
- `POST /v1/convai/knowledge-base/text` → document created
- `POST /v1/convai/knowledge-base/{id}/rag-index` with `e5_mistral_7b_instruct` → status
  `succeeded`, 100%
- `POST /v1/convai/agents/create` with `knowledge_base` attached, `usage_mode: auto`
- `GET /v1/convai/conversation/token?agent_id=…` → valid JWT

The system-prompt fallback is **not needed**. Docs go to the real knowledge base with semantic
retrieval.

Test resources were deleted afterwards. Note for `syncDoc`'s delete path: deleting a document
that has a RAG index returns **409** — delete the index first, or pass `?force=true`.

## Verified API surface

```
POST   /v1/convai/knowledge-base/text                    { text, name }
POST   /v1/convai/knowledge-base/{id}/rag-index          { model: "e5_mistral_7b_instruct" }
GET    /v1/convai/knowledge-base/{id}/rag-index          → { indexes: [{ status, progress_percentage }] }
DELETE /v1/convai/knowledge-base/{id}/rag-index/{indexId}
DELETE /v1/convai/knowledge-base/{id}?force=true
POST   /v1/convai/agents/create                          conversation_config.agent.prompt.knowledge_base[]
DELETE /v1/convai/agents/{agentId}
GET    /v1/convai/conversation/token?agent_id={id}
```

RAG indexing is asynchronous (`status: new` → `succeeded`), so `syncDoc` must poll or schedule a
follow-up check rather than assuming the index is ready on return. This is what `docs.syncState`
tracks.
