# Evidence 42 — Orbit Alert, minimal slice (data + actions layer)

_Task O. Branch `feat/o-orbit` off `main` `0d80f00` (includes #29 + #31). Migrations **0031**
(coordination types) and **0032** (Orbit) applied. GraphQL reads/actions wiring, the authenticated
photo endpoint and the MCP tools are the next increment of this PR and are **PENDING**._

## 0031 — coordination type widening

`coordination_jobs.type` now accepts `PICKUP, INVITATION, ONBOARDING, CONSENT, ORBIT_ALERT,
SUPERVISION` (constraint located by definition, not by an assumed name). Pure widening: no behaviour
changes until a table/function behind a type exists. **CONSENT and SUPERVISION stay unbuilt.**

## 0032 — Orbit, minimal slice

| Table | Shape |
|---|---|
| `orbit_alerts` | id, job_id, child_id, created_by/at, activated_by/at, status (`PENDING_ACTIVATION`/`ACTIVE`/`CLOSED`), closed_by/at, `minimal_message`, `message_hash`, `draft_version`, share fields (`wearing` ≤80, `hair` ≤40, `carrying` ≤60, `distinctive` ≤80), `photo_id` (identity, never a URL), sandbox, fixture |
| `orbit_audience_members` | alert, person, `notify_order`, `notified_at`, `notification_outcome`, eligible, `eligibility_source` — **frozen at activation** |
| `orbit_responses` | append-only history: alert, person, `responded_at`, `response` (`WITH_ME`/`ON_WAY`/`CANNOT_HELP`); current = latest row per person |

**There is no location column anywhere**, verified by scanning `information_schema` for
location-shaped names (result: none). No coordinates, no place, no "last seen" field.

### Actions (SECURITY DEFINER; zero INSERT/UPDATE/DELETE grants to `authenticated`)

`draft_orbit_share(child, wearing, hair, carrying, distinctive, photo)` → a
`PENDING_ACTIVATION` draft, bumps `draft_version`, sends nothing; parent/guardian only.
`preview_orbit_share(draft)` → `message`, `draft_version`, `message_hash` (md5 over share fields +
photo identity + the frozen audience), `audience_size`.
`activate_orbit_alert(draft, version, hash)` → atomic job + audience freeze + ACTIVE; refuses a stale
version, a mismatched hash, empty audience, or location content; a unique partial index gives exactly
one ACTIVE alert per child.
`respond_to_orbit_alert(alert, response)` → audience members only, ACTIVE only, append.
`close_orbit_alert(alert)` → parent/guardian only; no response closes it.

### Location refusal

`_orbit_has_location()` is a conservative keyword detector (streets, roads, schools and school types,
parks, landmarks, transit, shops, hospitals, "near", "usually near", "last seen", "across from"…).
It runs at draft **and** at activation, so it does not depend on what the model produced, and a parent
confirmation cannot override it. **Honest limit:** a keyword detector cannot catch every place name;
it blocks the named classes and is backed by the structural rule that no location field exists.

### RLS

Parent/guardian full view of alerts, audience and the response history; an audience member sees only
their own audience row (while ACTIVE), their own responses, and the alert's message; the Demo guide
reads sandbox alerts read-only; nobody else sees anything. **Two defects found by the dry run:**
mutual policy references between `orbit_alerts` and `orbit_audience_members` caused **42P17**
(infinite recursion) and were replaced by SECURITY DEFINER helpers; those helpers must also be
**granted** to `authenticated`, because a policy is evaluated with the caller's privileges (without
the grant every row failed with **42501** instead of filtering).

## Dry run — `node ops/0032-dry-run.mjs` — 30/30 PASS, rolled back

| # | Proven |
|---|---|
| 1 | Dana (out-of-network) cannot draft; a parent's draft is `PENDING_ACTIVATION`; no audience rows and no job exist, so a draft sends nothing |
| 2 | preview names the child + "check-in not recorded", carries version/hash/audience size, contains no place words; stale version → `ORBIT_DRAFT_STALE`; mismatched hash → `ORBIT_PREVIEW_MISMATCH`; an edit after preview bumps the version and kills the old binding; the activated message equals the confirmed preview |
| 3 | location-bearing text refused at draft (`ORBIT_SHARE_HAS_LOCATION`), including "usually near…"; the detector flags a school name and leaves ordinary description alone |
| 4 | activation → ACTIVE + an `ORBIT_ALERT` job; audience exactly the policy list `p_dad,p_gma,p_bryan` in flat order (no ranking) with `notification_outcome = SIMULATED`; a second activation for the same child → `ORBIT_ALREADY_ACTIVE` |
| 5 | a lone `WITH_ME` does **not** close; a non-audience adult cannot respond (42501); a changed response appends a second row with the earlier one intact; UPDATE/DELETE refused by trigger (`ORBIT_RESPONSES_APPEND_ONLY`) |
| 6 | closure refused to an out-of-network adult and to an audience member; a parent closes it and `closed_by` is recorded |
| 7 | no orbit table has a location-shaped column |

## Applied shape (verified by `ops/0032-apply.mjs`)

RLS on all three tables (3 / 2 / 2 policies); `authenticated` has EXECUTE on all five actions;
no location-shaped columns.

## PENDING in this PR (not claimed)

- GraphQL: `orbitDraft`/`orbitPreview` mutations + `orbitAlert`, `orbitStatus` reads; catalog
  `changesData` confirm action; `checkInStatus` parent view + the 911 guidance text on every
  parent-facing read.
- **Authenticated media endpoint**: private bucket, EXIF/GPS stripped server-side, authority checked
  on EVERY request (parent/guardian, or frozen audience while ACTIVE), `Cache-Control: no-store`, no
  reusable signed URL, refused after closure.
- MCP `OrbitStatus` + `CheckInStatus` (read-only, no-oracle, no photo, no activate/close).
- Expected check-in fixture ("Nora home by 4:00", none recorded) under the additive fixture rule.
- Proofs against the live stack: audience-facing payload leakage, audience isolation, demo-session
  `DEMO_OUTREACH_REFUSED`, and the pickup suite unchanged (ORBIT_ALERT never entering ranking).

## Honest limits carried forward

- Keyword detection cannot see every place name; the structural guarantee is that no location field
  exists and that audience-facing payloads have no location source to read from.
- Previously downloaded photos cannot be recalled after closure; the endpoint only stops serving.
- Metadata stripping does not prove an arbitrary image contains no visual location clues — the demo
  photo will be a curated fictional illustration, and that is stated in the UI copy.
- `notification_outcome = SIMULATED` is bookkeeping, not delivery proof.

---

## Hardening (migration 0033, applied)

| Change | Why |
|---|---|
| `message_hash` is **SHA-256** (64 hex) over share fields + the photo's **content hash** + the **resolved** audience | binds the parent's confirmation to the exact preview they saw |
| `orbit_photos(id, child_id, owner_person_id, content_sha256)` + immutable trigger | a photo id is only usable by the parent who uploaded it, for that parent's child; bytes cannot change under the same id |
| `_orbit_can_see_alert()` replaces `_orbit_is_active()` | the helper answers only about the CALLER's own access, so a direct RPC cannot learn that an alert exists |
| policy `orbit_audience_own` recreated on the caller-scoped helper | dropping the old function first is required (2BP01) — the policy depends on it |

**Hash binding defect found by the dry run:** hashing the *frozen* audience table made every draft
bind an empty list (nothing is frozen before activation), so an audience change after preview went
unnoticed. The hash now covers the audience **resolved from policy**, and the proof catches the change.

### Location detection — how it works, and its limits

`_orbit_has_location(text)` is a conservative keyword detector, run at **draft** and again at
**activation** (so it does not depend on what the model produced, and a parent confirmation cannot
override it):

- **Street/route words:** street, st., avenue, ave., road, rd., boulevard, blvd, lane, drive, highway, freeway
- **Place types:** park, playground, plaza, mall, library, church/chapel/mosque/temple, center/centre, station/depot, hospital, clinic, pharmacy, market, grocery, cafe, restaurant, field, court, downtown
- **School types:** school, elementary, middle, academy, college, university, preschool, daycare, campus
- **Proximity/"last seen" phrasing:** near, nearby, "usually near", "last seen", "across from", "next to"
- **Address shapes:** block, apartment, apt., suite, zip, corner, intersection

Tricky cases asserted: **"grey Lincoln hoodie" is not flagged** (a brand/garment use), while
**"near Lincoln School"**, **"walking down Main Street"** and **"Lincoln Elementary"** are refused.

**Known limits (stated, not glossed):** a keyword list cannot catch every place name — a novel
landmark or an unusual spelling passes. The structural guarantee is that **no location field exists**
in the schema and no read path has a location source. When extraction is unsure, Rosina asks a
clarifying question and nothing ambiguous is activated — the activation path refuses only what it can
detect, so the detector is a safety net, not the primary control.

### Helper exposure — direct RPC calls, caller-supplied ids

| Call (as Dana, a non-audience adult) | Result |
|---|---|
| `_orbit_is_audience_member(<Kendra's alert>)` | `false` |
| `_orbit_can_see_alert(<Kendra's alert>)` | `false` |
| `_orbit_is_parent_of_alert(<Kendra's alert>)` | `false` |
| `_orbit_is_audience_member('oa_does_not_exist')` | `false` — **identical** to the hidden case, no oracle |
| direct row read of that alert | **0 rows** |
| as a real audience member | `true` only for their own membership |

### Photo binding

Own photo for own child → accepted; the other parent's photo → `ORBIT_PHOTO_NOT_YOURS`; another
child's photo → `ORBIT_PHOTO_NOT_YOURS`; changing bytes under the same id → `ORBIT_PHOTO_IMMUTABLE`;
the content hash is part of `message_hash`. Description-only Orbit stays available (photo is optional).

### Real concurrency — `node ops/orbit-concurrency.mjs` — 5/5 PASS

Two activations fired **simultaneously on separate connections** (committed state, tracked cleanup):
exactly one succeeded, the loser got `ORBIT_ALREADY_ACTIVE` (23505), exactly one `ACTIVE` alert existed
for the child, exactly one `ORBIT_ALERT` job was created, and cleanup left no orbit rows behind.

## Two results, reported separately

1. **No location columns.** PASS — `information_schema` scan across every `orbit_*` table returns no
   location-shaped column. This is the *structural* result.
2. **Audience-facing payloads tested for location leakage** (GraphQL, MCP, media endpoint, free-text
   fields, error responses). **NOT YET TESTED — this is the acceptance result and it is PENDING.**
   Those surfaces do not exist yet in this PR. The PR must not be marked ready until it passes.

---

## Controlled descriptors (migration 0034, applied) — the privacy guarantee

Free-text share fields are replaced by **controlled vocabulary**. The notification is generated ONLY
from validated values through the app-owned template; unmapped phrases never reach it and Rosina must
ask instead.

- `orbit_vocabulary(kind, value, version)` — 55 seeded values across `WEAR_COLOR`, `WEAR_GARMENT`,
  `HAIR`, `CARRY_COLOR`, `CARRY_ITEM`.
- Draft columns are the vocabulary fields (`wear_color`, `wear_garment`, `hair_desc`, `carry_color`,
  `carry_item`); `distinctive` is **retired** from the template, the payload and the hash.
- `draft_orbit_share(child, wear_color, wear_garment, hair, carry_color, carry_item, photo)` refuses any
  value not in the vocabulary with `ORBIT_VALUE_NOT_IN_VOCAB` — it does not "clean" text.
- `message_hash` (SHA-256) covers the **vocabulary values**, the photo's content hash and the resolved
  audience — not raw input.
- `_orbit_has_location()` remains as **defence in depth only**. It is not the guarantee; the closed
  vocabulary plus generated text is.

### Proof — `node ops/0034-dry-run.mjs` — 14/14 PASS (rolled back)

| # | Check |
|---|---|
| 1 | "yellow raincoat, purple backpack" generates `Wearing: yellow raincoat. … Carrying: purple backpack.` with `Hair: ponytail.` |
| 2 | `near Lincoln School`, `by Hartwell's`, free text in a color field, and a sentence in the garment field are all **refused** (`ORBIT_VALUE_NOT_IN_VOCAB`) |
| 3 | legacy `distinctive` text never reaches the message and does not change the binding hash |
| 4 | the delivered (simulated) notification equals the preview and is vocabulary-generated only |
| 5 | audience exposure (below) |

## `orbit_audience_for(childId)` exposure — caller-scoped

The function now answers **only** the child's parent/guardian (or the read-only guide on sandbox data).
Everyone else gets **no rows**, identical to a nonexistent child id.

| Caller | `orbit_audience_for('p_nora')` |
|---|---|
| Kendra (parent) | the list (`p_gma,p_bryan`) |
| Dana (out-of-network adult) | 0 rows |
| Loretta (audience member, not a parent) | **0 rows** |
| guide, NON-sandbox child | 0 rows |
| nonexistent child id | 0 rows — **identical** to the hidden cases |

## Photo claims, stated precisely

Stripping removes embedded metadata (EXIF/GPS). It does **not** remove visible landmarks, signs or
uniforms in the image itself. The demo therefore uses a curated fictional illustration with a neutral
background — never a real child — and the UI copy says so.

## Results, reported separately

1. **No location columns** — **PASS** (schema scan).
2. **Audience-facing payloads tested for location leakage** (GraphQL, MCP, media endpoint, free-text
   fields, error responses) — **PENDING, and this is the acceptance result.** #33 must not go ready
   until it passes.

---

## Audience question: why the list changed from `p_dad,p_gma,p_bryan` to `p_gma,p_bryan`

**It was a test-fixture difference, not a regression — and it exposed a real gap.**

| Where | Policy value inserted |
|---|---|
| `ops/0032-dry-run.mjs` | `p_dad,p_gma,p_bryan` — the "earlier" list |
| `ops/0034-dry-run.mjs` | `p_gma,p_bryan` — the pair seen later |
| `ops/orbit-concurrency.mjs` | `p_dad,p_gma`, then **deleted the row in cleanup** |

The live database had **zero** `orbit_notify_eligible` rows, so there was nothing to resolve outside a
test. `orbit_audience_for()` contains **no co-parent exclusion**: it filters only `person_id <> child`.
The co-parent is not notified separately; he is an ordinary audience member.

**Fix (fixture rule):** the Ellison policy `h_a → p_dad,p_gma,p_bryan` is now part of the additive
SIMULATED fixture (`createSimulatedOrbit()`), seeded by `seed:simulated`, removed by
`cleanup:simulated` (the rule name is the handle — `household_policies` has no marker column), and
checksummed separately. Group 4 takes ownership of the canonical seed later.

### Proof — `node ops/orbit-audience-proof.mjs` — 12/12 PASS

| # | Check |
|---|---|
| 1 | the Ellison policy is seeded on `h_a` and names the co-parent |
| 2 | Kendra resolves `p_dad,p_gma,p_bryan` (Andre **first**, `notify_order = 1`) |
| 3 | activation freezes exactly those three; **Andre has a row with `notification_outcome = SIMULATED` and a `notified_at` timestamp**; every member is recorded the same way |
| 4 | Andre — who is both parent and audience member — sees the whole frozen audience, including his own row (parents get the full view; that is the rule, not a leak) |
| 5 | Loretta, an audience member who is nobody's parent, sees **only her own row** and **cannot resolve the list** |
| 6 | Dana gets no rows, byte-identical to a nonexistent child (no oracle) |
| 7 | cleanup restores the baseline checksum **byte-for-byte** (`identical`); the demo policy is then re-seeded |

The earlier failing assertion was mine: I asserted Andre should see only his own audience row, but a
parent legitimately sees the full audience. The audience-member-only path is proven with Loretta.
