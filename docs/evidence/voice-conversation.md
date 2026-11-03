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
client adds `speechEndToReplyMs` and `speechEndToAudioMs`. Both are **speech detection → audio**: the
clock starts when end-of-speech is DECIDED (VAD silence, duration cap or manual tap) and stops at first
reply audio. They deliberately EXCLUDE the configured silence wait, so they are **not** user-perceived
latency.

Targets use the same basis — **speech detection → first audio**: ≈ ≤ 3 s simple, ≤ 6 s tool-backed.
Do not report these as user-perceived. User-perceived latency adds the silence wait that precedes
detection: `speechEndToAudioMs + vad.silenceMs`, where `silenceMs` defaults to **1200 ms**
(`DEFAULT_VAD` in `web/src/features/voice/useRosinaVoice.ts`; `speechThreshold` 0.08, `minMs` 500,
`maxMs` 15000) and is **0 ms for a manual tap**. Any published number must name which basis it uses.
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

---

## Follow-up — hosting-blocker hardening (branch `fix/voice-auth-hardening`)

Corrections to the claims above where #180's implementation did not fully match, plus the auth fix
required before the app goes public.

**1. Caller verified before any paid provider.** #180 forwarded the bearer to Rosina (which verifies),
but ASR/TTS ran FIRST, and the voice server only length-checked the token. Now the browser-voice routes
(`ops/voice-browser.mjs`) VERIFY the JWT via the identity path (`ops/voice-auth.mjs` — the same Supabase
ES256 + JWKS + identity-map mechanism as `src/auth/verify.ts`) BEFORE the body is read and before ASR,
Rosina or TTS — on all three routes including `/voice/speak`. Missing / malformed / expired tokens
return 401 with ZERO provider calls (`ops/voice-browser.test.mjs`). Rate limiting is keyed by the
VERIFIED person id (not a token hash/length). The same verified bearer is still forwarded to Rosina, so
downstream per-caller authorization is preserved. (The server stays plain `node --env-file=.env …`; the
verifier mirrors `verify.ts` and must be kept in sync with it.)

**2. Single-flight capture + lifecycle.** Rapid taps during permission acquisition acquire the mic once
(an `acquiring` guard). Enabling conversation while already listening ADOPTS the recording; starting it
during processing/playback is one explicit transition; a new recorder/stream never overwrites an active
one without releasing it. `visibilitychange`→hidden and `pagehide` stop capture/playback and cancel
pending work, with NO automatic restart on return. The recording cap is a `setTimeout`, not an
animation frame (rAF is suspended in background tabs). Regressions covered in `useRosinaVoice.test.tsx`.

**3. Honest timing + Speaking.** `speechEndToAudioMs`/`speechEndToReplyMs` are measured from the moment
end-of-speech is DECIDED (VAD silence / duration cap / manual tap), not from `finishTurn`, so recorder
finalization + transport are included. `Speaking` is set only AFTER `audio.play()` resolves, with epoch
checks on both resolution and rejection (a late play after teardown never flips to Speaking). Latency
targets remain explicitly UNPROVEN until the provider window.

**4. History header bounded by UTF-8 bytes** (`encodeHistoryHeader`), not characters, so multilingual
history (CJK/emoji) cannot exceed request-header limits; the server also byte-bounds defensively
(`boundHistoryBytes`).

Verification: full web suite green; `ops/voice-browser.test.mjs` + `ops/voice-helpers.test.mjs` green;
`tsc -b` + `vite build` green. Live provider proof still owed after Bentley's window.
