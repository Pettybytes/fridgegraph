# Three-phone voice follow-up · illustrative fixture

The app and static export use only `voice_three_phone_loretta` from `data/demo-voice/manifest.json`. The manifest marks it illustrative, with no linked job, response, attempt or event. Its 67,334-byte MP3 matches SHA-256 `e6a1b980b454009eb3461471b425564621a80fe020efa2eba2fc8a45e2db129c`. `web/scripts/sync-story-voice.mjs` verified the hash, copied that one clip, decoded it to measure 4,133 ms, and computed 48 equal-width RMS waveform peaks. The Muse transcript in the app is verbatim from the manifest, including `1.20` and repeated words. The three history-linked clips were not copied into `web/`; the static export contains one MP3.

The fixed story date is **Monday, November 2, 2026** in America/Detroit. `src/fixtures.ts` assigns Nora's Monday to Kendra and Thursday through Sunday to Andre. Every phone and story entry uses Monday. The offer, request and parent confirmation remain distinct illustrative steps; the UI says “pickup completion not recorded” once, in the footer.

## Captures

- 1440 × 900: [light](desktop-light.png) · [dark](desktop-dark.png)
- 390 × 844: [Parent](phone-parent.png) · [Caregiver](phone-caregiver.png) · [Caregiver dark](phone-caregiver-dark.png) · [Teacher](phone-teacher.png)
- [Offline static export, caregiver phone](export-phone.png)
- [Two-loop screen recording](two-loops.webm)

The video records the screen only; it has no audio track. In the real browser, after one user click on **Sound off**, the audio element was playing at 3.21 s during the first voice beat and reached 4.06 s during the next loop. A second capture of the final implementation ended at `data-loop-count=2`, `Sound on`, one completion caveat, and zero API/GraphQL/voice-service resource requests. The static export rendered 48 waveform bars, the exact manifest transcript, and only its local illustrative MP3. Reduced motion opened on the final static frames; user-initiated playback stops after one pass.

Tests and GitHub CI results are reported in the PR description. The earlier `web/evidence/story-replay/README.md` is the historical pre-audio receipt from #169 and is left intact.
