# Evidence — Browser voice conversation (headline demo)

Branch `feat/voice-conversation`. Scope: browser `/voice/*` and its web integration. The separate
`/voice-turn` caregiver webhook is UNCHANGED (no outbound phone/SMS/workflow changes). Live provider
proof is coordinated **after Bentley's actual provider-window receipt** — this record covers what is
implemented and proven with local/mocked dependencies, plus the measurement plan and targets.

## What changed

**One shared controller.** `VoiceProvider` (App-level) instantiates a single `useRosinaVoice`
controller. Both the Today mic and the panel mic drive it — no duplicate recordings, no synthetic
clicks. Today consumes a *stable* start handle (`useVoiceStart`) so an idle surface never re-renders
on voice state; the panel mic consumes the reactive controller.

**One tap.** Tap starts listening, tap again stops and sends — identical on desktop and touch. The
old `onTouchStart`/`onTouchEnd` pair (which could clip a short tap into near-empty audio) is removed.

**A real conversation.** Voice turns now carry the SAME bounded history as text turns (client sends a
bounded, base64 `X-Rosina-History` header; the server decodes and forwards it to Rosina instead of the
old `history: []`). Each turn runs Rosina exactly once; the transcript/reply are inserted into the live
thread via callbacks — never re-sent through the text path.

**Conversation mode.** Listening → Processing → Speaking → Listening with real end-of-speech detection
(silence after speech) + a bounded recording cap; the mic is paused during playback (Rosina never
transcribes herself); re-arm happens ONLY after playback actually completes and only while the
conversation is active; a persistent **End conversation** control; a tap during speech interrupts and
starts a fresh listening turn. Close/switch/cancel tears everything down and discards late results;
never re-arms after cancellation or error. A late `getUserMedia` resolution after teardown releases the
stream immediately.

**Silent failures fixed.** The frontend previously ignored `ttsError`. Now a TTS failure keeps the
text answer, shows audio-unavailable, and offers a speech-only retry (`POST /voice/speak`) that
re-synthesizes WITHOUT re-running Rosina or its tools. Structured error codes are distinguished
(`ASR_UNAVAILABLE`→transcribe, `TRANSCRIPT_EMPTY`→no-speech, `ROSINA_UNAVAILABLE`→model,
`MCP_UNAVAILABLE`→mcp, TTS→audio-unavailable) with calm, specific copy; typing always remains available.
"Speaking" shows only once playback starts; "Listening" only with a live mic. The caller is
authenticated before any paid provider work; keys stay server-side.

**Voice.** Default ElevenLabs voice set to the public prebuilt **Sarah** id `EXAVITQu4vr4xnSDxMaL`
(the previous default `uG1JFy6xppqckhHCs2KG` was NOT verified to be Sarah). `ELEVENLABS_VOICE_ID`
overrides it. **Owed:** confirm the resolved voice's name is "Sarah" live (GET `/v1/voices/{id}`).

## Latency — plan and targets (NOT claimed results)

The server measures and logs per request (request id + stage ms + status, never audio/transcript/
tokens): `asrMs`, `rosinaMs`, `ttsMs`, `serverTotalMs`, and returns them in the turn response. The
client adds `speechEndToReplyMs` and `speechEndToAudioMs` (end of user speech → first reply audio).

Targets from end of user speech to first meaningful reply audio: **≈ ≤ 3 s simple, ≤ 6 s tool-backed**.
These are targets, not measured results. Cold/warm samples and per-stage numbers will be recorded in
Bentley's provider window (below). Planned bottleneck work: skip tools for greetings, parallelize
independent authorized reads, and consider streaming where provider contracts support it — never
bypassing identity checks, output guards or confirmation lanes for speed.

## Tests (local / mocked; `npx vitest run src/features/voice`)

`useRosinaVoice.test.tsx` + `RosinaVoiceButton.test.tsx` cover: one-tap capture; touch behavior (a
touch gesture never starts a clippable recording; a tap does); permission-resolution-after-cancel
releases the stream; conversation history is sent (`X-Rosina-History`); end-of-speech auto-send and
silence-never-sent; TTS failure keeps the text answer + speech-only retry (no second Rosina turn);
blocked autoplay → needs-play → Play; tap-to-interrupt during speech; conversation auto-re-arm only
after playback; persona/child change discards late results and resets; mic-denied / rate-limited copy.
Server: `ops/voice-helpers.test.mjs` proves the history passthrough (decode/normalize/bound; UTF-8).

## Owed in the live provider window (coordinate after window receipt)

- Three-turn spoken conversation recording: greeting → authorized question → contextual follow-up.
- Measured cold/warm stage timings vs. the targets above; the tested browser and any platform limits.
- Confirm the ElevenLabs voice id resolves to "Sarah".
