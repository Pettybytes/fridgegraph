# Voice evaluation handoff

BRANCH: `feat/voice-evaluation`
WORKTREE: `/workspace/scratch/c437ee3b04d6/fridgegraph-voice-evaluation`
TASK: Embed an offline voice evaluation/tuning harness and adapt Rosina's actual action/timing output contract.
LAYER: ops, with operational README and CI entry points.
TOUCHED: `ops/voice-evaluation/**`, `.github/workflows/voice-evaluation.yml`, one link in root `README.md`.
DONE WHEN: `npm run typecheck`; `npm run check`; Python discovery in `ops/voice-evaluation` passes 42 tests; `node --import tsx --test ops/voice-evaluation/fridgegraph-contract.test.mjs src/rosina/streaming.test.ts` passes 19 tests; sample capture/selection exits 0 and the deliberately failing suite exits 1.
NOT DOING: Runtime/UI changes, auth/schema changes, provider calls, DB writes, deployment, Kong setup or an interview guide.
BLOCKERS: Real playback/interruption performance and Kong behavior are not measured by these offline checks. Current VoiceTimings provides decision-based durations, not physical speech-end/barge-in events.

## Review notes

- The reusable core is pinned in `UPSTREAM.md`; no separate checkout is needed to run it.
- Two integration checks invoke the real FridgeGraph voice handler and action catalog with stubbed provider boundaries. The Python tests include missing playback, wrong child/day, context false positives, interruption timing, required coverage, cache invalidation and held-out selection failures.
- Existing `src/rosina/streaming.test.ts` provides runtime tests for the existing tool-list/caller-context caches. The Python schema cache is a reference helper, not a replacement for those caches.
- Historical `docs/evidence/voice-conversation.md` describes an older 1200 ms VAD setting. Current source uses 350 ms; the new README records this distinction without rewriting historical evidence.
- Synthetic examples and reports are labelled. No baseline latency improvement is asserted. Reports and local captures are ignored.
- Keep the PR draft for Bryan's review under the repository branch policy. No merge or deployment performed.
