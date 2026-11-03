# Fridge Phase 2 compatibility — cancellation ownership

Implementation: `bde2cea35a4ee548c13669435b43f2d92546a833`, branch
`fix/web-fridge-compatibility`, based on `6a6289823e42a7916365a7447732d78c855816b8`.
Only the Phase 2 adapter and a new real-client regression file change application/test code.
Shared Session/Apollo client code remains owned by Wonder and was not edited. Fridge
interaction components, styles, route keys and authorization-snapshot clearing remain intact.
No shared process, migration, reset, grant or backend code was changed.

## Before: the actual app request, not a different-token comparison

Served app: `http://127.0.0.1:5189/#/fridge`; process cwd
`/Users/user/fridgegraph-web/6a62898/web`; assets `index-BM1VTN1f.js` and
`ConnectedFridge-Di3pV6km.js`. Its Vite proxy configuration forwards `/graphql` to
`http://127.0.0.1:4010/`. The untouched served build and the isolated branch share the same base.

`before-same-session.json` contains the exact outgoing operation and variables,
sanitized response shape, actual Apollo rejection, and the session/abort timeline.
The real picker supplied the session. Tokens/headers stayed in browser/process memory;
no trace, HAR, storage state, request-header log or video was recorded.

The cold direct entry was `#/fridge` → Explore as Kendra. The relevant measured times,
in milliseconds from navigation, were:

| Event | Time |
| --- | ---: |
| Picker login request | 825.4 |
| Session UI mounted, generation 1 | 856.7 |
| Compatibility fetch started | 1150.7 |
| Old compatibility fetch aborted | 1529.5 |
| Replacement Apollo query started | 1531.1 |
| Old fetch rejected | 1532.0 |
| Replacement Apollo query rejected | 1533.2 |

The replacement caller's own signal was **not aborted**. Apollo returned no result/data:
it rejected with `DOMException`, name `AbortError`, code `20`, message
`signal is aborted without reason`, no HTTP status/networkError/GraphQL errors.
The compatibility boundary consequently classified it `failed`.

Generation, persona and expiry stayed unchanged. One initial login and one session-shell
mount were recorded; no renewal or perspective switch occurred in this reproduction.
The failure is cancellation shared across independent callers, not a proven auth or session-churn fault.

The identical saved body, variables and Authorization headers were replayed through the
**same `/graphql` proxy with that same session**, changing only the already-aborted signal.
Replay returned HTTP **200**, no GraphQL errors, root `Query`, and both collections as arrays.
No fresh-token request was used as evidence for this comparison.

**MALFORMED required field: none.** The shape check was never reached by the rejected caller.
No missing field was accepted as ready. Additional real-client negatives explicitly reject
missing `__typename`, `goals` and `fridgeNotes`.

## Cause and narrow repair

`ConnectedFridge` deliberately keys its boundary on the authorized-child snapshot.
Completing `WebMyChildren` replaces the loading snapshot, unmounting the old boundary and
aborting its read. That privacy boundary remains unchanged. Apollo deduplicates by operation
and variables, not the caller's AbortSignal: the new mount can subscribe to the old aborted
fetch before its rejection has cleared from the in-flight table.

Each independently abortable Phase 2 read now sets request-local
`context.queryDeduplication: false`. The original auth link, session generation checks,
read-renewal policy, strict response shape, read-only fallback and mutation handling remain
unchanged. No mutation is retried or executed by the compatibility probe.

Two real-client regressions were **red before the repair**: replacement check returned
`failed`, and the remounted editor never became available. They use the production
`createGraphClient` auth link and an actual `HttpLink`, with a controlled fetch response;
no stubbed `client.query()` is substituted. The final file also covers independent goals/notes
abort signals, all three missing-field negatives, and mock server-confirmed create/edit/read
across fresh clients for two parent family contexts and one guardian context.

## After: isolated preview, shared app untouched

Preview: `http://127.0.0.1:5273`, built from implementation `bde2cea` with
`VITE_FRIDGE_EDITING_VERIFIED=true`. Port 5189 was not changed. Public build flag use here
is preview-only; deployment must preserve Bentley's verified existing flag set.

`after-kendra-read.json` shows the retained auth-snapshot remount:
`WebMyChildren` response at 2404.1 → old read aborted at 2408.2 → authorized snapshot ready
at 2410.0 → independent compatibility fetch at 2410.8 → HTTP 200 at 2671.6.
The live Apollo result contains `data`, root `Query` and both arrays. Generation stays 1.
No UI key, permission or cancellation guard was removed to obtain this result.

## Live reads versus mock persistence

`live-read-only-verified.json` records actual picker sessions and live reads:

| Perspective | Compatibility/read result | Write controls |
| --- | --- | ---: |
| Kendra | Ready, Nora | 2 |
| Andre | Ready, Nora | 2 |
| Dana | Ready, Jax | 2 |
| Rosa | Ready, Emma, guardian | 2 |
| Felicia | Ready, Taylor | 2 |
| Simone | Ready, Micah | 2 |
| Dwayne | Ready, Malik | 2 |
| Priya | Correct refusal | 0 |
| Loretta | Scoped read-only view | 0 |
| Demo guide | Correct refusal | 0 |

These checks performed **no domain mutations**. They prove compatibility and scoped controls,
not live note/goal persistence. Create/edit/save/fresh-client re-entry passed in the controlled
HttpLink regression; **live create/edit/save/refresh/re-entry is PENDING Bentley's reserved window**.
A reservation was requested; no live write was made without one.

The first read-only harness receipt remains `live-read-only.json`: it sampled limited-role
views too early and its raw prefix gate failed. The verified run waits for the rendered Fridge
and settled compatibility state, and for both parent creation controls.

In-process scanner: no full token matched any scanned file; no new 12-character prefix match.
One common JWT-header prefix occurs in unchanged `ops/voice-browser.test.mjs`; comparison
against the identical `HEAD` file confirms the baseline. Its raw-prefix gate remains false and
is recorded, not erased. The baseline-aware gate passes; no matching text or token fragment
is in the receipts. The earlier scanner attempt through the browser CLI could not import Node
filesystem APIs; the successful scanner ran inside the private Node browser harness instead.

## Verification

- Original adapter stub baseline: 18/18.
- New regression before fix: 2 failed / 3 passed, matching the observed cancellation failure.
- Focused adapter/client/mount tests after fix: 48/48 before the three persistence cases were added.
- Full web suite: 662/662 across 104 files; rerun on the implementation commit recorded separately.
- Root typecheck: pass.
- Web typecheck/build: pass. Initial new-test typecheck rejected an unsupported `exact` option;
  an anchored role-name regex preserves exact matching and the corrected build passes.
- Secret scan: pass, zero findings; final evidence scan recorded in the handoff.

Screenshots are functional before/after captures at 1440×900 and 390×844, plus Rosa's guardian
view. No visual restyling was part of this repair. Initial result receipts are preserved.

## Bentley deployment handoff

1. Review/apply implementation `bde2cea35a4ee548c13669435b43f2d92546a833` onto the intended
   web deployment revision, preserving the Fridge UI owner's newer interaction repairs and
   Wonder's shared session/client work. Source change is limited to
   `web/src/features/fridge/phase2Adapter.ts`; tests are `phase2Client.test.tsx`.
2. Run root typecheck, staged/tracked secret scan, web tests and web build. Keep existing
   production build flags; do not enable editing based solely on this patch. The compatible
   backend and migration verification remain a separate deployment gate.
3. Rebuild only the web artifact in Bentley's authorized window. No backend/router/MCP/schema
   or session-service restart/configuration change is required by this fix. Do not substitute
   another token or bypass the actual picker.
4. Reserve the live write acceptance window with its exact UTC deadline/revisions. For authorized
   parents/guardians across families: create a private note and goal, edit, wait for server save,
   refresh/re-enter and compare fresh records. Verify caregiver/guide restrictions and failed-save
   preservation. Remove only this proof's created records in the same reserved run; no reset.
5. Do not mark live persistence accepted until that run passes. This receipt is read-only live
   compatibility proof plus offline persistence proof, not a claim of deployment or live saves.

### Serving-identity correction

The directory label `6a62898` is not independent proof of the full served Git SHA: the 5189
copy has no `.git` metadata. `serving-identity-correction.json` records the verified SHA-256
hashes of its actual served assets and the absence of a preview `--config` override. The
`uiBase` in the initial JSON is the directory label/source comparison, not a runtime SHA proof.
The earlier sentence saying the served build and branch share the same base is superseded
by this qualification. The isolated preview is a verified build of implementation `bde2cea`;
it is **not** claimed to contain the Fridge UI owner's newer deployment-only interaction work.
Bentley must apply only the implementation commit onto the UI owner's current revision and
preserve those changes, not deploy this isolated tree wholesale. No claim is made about the
loaded backend process SHA from its checkout directory/HEAD alone.

Final local web rerun on implementation `bde2cea`: **662/662**, 104 files, 26.51 seconds.
Root typecheck and web typecheck/build passed; source commit secret scan: 1373 files, 0 findings.
