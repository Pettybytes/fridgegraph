# Evidence 60 — Orbit redesign backend (places, alert binding, close outcome, audience read)

> **Current expected value (post-#92/#96, measured 2026-11-02): `f022ccf8311e7561`.**
> The `823cb76928f50c9f` values below are the measurements **at that revision** and stay as recorded.

**Branch `feat/orbit-amber` from `main` `e3f2e3b`.**
Migrations **0053** (recorded places) and **0054** (close outcome + thank-you), applied 2026-11-01
inside the reserved W-ORBIT-B window and verified live; the stack was then restored to
`chore/stack-refresh-e3f2e3b` (`e3f2e3b`) and re-verified.

Facts kept separate on purpose:

| fact | value |
|---|---|
| serving code during the proof | `feat/orbit-amber` (4101–4107 + routers 4010/4012, recomposed supergraph) |
| schema after the window | **0053 = true, 0054 = true** (plus 0049–0052 unchanged) |
| serving code after restore | `e3f2e3b` (`chore/stack-refresh-e3f2e3b`) |
| post-restore health | `ops/stack-health.mjs` **HEALTHY (0 failing)**, cast `823cb76928f50c9f` |
| post-restore consumer reads | six of six PASS |

## Pre-flight (rolled back, no schema change)

- `ops/0053-dry-run.mjs` — **24/24 PASS**
- `ops/0054-dry-run.mjs` — **20/20 PASS**

Both run the migration inside a transaction and roll it back.

## Live proof

`ops/orbit-redesign-proof.mjs` — **32/32 PASS**, receipt `docs/evidence/60-orbit-redesign.json`.
It runs through the browser proxy (5189) as real personas with real tokens, and ends with the
ordinary demo reset, so the sandbox finishes where it started.

### a. Recorded places
- a parent reads her child's three places, every label free of digits
  (`Eastside Sports Field`, `Lincoln Elementary School`, `Maple Grove Park`);
- a non-parent gets **0** for that child; another family reads **only its own** 2;
- a place from another family is **refused on write** (`ORBIT_PLACE_NOT_YOURS`);
- the label set is **curated**: a label with a street number and a label with a street word are both
  refused by `recorded_place_catalog`'s checks (dry run), and **no write path accepts a label at all**
  — places are seeded and reset by SECURITY DEFINER helpers only.

### b. Alert binding
- the preview names the place and the time: *"… Last seen: Eastside Sports Field at 10:00 AM."*;
- changing the place changes the hash (`eab0d1b9 → 40a8aa11`) and the wording;
- changing **only the time** changes the hash;
- a preview minted before either change **cannot activate** (`ORBIT_DRAFT_STALE`);
- a place typed into a description field is still refused (`ORBIT_SHARE_HAS_LOCATION`) — location
  never enters the free-text fields.

### c. Close outcome
- status stays **CLOSED**; `close_outcome = FOUND_SAFE`;
- only a parent closes: an audience member is refused (`UNAUTHORIZED`);
- `WITH_ME` never closes — the alert is still `ACTIVE` after Loretta's response;
- an outcome other than `FOUND_SAFE` is refused, and an outcome cannot exist on a non-closed alert
  (both proven in the 0054 dry run against the constraint itself);
- **the thank-you is idempotent**: a retried close returns the same alert and writes no new
  `thankyou_at` (dry run compares the timestamps byte-for-byte).

### d. Audience read
- an audience member still sees the alert **after** the close — the read gate is the frozen
  membership row, not the status (this was a real defect found here: the 0032 policy gated the
  audience on `status = 'ACTIVE'`);
- they see the close outcome and the thank-you;
- they see **only their own** response and **only their own** audience row;
- the location is visible exactly to the frozen audience: Loretta sees it, Dana (no membership, no
  audience row) gets the same empty answer a nonexistent alert gives.

### e. SMS deep link
`docs/n8n/fridgegraph-orbit-activation-sms.workflow.json` — **ships inactive**. The link is
`/orbit?persona=…&alert=…`; those two parameters choose where to land and grant nothing — access
still comes from the demo-session flow and the caller's real bearer. No token in the link, no phone
number in the file (the recipient is a GHL contact id supplied at run time), and the send node has no
credential in the file.

### f. Reset and checksums
- `reset_demo_orbit` now calls `reset_demo_places`, so **both** `/__reset` and resetDemo restore the
  places (11 seeded places) and clear the alerts;
- live: after the reset the same parent reads 3 places again and `orbitStatus` has no alert;
- **the v1 baseline checksum contract is unchanged** — `recorded_places` was deliberately NOT added
  to `TABLES` in `scripts/db.ts`, so no v1 key changes. Places are asserted explicitly instead
  (count + curated labels + reset restoration). No v1 checksum changed, and none was replaced.

## Restore

The alt subgraphs and both routers were restarted on `chore/stack-refresh-e3f2e3b` with the previous
supergraph, then re-verified: HEALTHY, cast `823cb76928f50c9f`, six consumer reads 6/6. The window was
then released in `docs/handoff/HANDOFF.md`.

Because 0053/0054 are additive, the restored `e3f2e3b` code still works against the new schema:
`draft_orbit_share` gained defaulted parameters and `close_orbit_alert` gained a defaulted outcome, so
the old 7-parameter / 1-parameter calls resolve to the new functions.
