# Evidence 63 — photo-descriptors endpoint: real authority, and no vision on refusal

**Date:** 2026-11-01 · **Window:** W-PHOTO-539a8b4 · **Serving code:** `539a8b4` (`origin/main`, #79)
**Receipt:** `63-photo-descriptor-authority.json` (23/23 PASS) · **Earlier failed run preserved:** `63-photo-descriptor-authority-run01-failed.json`

## What was deployed — and what was not

Only **Rosina (4200)** was restarted onto `539a8b4`. That is where #79 lives: it changed
`src/rosina/{photoDeps,photoEndpoint,server}.ts` and nothing else.

Every other backend process still serves **`405f7a7`** (`fridgegraph-deploy-238f719`):
4008 demo login/Orbit bridge, 4010 and 4012 routers, 4101–4107 subgraphs, 5051 MCP.

Measured per process (pid + cwd + git rev of that cwd):

| Port | pid | revision | checkout |
|---|---|---|---|
| 4008 | 64010 | `405f7a7` | `fridgegraph-deploy-238f719` |
| 4010 | 63340 | `405f7a7` | `fridgegraph-deploy-238f719` |
| 4012 | 63431 | `405f7a7` | `fridgegraph-deploy-238f719` |
| 4101–4107 | 62199 | `405f7a7` | `fridgegraph-deploy-238f719` |
| **4200** | **20096** | **`539a8b4`** | `fridgegraph-refresh-539a8b4` |
| 5051 | 64689 | `405f7a7` | `fridgegraph-deploy-238f719` |
| 4118 | 73928 | `534b1ca` | `fridgegraph-voice-534b1ca` |
| 5189 | 77769 | `dd14400` | web UI (Codex's checkout) |

**Schema is a separate fact:** 0049–0052 true, **0053 true, 0054 true, 0055 NOT applied**
(`orbit_alerts.redacted_at` absent). No migration was applied by this window.

### Why the full-stack refresh to `main` did not happen
`ops/0055-dry-run.mjs` fails its own precondition on this database —
*“BEFORE: authenticated holds TABLE-level SELECT”* — because `orbit_alerts` already carries
`authenticated=Dxtm` (TRUNCATE/REFERENCES/TRIGGER only), with no table-level SELECT to revoke.
Until that mismatch is understood, serving all of `main` (which contains #75, whose behaviour 0055
encodes) would put code ahead of its schema. Deploying Rosina alone touches none of that.

### #80 / #81 / #82 are web-only
They change `web/**`; their deployment target is the UI bundle, served by 5189 at `dd14400`, not
by any backend process. This window did not rebuild or retarget the UI checkout.

## The five cases

| Case | Result |
|---|---|
| Kendra (parent) → 200, controlled vocabulary, review-only | **PASS** — `200`, `model=muse-spark-1.3`, `source=live`, envelope `modelId,source,descriptors,dropped,textInImage`; every returned value inside this child's 55-entry vocabulary; the call created no alert and changed no Orbit state |
| Priya (unauthorized) → generic 403 | **PASS** — `403 {"error":"NOT_AUTHORIZED"}` |
| Confirmed ACTIVE-alert AUDIENCE recipient → the SAME 403 | **PASS** — same status, byte-identical body, against a real ACTIVE alert with a frozen audience of 3 |
| Rejected requests never invoke vision | **PASS** — offline counting stub: 0 invocations on unauthorized, AUDIENCE, and unknown-photo refusals; the success path increments it exactly once (positive control, so the zero is falsifiable) |
| Recipient photo VIEWING unchanged | **PASS** — `GET /api/orbit/photo/:id` as the audience member during the ACTIVE alert → `200 image/jpeg`, `X-Orbit-Access: AUDIENCE`; unknown photo still `404` |

**Honest caveat on case 1:** the fixture image is a blank 1×1 JPEG, so the model proposed **zero**
descriptors. That is correct behaviour (nothing invented, nothing forced), but it means this run
proves the authorization, envelope and vocabulary *gate*, not the model's descriptive quality. A
content-rich image would exercise the latter.

## Private execution detail worth keeping

The endpoint's photo store reads `ORBIT_PHOTO_DIR` (default `<cwd>/var/orbit-photos`). Because the
uploader (4008) and Rosina now run from **different checkouts**, Rosina's default directory was
empty and the parent's own photo failed to load → generic 403. That was a deployment mistake of mine,
not a code defect: the first run is preserved as the failed record. Rosina was restarted with
`ORBIT_PHOTO_DIR` pointed at the uploader's directory, and every case then passed.

## Supporting (not independent) live evidence
Rosina's log records `[rosina:photo] … status=403` with **no** `model=`/`source=` suffix on any
refusal, and `status=200 model=… source=…` only on the success path. This is consistent with the
code order but does not by itself prove no upstream call; the offline counting stub does.
