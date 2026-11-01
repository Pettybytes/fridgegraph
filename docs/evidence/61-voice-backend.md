# Evidence 61 — Browser voice backend (audio → Rosina → speech)

**Branch `feat/voice-call-backend` from `main` `e3f2e3b`.**

`ops/voice-turn-server.mjs` (127.0.0.1:4118) was **extended**, not duplicated. The existing
`/voice-turn` route (GHL Custom Action, static secret, availability-only) is untouched; two routes
were added to the same process and port:

| route | body | returns |
|---|---|---|
| `POST /voice/transcribe` | audio bytes | `{ text, model }` |
| `POST /voice/turn` | audio bytes, or JSON `{ text }` | `{ transcript, transcriptSource, reply, actions, models, audioBase64, mimeType, ttsError }` |

## Identity — the point of the whole design

Both routes require the caller's own bearer. `/voice/turn` forwards **that** bearer to the Rosina
service (4200), which forwards it to the MCP server, so transcription, Rosina's tools and any
reviewed action all run as the signed-in caller. A GHL webhook credential is never accepted on this
path and is never used as a substitute for the caller.

`ELEVENLABS_API_KEY` and `META_API_KEY` are read server-side only. Neither is returned to the
browser, and the response carries audio, not the key that made it.

## Rate limits

Both routes: **12 turns/minute per caller** (`VOICE_RATE_LIMIT_PER_MIN`), keyed by a SHA-256 of the
bearer (no claims decoded, no token stored or logged). Rosina applies its own 20/min per person on
top. Measured: **6 of 16 parallel turns answered 429**.

## Proof — `ops/voice-backend-proof.mjs`, 7/8

| result | check |
|---|---|
| PASS | an anonymous turn is refused (`401`) |
| PASS | a signed-in turn succeeds (`200`) |
| PASS | it answers as **Kendra** — "Leo Ellison, Max Ellison, and Nora Ellison" — through the existing Rosina turn |
| PASS | the reply is **real speech from ElevenLabs**: 85,724 bytes of `audio/mpeg`, voice `uG1JFy6xppqckhHCs2KG` |
| PASS | the models are recorded in the response (`eleven_multilingual_v2`, that voice) |
| PASS | the fixture clip exists (33,061 bytes, generated with the same voice) |
| **FAIL** | **the fixture clip does not transcribe — `ASR 502: Malformed request`** |
| PASS | the turn route rate limits a burst (6 of 16 → 429) |

Receipt: `docs/evidence/61-voice-backend.json`.

### The blocker, stated plainly

`POST https://api.meta.ai/v1/asr/transcribe` exists and authenticates, but its request schema is not
documented anywhere in this repo and I could not derive it. What the API said, in order:

1. multipart with `file` + `model` → **"Both a 'request' and an 'audio' part are required"** (the
   part names are right);
2. `request` + `audio` → **"You must specify the 'audioEncoding' field"** (the field name is right);
3. with `audioEncoding` present, every value I tried → **"Malformed request"**.

Attempted values: `MP3`, `mp3`, `MP3_44100_128`, `mp3_44100_128`, `mp3_22050_32`, `LINEAR16`,
`AUDIO_ENCODING_LINEAR16`, `WAV` (this one returned *"Bad request"* instead), `pcm_16000`; `request`
sent both as a plain field and as an `application/json` blob; audio sent as the MP3 and as a
16 kHz mono WAV. Models tried: `muse-voice-transcribe-1.0`, `muse-spark-1.3`, `whisper-1`.

The server reports the refusal verbatim (`{ error: 'ASR_UNAVAILABLE', status, detail }`) rather than
inventing a transcript — **no fallback pretends to have heard anything**. The text-mode body
(`{ text }`) exists so the rest of the pipeline is usable and provable today.

**Not attempted:** the realtime path `wss://api.meta.ai/v1/asr/realtime`. It needs a streaming
protocol handler and a browser audio worklet; it is the natural next step once the batch schema (or
the realtime event schema) is confirmed.

## What Bryan must do by hand

1. **Add the voice to "My Voices"** in ElevenLabs and accept the voice terms — `uG1JFy6xppqckhHCs2KG`
   is used successfully by the API today, but it is not on the account's own list, so a plan or
   permission change could take it away silently.
2. **Confirm the Muse ASR schema** — either the batch `request` JSON fields
   (`audioEncoding` + whatever else) or authorise the realtime `wss` implementation. Until then
   audio-in is wired but refuses loudly.
3. Nothing else: the workflow file `docs/n8n/fridgegraph-orbit-activation-sms.workflow.json` (PR B)
   ships inactive, and this PR adds no sending path.
