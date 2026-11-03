# Demo voice notes — script sheet (draft for agreement)

Status: **generated — four clips, transcriptions verbatim. Scripts below are the spoken versions.**

Source of truth: `docs/contracts/demo-history.md` + `demo-history.schema.json` at `origin/main`
`aff06e5`. Fixtures: `src/fixtures-demo-history.ts`.

## 1. Scope

One voice note per voice-linked response event in the 20 stories — the fixtures carry **three**:

| # | Story | Response event | Speaker | Child | Channel |
| --- | --- | --- | --- | --- | --- |
| 1 | `job_hist_08` | `ce_hist_08_1` | `p_priya` | `p_nora` | CALL |
| 2 | `job_hist_09` | `ce_hist_09_1` | `p_gma` | `p_nora` | SMS |
| 3 | `job_hist_12` | `ce_hist_12_1` | `p_gloria` | `p_nora` | CALL |
| + | three-phone story (feat/web-activity-timeline) | TBD | `p_gma` | `p_nora` | — |

The fourth clip is the requested Loretta line; its story/event IDs are not in the contract yet.

## 2. Scripts (proposed)

**1 · Priya — `p_priya`, `job_hist_08` / `ce_hist_08_1`**
> Hi — yes, I can get Nora at 4:20. I'm already heading that way for my own pickup, so it's no
> trouble. I'll be at the gate a few minutes early.

_(Corrected from 3:30: the response is recorded at 16:08 EDT and the parent confirmation at 16:40,
so the offered pickup must sit between them. 4:20 does.)_

**2 · Loretta — `p_gma`, `job_hist_09` / `ce_hist_09_1`**
> Of course. I'll leave a little early and bring her the snack she likes. Tell them not to worry —
> I'll be there by one.

_("By one" sits between the 12:47 response and the 13:15 confirmation.)_

**3 · Gloria — `p_gloria`, `job_hist_12` / `ce_hist_12_1`**
> Hi, this is Gloria. Walter and I can take turns this week — I'm free at half past two today. Just
> let the front office know I'm coming.

_(Corrected from three o'clock: 15:00 is after the 14:50 confirmation. 14:30 sits between the 14:21
response and 14:50.)_

**4 · Loretta — three-phone story**
> Yes — I can be there at one-twenty. I'll head out now so I'm not rushing.

No "Hey Kendra" openings; no parent named at all, so the scripts survive the parent-on-duty fix.
Spoken availability is an offer, not authorization or proof of pickup — the copy never claims a
pickup happened.

## 3. Casting (ElevenLabs stock/designed only)

| Character | Voice | Notes |
| --- | --- | --- |
| Priya | Jessica — Playful, Bright, Warm (`cgSgspJ2msm6clMCkdW9`) | younger sitter, quicker cadence |
| Loretta | Sarah — Mature, Reassuring (`EXAVITQu4vr4xnSDxMaL`) | slower, warmer, small pauses |
| Gloria | Matilda — Knowledgeable, Professional (`XrExE9yKIg1WjnnlVkGX`) | measured, matter-of-fact |

The account also holds a **cloned** voice named for a client. It is **not used anywhere** in this
task.

## 4. Timing — a fixture defect that must be settled before the batch

Every non-DST story in `src/fixtures-demo-history.ts` passes `DETROIT_OFFSET_AFTER_FALLBACK`
(`-05:00`). Detroit is still **EDT (`-04:00`)** through 2026-10-31; DST ends 2026-11-01. So every
October story is encoded one hour later in UTC than its intended local wall clock.

| Story | Intended local (EDT) | Fixture UTC (`-05:00`) | Correct UTC (`-04:00`) |
| --- | --- | --- | --- |
| `job_hist_08` attempt | 2026-10-12 16:02 | 2026-10-12T21:02Z | **2026-10-12T20:02Z** |
| `job_hist_08` response | 2026-10-12 16:08 | 2026-10-12T21:08Z | **2026-10-12T20:08Z** |
| `job_hist_09` attempt | 2026-10-13 12:32 | 2026-10-13T17:32Z | **2026-10-13T16:32Z** |
| `job_hist_09` response | 2026-10-13 12:47 | 2026-10-13T17:47Z | **2026-10-13T16:47Z** |
| `job_hist_12` attempt | 2026-10-18 14:03 | 2026-10-18T19:03Z | **2026-10-18T18:03Z** |
| `job_hist_12` response | 2026-10-18 14:21 | 2026-10-18T19:21Z | **2026-10-18T18:21Z** |

`recordedAt` in the manifest will use whichever pair teacher-persona confirms. I will not silently
pick one.

## 5. ASR contract — verified 2026-11-02

`POST {META_BASE_URL}/asr/transcribe`, model `muse-voice-transcribe-1.0`, **multipart** with:

- part `request`, `application/json`: `{ model, audioEncoding: "WAV", mode: "PUSH_TO_TALK" }`
- part `audio`, `audio/wav`: mono 16-bit PCM, 24 kHz
- `Authorization: Bearer <META_API_KEY>`

Probe (3.9 s stock-voice clip) returned **200**:
`"Yes, I can be there at 1.20. I'll head out head out now so I'm not rushing."`

Two real model errors in one short clip: the time became **"1.20"** and "head out" was **duplicated**.
That is exactly the critical-instance case the brief anticipates — the batch will store the model
output verbatim and flag/regenerate on critical time/name/negation errors, keeping attempt history.

## 6. Still open

1. **Script sign-off** from teacher-persona (no live channel found; posting this sheet for review).
2. **Which timestamps** the manifest should carry — fixture as-written, or the corrected EDT pair.
3. **Story/event IDs for the three-phone Loretta clip**.
4. Whether the fourth clip belongs in `data/demo-voice/` with the other three or as a separate
   deliverable for `feat/web-activity-timeline`.

No batch audio, no manifest, no PR until 1–3 are settled.
