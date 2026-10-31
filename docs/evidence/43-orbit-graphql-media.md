# Evidence 43 — Orbit: GraphQL, media, MCP, leakage acceptance

_Task O. Branch `feat/o-orbit`. Migrations 0031–0037 applied. **#33 is NOT ready:** the pickup
regression shows 4 failures that are not yet classified._

## GraphQL (built, live on router 4012 / coordination subgraph 4103)

Mutations `orbitDraft`, `orbitPreview` (a mutation by contract), `orbitActivate(draftId,
draftVersion, messageHash)`, `orbitRespond`, `orbitClose`; reads `orbitAlert`, `orbitStatus`,
`checkInStatus`. The 911 guidance is returned on every parent-facing payload and is an empty string
for audience members. Hidden alerts return `null`; an invisible child returns an empty status —
identical to a nonexistent id.

End-to-end as Kendra: draft → preview (message + 64-hex SHA-256 + audience 3) → activate (ACTIVE;
Andre/Loretta/Bryan recorded `SIMULATED`) → Andre responds `WITH_ME` → status `check-in not
recorded` → close (`CLOSED`).

**Wording:** `SIMULATED` + `notified_at` records a **simulated notification event**. It is never
proof that a person received anything; no real send exists in this slice.

## Media — `ops/orbit-media-proof.mjs` — 16/16 PASS

| # | Check |
|---|---|
| 0 | the fixture JPEG really carries an injected Exif/GPS segment |
| 1 | parent upload succeeds; response is `no-store` |
| 2 | **stored bytes contain no Exif/GPS marker**; recorded hash = hash of stored bytes; photo bound to child + parent |
| 3 | activation keeps the photo **identity only** — no URL |
| 4 | audience member served while ACTIVE (`no-store`); non-audience adult 404; no token 401 |
| 5 | audience member refused after closure; **parent still served** after closure |
| 6 | no storage URL or token in read payloads; after closure the audience member sees no alert |

**Metadata stripping is two-sided:** `sips` re-encodes, then a segment walk removes APP1–APPn and
COM. Re-encoding alone is insufficient — `sips` writes its own APP1 block, which the first attempt
left in place. Upload refuses (`METADATA_STRIP_UNAVAILABLE`) rather than storing unstripped bytes.

**Host dependency (recorded in HANDOFF):** stripping shells out to macOS `sips`. The server must run
on the Mac for Task H's tunnel hosting; if it moves, swap in a portable image library.

## MCP — `OrbitStatus`, `CheckInStatus` (read-only)

Eight tools now load: `OrbitStatus, CheckInStatus, JobTimeline, Attempts, ChildEvents,
AdultAvailability, EffectiveSchedule, PickupCandidates`. No mutation tool exists. `OrbitStatus`
returns status, audience counts, response counts and latest responses (parents see names; an audience
member's row set is RLS-limited to their own). No photo and no location. `CheckInStatus` is
parent-only and returns "check-in not recorded".

## Audience-payload leakage — THE ACCEPTANCE RESULT — `ops/orbit-leakage-proof.mjs` — 19/19 PASS

Audience-facing surfaces inspected: GraphQL as an audience member (Priya, who **independently holds
`schedule.read`**), GraphQL as a non-parent audience member (Loretta), GraphQL as an out-of-network
adult (Dana), MCP `OrbitStatus`/`CheckInStatus`, the media endpoint's refusal body, and an error
response.

- Priya sees only her own audience row and no other member's response; her own `childEvents` read
  still returns schedule detail — **Orbit adds nothing to it**.
- Dana's answer is identical to a nonexistent alert (no oracle).
- Scan results: **no place name, street, school, event title, "last seen", coordinate, or
  job/attempt detail** in any audience-facing payload.
- The message contains only vocabulary-generated text.

## Pickup regression — 24 PASS / 4 FAIL (BLOCKING)

`FRIDGEGRAPH_ROUTER=http://127.0.0.1:4012/ node --env-file=.env --import tsx ops/station06-verify.mjs`
after `db:reset` + `seed:simulated`:

| Check | Result |
|---|---|
| authenticated cannot consume an authorization | FAIL — status 404 |
| duplicate delivery changes nothing | FAIL — body `rejected_closed` |
| terminal job rejects a late accept | FAIL — body `rejected_closed` (test expects `rejected_state`) |
| state rejection recorded as REJECTED_STATE | FAIL — outcome `undefined` |

The failures reproduce on a clean reset, so they are not state drift. They are on the pickup path,
which Orbit does not touch, but **"unchanged" is unproven**: the comparison run against `main` could
not execute (the temporary worktree could not resolve `pg`). Until that comparison runs, or the four
checks are fixed on their own merits, #33 must not be marked ready.

## Demo outreach

`DEMO_OUTREACH_REFUSED` is enforced in the database (0025: `assert_outreach_allowed`,
`promote_attempt_to_real_consented`, `consume_real_call_authorization`, and the
`real_call_authorizations` insert policy) and proven by `ops/e2b-proof.mjs`, which I did not re-run in
this pass.
