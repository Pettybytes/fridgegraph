# Demo replay

The Demo guide tab lazy-loads `DemoReplay`. It keeps the labeled illustrative replay until
`RECORDING.complete` is true. The recorded preview uses three silent H.264 videos. Both players
use one fully preloaded Rosina audio element as the master clock. Videos follow audio time; a
buffering video recovers independently without interrupting narration. Play, Pause, Replay and Sound control all tracks; changing the mobile phone selection
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

Exports live in `web/public/replay/`. The tab itself is lazy-loaded. Audio uses `preload="auto"`;
Play is disabled with a loading explanation until `canplaythrough` and the whole file is buffered.
Sound starts muted with “Tap to turn sound on”; toggling sound does not start playback or seek.
Only Replay seeks the narration. Both narration assets reuse the existing ElevenLabs recording,
padded with silence to cover the 34-second timeline. The incomplete capture uses only the first
19.8 seconds of speech, before any uncaptured approval claims.

Local preview: start Vite and open `/recorded-replay.html`. The previous illustrative version and
its standalone `/story-replay-preview.html` remain available for comparison. Mission Control and
the Demo guide navigation gate are unchanged.
