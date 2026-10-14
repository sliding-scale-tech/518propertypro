# Making the agent voice sound human — research + audit

Researched 2026-08-23 against ElevenLabs docs, blogs, and third-party write-ups.
Audited against the live config snapshot of `agent_8901kyqecrwkerp9xzewyq31jtg0`.

**Symptom reported:** the voice sounds strange and lifeless ("ajeeb si awaz / mari hoi awaz").

---

## 1. What actually makes an ElevenLabs agent sound human

Four independent layers. A problem in any one of them makes the whole thing sound dead,
and our agent currently has a problem in **all four**.

| Layer | What it controls | Where it lives |
|---|---|---|
| TTS model | prosody, emotion, expressiveness | `conversation_config.tts.model_id` |
| Voice + its settings | timbre, stability, speed, clarity | `conversation_config.tts.*` |
| Turn-taking | pauses, interruptions, dead air | `conversation_config.turn.*` |
| Prompt / text going in | phrasing, numbers, pacing | system prompt + `text_normalisation_type` |

### 1.1 Model choice is the single biggest lever

Current ElevenLabs lineup (from the models doc):

| Model | Latency | Expressiveness | Notes |
|---|---|---|---|
| `eleven_v3_conversational` | ~280 ms | **Highest** — "most expressive, realtime speech synthesis model" | Powers Expressive Mode. Built for agents. |
| `eleven_flash_v2_5` | ~75 ms | High | 32 languages. The low-latency default. |
| `eleven_flash_v2` | ~75 ms | High | **English only. Oldest of the three.** ← we are here |
| `eleven_multilingual_v2` | Higher | Very high | Content creation, not realtime |
| `eleven_turbo_v2` / `v2_5` | ~75 ms | High | **Deprecated** — Flash is the replacement |

**Expressive Mode** (ElevenLabs, 2026) only runs on `eleven_v3_conversational`, where it is on by
default. It makes the agent "reflect intent, emotion, and emphasis without sounding scripted",
adapt tone to the caller in real time, and it ships an improved turn-taking system that reads
vocal cues (pace, volume, intonation) instead of a fixed silence threshold.

Caveats, both of which matter to us:

- It **does not preserve Professional Voice Clone (PVC) characteristics**.
- Expressive tag effects last ~4–5 words before delivery returns to normal.
- Same price as other agent TTS models (from $0.08/min) — no cost penalty.

### 1.2 Voice settings — the documented ranges

From the ElevenLabs Agents voice design guide:

- **Stability** — default 0.5. `0.30–0.50` = "more emotional, dynamic delivery but may
  occasionally sound unstable". `0.60–0.85` = "more consistent but potentially **monotonous**".
  Conversational sweet spot widely cited as **0.40–0.50**.
- **Similarity** — default 0.75. Higher = more clarity and fidelity to the source voice;
  **very high values can cause distortion artifacts**.
- **Speed** — default 1.0, range 0.7–1.2. "Most natural conversations occur at **0.9–1.1x**."
- **Style** — recommended to stay at 0 for most applications.

Critically: **a professional/cloned voice ships with its own tuned settings.** Running a PVC far
from its own recommended values is a common cause of "sounds off / uncanny".

### 1.3 `optimize_streaming_latency` — the quality killer

Documented levels:

| Level | Effect |
|---|---|
| 0 | Default, no latency optimizations |
| 1 | ~50% of the possible improvement |
| 2 | ~75% |
| 3 | Max latency optimizations |
| **4** | Max **plus the text normalizer turned off** — "best latency, but **can mispronounce e.g. numbers and dates**" |

For a leasing agent that reads out **rents, unit counts, dates and phone numbers all day**,
level 4 is close to a worst-case setting.

### 1.4 Turn-taking / conversation flow

- `turn_eagerness`: **Eager** for fast customer service, **Patient** "when collecting structured
  information like phone numbers, addresses, or email addresses", **Normal** as the default.
- `turn_timeout`: 1–30 s. Docs suggest **10–15 s** when the caller has to look something up.
- `soft_timeout_config`: when the LLM is slow, the agent speaks a filler ("let me think")
  instead of going silent. Docs suggest ~3.0 s. **Disabled = dead air on every tool call.**
- Interruption ignore terms ("okay", "mm-hmm") let backchannels pass without derailing the agent.
- Target end-to-end cycle: **under one second** (Scribe v2 ~150 ms + Flash v2.5 <75 ms + LLM).

### 1.5 Text going into the TTS

- `text_normalisation_type: "system_prompt"` (default) — the LLM is instructed to spell numbers
  out as words. Zero latency cost, but transcripts read "one thousand dollars" instead of "$1,000",
  and it only works if the LLM actually complies.
- `text_normalisation_type: "elevenlabs"` — ElevenLabs' own normalizer runs after the LLM.
  Transcripts stay clean, pronunciation is handled properly. Slight latency cost.
- Prompt-level: define tone **once**, briefly ("Speak in a friendly, conversational manner"),
  rather than repeating tone instructions throughout — repetition makes output sound scripted.
- Punctuation drives pacing. `<break time="500ms"/>` gives explicit pauses.
- **There is no `pitch` control** in ElevenLabs Agents. Prosody is shaped by model choice,
  stability, speed, and (on v3) audio tags — not by a pitch slider.

### 1.6 Telephony note

Twilio Media Streams are 8 kHz μ-law. `ulaw_8000` passes through with **no transcoding**;
`pcm_16000` requires a resample. Our agent is set to `pcm_16000` on both input and output
while serving a Twilio number.

---

## 2. Audit of our current config

Live values from the snapshot, scored against the research above.

### Voice: `ZMcTJJGIY9EuxIahNGel` = **"BeautifulBella"**

```
category:    professional          <-- Professional Voice Clone
labels:      female, middle_aged, american, gentle, conversational
description: "Sensual and loving but encouraging."
supported:   flash_v2, flash_v2_5, turbo_v2, turbo_v2_5, multilingual_v2
             ^^ NO eleven_v3 / eleven_v3_conversational
```

**The voice's own recommended settings vs. what we are running:**

| Setting | Voice's tuned default | We run | Delta |
|---|---|---|---|
| stability | 0.57 | 0.45 | −0.12 (less stable) |
| similarity_boost | **0.92** | **0.72** | **−0.20 — large** |
| speed | 0.77 | 0.96 | **+0.19 — large** |
| use_speaker_boost | true | *not set on the agent* | missing |
| style | 0 | n/a | ok |

A PVC run 0.20 below its similarity target loses fidelity to the source recording — that is
exactly the "uncanny / not-quite-right" texture. And +0.19 speed on a voice tuned for 0.77
makes a gentle voice sound rushed and clipped.

### Full findings table

| # | Setting | Live value | Problem | Severity |
|---|---|---|---|---|
| 1 | `tts.model_id` | `eleven_flash_v2` | Oldest, English-only, least expressive model. No Expressive Mode. | **High** |
| 2 | `tts.optimize_streaming_latency` | `4` | Text normalizer **off** → mispronounced rents, dates, phone numbers | **High** |
| 3 | `tts.similarity_boost` | `0.72` | PVC voice wants 0.92 | **High** |
| 4 | `tts.speed` | `0.96` | Voice tuned for 0.77 → rushed | **Medium** |
| 5 | `tts.stability` | `0.45` | In the documented conversational range; voice wants 0.57 | Low |
| 6 | `tts.expressive_mode` | `false` | Requires v3 conversational; inert today | **High** (blocked by #1) |
| 7 | `turn.soft_timeout_config.timeout_seconds` | `-1` (disabled) | Silence during every webhook tool call | **Medium** |
| 8 | `turn.soft_timeout_config.message` | `"Hhmmmm...yeah."` | Odd filler; also never fires while #7 is off | Low |
| 9 | `turn.turn_eagerness` | `eager` | We collect names + phone numbers; docs say **patient** for that | **Medium** |
| 10 | `turn.turn_timeout` | `7` | Fine, slightly tight vs. the 10–15 s suggestion | Low |
| 11 | `prompt.rag.enabled` | `false` | Our code RAG-indexes all 4 KB docs, then they go in as raw text | **Medium** |
| 12 | `tts.enable_phoneme_tags` | `true` | v3 SSML feature; inert on flash_v2 | Low |
| 13 | `text_normalisation_type` | `system_prompt` | Relies on LLM compliance; interacts badly with #2 | **Medium** |
| 14 | `asr.user_input_audio_format` | `pcm_16000` | Twilio is native `ulaw_8000` → extra transcode | Low |
| 15 | Prompt speaking-style rules | present, long | Already good — has anti-stock-phrase and pacing rules | ✅ |

### The core tension

**We cannot have both the best model and this voice.**

`eleven_v3_conversational` + Expressive Mode is the single biggest quality jump available.
But BeautifulBella is a **PVC**, it does not list v3 support, and Expressive Mode explicitly
does not preserve PVC characteristics. So it's a fork:

- **Path A — keep the voice:** stay on Flash, fix settings #2/#3/#4 to the voice's own tuned
  values. Cheap, low-risk, fixes "mari hoi awaz" but not "flat".
- **Path B — keep the voice, upgrade the model:** move to `eleven_flash_v2_5`. Newer, same
  ~75 ms, voice supports it. Modest gain.
- **Path C — go expressive:** switch to `eleven_v3_conversational` **and** pick a v3-capable
  conversational voice. Biggest jump to "human". Costs ~205 ms extra latency and loses Bella.

---

## 3. Codifying this

None of these fields are currently owned by code — `AgentConfig` in `convex/elevenLabsApi.ts`
only sends `voice_id` and `model_id`. Everything in the findings table lives only in the
ElevenLabs dashboard, which is why it drifts. Whatever we settle on should be added to
`AgentConfig`, the create/update bodies, and the `agents` table in `convex/schema.ts`.

---

## Sources

- [ElevenLabs Agents voice design guide](https://elevenlabs.io/docs/eleven-agents/customization/voice/best-practices/conversational-voice-design)
- [Models](https://elevenlabs.io/docs/overview/models)
- [Expressive mode (docs)](https://elevenlabs.io/docs/eleven-agents/customization/voice/expressive-mode)
- [Introducing Expressive Mode (blog)](https://elevenlabs.io/blog/introducing-expressive-mode)
- [Conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow)
- [Interaction models: Building natural human-AI dialogue](https://elevenlabs.io/blog/interaction-models)
- [Prompting guide](https://elevenlabs.io/docs/eleven-agents/best-practices/prompting-guide)
- [How to make TTS sound less robotic](https://elevenlabs.io/blog/how-to-make-text-to-speech-sound-less-robotic)
- [Why is my voice monotonous / too chaotic?](https://help.elevenlabs.io/hc/en-us/articles/13416017389329-Why-is-my-voice-monotonous-too-chaotic-doesn-t-sound-similar-etc)
- [Latency optimization](https://elevenlabs.io/docs/best-practices/latency-optimization)
- [Meet Flash](https://elevenlabs.io/blog/meet-flash)
- [Eleven v3](https://elevenlabs.io/blog/eleven-v3) · [Audio tags 101](https://elevenlabs.io/blog/v3-audiotags)
- [Connect Twilio to ElevenLabs Agents](https://elevenlabs.io/agents/integrations/twilio)
- [ElevenLabs Cheat Sheet 2026](https://www.webfuse.com/elevenlabs-cheat-sheet) · [Models compared](https://voxrater.com/insights/elevenlabs-models-compared/)

---

## 4. Decisions taken (2026-08-23)

### Measured latency, not quoted latency

Time-to-first-audio, 5 interleaved runs per model from the dev machine, same voice and text,
`optimize_streaming_latency: 3`:

| Model | Median | Min | vs fastest |
|---|---|---|---|
| `eleven_flash_v2_5` | **0.687s** | 0.672s | — |
| `eleven_flash_v2` | 0.717s | 0.703s | +30 ms |
| `eleven_v3_conversational` | 0.872s | 0.703s | **+185 ms** |

These figures include network round-trip from the dev machine, so the absolute numbers are
inflated; the *deltas* are what matter, and they line up with the documented ~75 ms vs
~280 ms inference gap.

### Final configuration

- **Model: `eleven_v3_conversational`, Expressive Mode on.** Chosen after an A/B listen
  against `eleven_flash_v2_5` on the same voice and settings. It is the slowest of the three
  by 185 ms, and that cost was accepted deliberately: it is the only model supporting
  Expressive Mode, and the warmth difference was audible. Dropping to `eleven_flash_v2_5`
  with `expressiveMode: false` buys the time back as a two-line change.
- **Voice: Jessica (`cgSgspJ2msm6clMCkdW9`)** — premade, American, female, "conversational".
  Premade rather than a professional clone deliberately: the previous voice was a PVC being
  run 0.20 below its own similarity target, which is what produced the uncanny texture.
  Note **Sarah does not support `eleven_flash_v2_5`** and was ruled out on that basis.
- **stability 0.45 / similarity_boost 0.75 / speed 1.0** — the documented conversational band.
- **`optimize_streaming_latency: 3`**, not 4. Level 4's only distinction is disabling the
  text normalizer, which is what was mispronouncing rents and dates. Level 3 keeps every
  other latency optimization.

### Deliberately not changed

- **`ulaw_8000` audio format.** The dashboard runs browser calls over WebRTC via `mintToken`;
  forcing 8 kHz μ-law would degrade that path to save one transcode on the phone path.

### Where "human" actually comes from here

Expressive Mode covers TTS prosody. The rest of the naturalness budget went into turn-taking
— patient turn-taking, backchannel pass-through, and fillers instead of dead air during tool
calls. On a phone call those matter at least as much as prosody does.

### The real latency bottleneck is not the voice

`gemini-3.1-flash-lite` is ~1.3 s of a ~1.7 s round trip. TTS inference is ~0.28 s of it.
Any serious attempt at a faster-feeling call has to start at the LLM, not the voice.
