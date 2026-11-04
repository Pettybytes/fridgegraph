# Demo replay — "One plan, three perspectives"

An **illustrative public fixture**, separate from authenticated family records: no API calls, no
reads, every id fictional (`child_nora`, `job_01`, `att_01`). It replays demo journey A and lives on
its **own "Demo replay" nav tab, visible only in the Demo guide perspective** (gated in
`app/SignedInVillage.tsx`; Mission Control no longer carries it). Honestly labeled a replay.

The three phones share one master clock (`story.ts` holds every beat, keyed to the measured
narration segments in `assets/rosina-narration.json`):

1. **Parent (Kendra)** starts on the app home screen at t=0, then walks Nora's whole path: notice
   posted, Rosina's proposal, Kendra approves the outreach, the request goes to Loretta (a test
   caregiver, `TEST_RESPONDER`), her reply, Kendra's separate confirmation, the confirmed plan.
2. **Under the hood** types the real call chain in sync: Muse (Meta model) → Rosina agent → MCP
   tools (`MyChildren`, `ChildEvents`, `PickupCandidates`, `JobTimeline` from `ops/*.graphql`) →
   Apollo Router → coordination operations (`requestPickup`, `acceptPickup`, `approvePickup`). Ids
   are fictional; a test asserts no secret/token/credential pattern can appear.
3. **Village** shows the **real Village map** (`assets/village-map-real.webp` — real OpenFreeMap
   positron tiles captured from this app's own MapLibre map page, credited on screen) with the
   pickup route animating over real streets, then the Activity entry, then the Mission Control
   metric.

**Audio** is one preloaded element playing **Rosina's real ElevenLabs voice**. The five narration
lines were generated once through the app's own voice path (`POST /voice/speak`, authenticated as
the fictional Kendra demo persona) and committed as `assets/rosina-narration.mp3` — the same
server-configured voice the live app uses; no key or token is stored (see the json's `provenance`).
Sound is off until a user gesture; the first pointer gesture unlocks the element; a real
`NotAllowedError` shows a visible fallback; `AbortError` races retry; the element is paused and
rewound on each loop so nothing overlaps. The Rosina avatar beside the player uses the shared
`speaking` state only while her audio is actually playing.

Lazy-loaded; reduced motion renders the finished story statically with a user-initiated replay.
Mobile shows one phone behind perspective tabs; all three are populated from the first frame. Total
added weight: a ~280 KB mp3 + ~16 KB map webp, well under budget.

Regenerate the narration with `web/scripts/build-replay-narration.sh` **after** re-fetching the
ElevenLabs lines through `/voice/speak` (the script normalizes and concatenates committed per-line
audio; it never contacts a provider or holds a key). Capture a fresh real-map image from the live
map page at 390×844 when the map styling changes.

Standalone export: from `web/`, `npx vite build --config vite.story-replay.config.ts` rebuilds
`story-replay-export/` (offline static bundle for local hosting, embedding, or capture).
