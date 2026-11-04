# Demo replay

The Demo guide tab lazy-loads `RecordedReplay`. Its three silent H.264 videos share the parent
video's playback clock, with one separate Rosina narration element. A buffering track pauses the
whole group. Play, Pause, Replay and Sound control all tracks; changing the mobile phone selection
preserves time. Playback starts only on a user action, including with reduced motion enabled.

`recording.ts` describes the exports, captions and disclosure. The current exports are an
**incomplete rehearsal**, not the completed pickup story: the public app recorded the request and
TEST outreach, but no caregiver reply or final approval was captured. The map reported no shared
person locations. The narration stops before the uncaptured steps. The trace is an explanation of
observed UI events and call-chain context; it does not claim to be server telemetry.

The sources were captured with Playwright `recordVideo` at a 390×844 viewport and DPR 2. Video
frames are 390×844; screenshots are 780×1688. Reset demo completed before the run. Continuation
clips inspect the same run without another reset. All people and outreach are fictional/test data.

The Remotion project lives outside the app at `~/Remotion/fridgegraph-replay/edit`, with source
recordings and event timestamps in the sibling `capture` directory. `Replay` is the combined
34-second timeline; `Parent`, `Trace` and `Village` export the individual tracks. Replace the source
clips and their source trims in that timeline when a complete Playwright or Recordly run is ready.
Render H.264 at CRF 23 with preset `veryfast`, remux with `-movflags +faststart`, and export the first
frame as each poster. Keep the three clips the same duration and below 15 MB in total.

Exports live in `web/public/replay/`. Posters are immediately available; video sources are attached
when the player enters view or Play is pressed. The audio is the existing recorded ElevenLabs
asset, with playback unlocked by the Sound button. The current capture's limited narration window
is intentional and must be updated only when the missing steps have been captured.

Local preview: start Vite and open `/recorded-replay.html`. The previous illustrative version and
its standalone `/story-replay-preview.html` remain available for comparison. Mission Control and
the Demo guide navigation gate are unchanged.
