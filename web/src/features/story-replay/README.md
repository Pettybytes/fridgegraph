# Three-phone story replay

An **illustrative public fixture**, separate from authenticated family records: no API calls, no
reads, every id fictional (`child_nora`, `job_01`, `att_01`). It replays demo journey A on the
Mission Control page as "One plan, three perspectives", honestly labeled as a replay.

The three phones share one master clock (`story.ts` holds every beat):

1. **Parent (Kendra)** starts on the app home screen, then walks Nora's whole path in one feed:
   notice posted, Rosina's proposal, Kendra approves the outreach, the request goes to Loretta
   (a test caregiver, `TEST_RESPONDER`), her reply, Kendra's separate confirmation, the confirmed
   plan. Approval precedes outreach; pickup completion is never claimed.
2. **Under the hood** is a dark trace panel that types the real call chain in sync: Muse (Meta
   model) -> Rosina agent -> MCP tools (`MyChildren`, `ChildEvents`, `PickupCandidates`,
   `JobTimeline` from `ops/*.graphql`) -> Apollo Router -> coordination subgraph operations
   (`requestPickup`, `acceptPickup`, `approvePickup`). Operation and field names mirror the real
   schema; ids and timestamps are fictional, and no secret, token or credential ever appears
   (guarded by a test).
3. **Village** draws the pickup route on a small map (Loretta -> school -> Nora's home), then the
   new Activity entry, then the Mission Control metric update.

**Audio** is one preloaded element for the whole replay (`narration.ts`). Rosina's narration is
synthesized locally (macOS `say`, voice Samantha, labeled on the page); segment s4 splices the
verbatim `voice_three_phone_loretta` illustrative clip (ElevenLabs stock voice) unchanged, so the
caregiver reply is the same recorded audio the demo has always used. Rebuild with
`web/scripts/build-replay-narration.sh`; measured segment times live in
`assets/replay-narration.json` and key the visual beats. Sound is off until a user gesture; the
first pointer gesture also unlocks the element, a rejected `play()` shows a visible fallback, and
the clip is paused and rewound on every loop so clips never overlap. The Rosina avatar next to the
player uses the shared `RosinaAvatar` `speaking` state only while her audio is really playing.

The component is lazy-loaded from `App.tsx` on the Mission Control route. Reduced motion renders
the finished story as a static frame with a user-initiated replay. On mobile, one phone shows at a
time behind perspective tabs; all three are populated from the first frame.

Source art: the sky backdrop derivatives documented in the repo (no remote images, no branded
device artwork; the phone frame is our own CSS). The legacy `voice-three-phone-loretta.*` assets
stay as the provenance source for the spliced clip and the reply waveform peaks
(`web/scripts/sync-story-voice.mjs` still regenerates them).

Standalone export: from `web/`, `npx vite build --config vite.story-replay.config.ts` rebuilds
`story-replay-export/` (offline static bundle for local hosting, embedding, or capture).
