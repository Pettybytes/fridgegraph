# Voice round-trip — mounted UI (Kendra)

Completes the required real round-trip through the **mounted** `RosinaVoiceButton` (#82).

## Revisions (recorded separately)
- **UI revision:** `origin/main` **`78406d76c6b6a20a9edaafe512139b9635ddc91b`** (78406d7), served from this worktree on `127.0.0.1:5192` (live, no `VITE_DEV_MOCK_AUTH`). The `RosinaVoiceButton` mount is present in `RosinaPanel.tsx`.
- **Backend revisions:** Bentley's — unchanged by this capture. Reachable during the window: voice-turn `127.0.0.1:4118`, Rosina `:4200`, GraphQL `:4010`, demo `:4008`. I did not retarget or alter any backend session.

## Input source
**Browser-injected FIXTURE audio — not a physical microphone.** Chromium launched with
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=/tmp/kendra-voice.wav`.
The WAV is macOS `say` TTS of "What is on Nora's calendar today?" (48 kHz mono PCM16), a fictional prompt — no real person's voice.

## Result (as Kendra, signed in through the real picker)
audio in → **transcript in the conversation** → **Rosina reply text** → **audible playback**.
- Server transcript (ASR `muse-voice-transcribe-1.0`): *"What is Nora's calendar today? What is on Nora's calendar today? …"* (the fixture, looped during the listen window).
- Rosina reply (in the panel conversation): *"No records are available to this view for Nora today. The calendar shows no entries for Nov 1."*
- Audio: `audioBase64` returned (`audio/mpeg`), TTS `eleven_multilingual_v2`, voice `uG1JFy6xppqckhHCs2KG`; the component entered **speaking** and rendered the **Stop audio** control — playback started.

## Checks
- **No duplicate turn:** exactly **1** `POST /voice/turn` and **0** `POST /api/rosina` from the browser. `/voice/turn` already ran Rosina; the transcript was never re-sent through the text handler.
- **Proposed actions require explicit confirmation:** this info query returned `actions: []`, so there was nothing to confirm and nothing auto-fired. The component hands any `actions` to the panel via `onReply` to render as cards the parent taps — it never confirms itself (unit-tested: "report-once, no duplicate turn, no auto-confirm").
- No mutation was performed (a calendar read), so **nothing to restore**.

## Frames
`01-panel-idle.png` · `02-listening.png` (live level meter from the fixture mic) · `03-processing.png` (single buffered state) · `04-reply.png` (reply in the conversation, Stop-audio + voice-replies toggle + credit line).

No tokens, no raw audio bytes, and no signed URLs appear in any artifact.
