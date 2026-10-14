/**
 * Parser for ElevenLabs' post-call webhook when it is sent in OpenTelemetry (OTLP) format
 * (`type: "post_call_transcription_otel"`).
 *
 * The workspace `transcript_format` setting kept reverting to `opentelemetry` regardless of
 * the dashboard toggle, so rather than fight the setting we parse what actually arrives.
 * Shape verified against a real captured payload on 2026-07-30.
 */

type OtlpValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};

type OtlpAttribute = { key: string; value: OtlpValue };

type OtlpSpan = {
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: OtlpAttribute[];
};

function attrValue(value: OtlpValue | undefined): string | number | boolean | undefined {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  return undefined;
}

function attrMap(span: OtlpSpan): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const a of span.attributes ?? []) {
    const v = attrValue(a.value);
    if (v !== undefined) out[a.key] = v;
  }
  return out;
}

export type ParsedCall = {
  conversationId: string;
  callerNumber?: string;
  durationSec?: number;
  startedAt?: number;
  summary?: string;
  summaryTitle?: string;
  terminationReason?: string;
  transcript: Array<{ role: "user" | "agent"; text: string; index: number }>;
};

export function isOtlpPayload(payload: unknown): boolean {
  const p = payload as { type?: string; data?: { otlp_traces?: unknown } } | undefined;
  return Boolean(p?.data?.otlp_traces) || p?.type === "post_call_transcription_otel";
}

export function parseOtlp(payload: unknown): ParsedCall | null {
  const data = (payload as { data?: Record<string, unknown> })?.data;
  if (!data) return null;

  const conversationId = data.conversation_id as string | undefined;
  if (!conversationId) return null;

  const spans: OtlpSpan[] = [];
  const traces = data.otlp_traces as
    | { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }> }
    | undefined;
  for (const rs of traces?.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      spans.push(...(ss.spans ?? []));
    }
  }

  const result: ParsedCall = { conversationId, transcript: [] };

  for (const span of spans) {
    const attrs = attrMap(span);

    // The root conversation span carries the call-level metadata.
    if (span.name === "elevenlabs.conversation") {
      result.callerNumber =
        (attrs["elevenlabs.telephony.external_number"] as string) ??
        (attrs["elevenlabs.dynamic_variable.system__caller_id"] as string) ??
        (attrs["elevenlabs.user_id"] as string);

      const durationMs = attrs["elevenlabs.session.duration_ms"] as number | undefined;
      if (durationMs !== undefined) result.durationSec = Math.round(durationMs / 1000);

      result.summary = attrs["elevenlabs.analysis.transcript_summary"] as string | undefined;
      result.summaryTitle = attrs["elevenlabs.analysis.call_summary_title"] as string | undefined;
      result.terminationReason = attrs["elevenlabs.termination_reason"] as string | undefined;

      if (span.startTimeUnixNano) {
        result.startedAt = Math.round(Number(span.startTimeUnixNano) / 1_000_000);
      }
      continue;
    }

    // Turn spans carry one side of the conversation each.
    const index = (attrs["elevenlabs.turn.index"] as number) ?? result.transcript.length;
    const userText = attrs["elevenlabs.user.text"] as string | undefined;
    const agentText = attrs["elevenlabs.agent.text"] as string | undefined;

    if (userText) result.transcript.push({ role: "user", text: userText, index });
    if (agentText) result.transcript.push({ role: "agent", text: agentText, index });
  }

  // Turn index orders user/agent pairs; ties keep insertion order (user before agent).
  result.transcript.sort((a, b) => a.index - b.index);

  return result;
}
