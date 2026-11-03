# Three-phone story replay

This section is an **illustrative public fixture**, separate from authenticated family records. `story.ts` is the adapter boundary and explicit visibility manifest. Its fixed fictional date is Friday, October 30, 2026 in America/Detroit, within the proposed `docs/contracts/demo-history.md` anchor window. The contract does not yet define this exact scene; do not treat these events as a finalized backend payload.

The ordered beats are a teacher early-dismissal notice; Rosina's proposal; Kendra's approval to **request** pickup; Loretta's **offer**; Kendra's separate **confirmation**; caregiver and teacher authorization views; and a parent Today summary. None records physical pickup completion. The teacher projection contains only the notice and prototype authorization fields, not family conversation. There are no authenticated reads or API calls in the replay.

No approved Loretta audio was supplied. The fixture labels the voice-note beat but renders the illustrative spoken text only, without a waveform or fabricated timing. The Sound control stays visible and disabled. A future approved clip may be supplied through the `voice` prop with its verbatim transcript, measured duration and peaks derived from that audio; the master clock extends the voice beat rather than speeding up the clip.

Source art: Bryan's `backdrop-parent.png`, `backdrop-caregiver.png`, `backdrop-teacher.png`, and `backdrop-spare-2.png` in `~/Desktop/fridgegraph-refs/patterns/`. The originals are untouched. Responsive 640/1100px WebP derivatives were generated with `cwebp -q 72/74`; `backdrop-spare.png` is unused. No remote images or branded device artwork.

Standalone export: from `web/`, run `npx vite build --config vite.story-replay.config.ts`. The committed `story-replay-export/story-replay-preview.html` and its local `assets/` form an offline static bundle for local hosting, embedding, or capture. They contain only the public fictional fixture. The normal app build mounts the same component under Mission Control as “One plan, three perspectives.”
