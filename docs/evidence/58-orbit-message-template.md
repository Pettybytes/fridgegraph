# 58 — the Orbit message says only what is known, and asks in human words

The parent preview **is** the exact text recipients read, so two template defects were also defects in what a real village would receive.

## Defects

| # | Defect | Why it mattered |
|---|---|---|
| 1 | absent descriptors rendered as `Hair: not described.` | fills an emergency message with sentences that carry no information |
| 2 | replies requested as `Reply WITH_ME, ON_WAY, or CANNOT_HELP.` | raw enum codes are not something a person texts back |

## Fix (0052)

- **Omit what was not described.** Each descriptor clause is emitted only when it has a value; `concat_ws` skips the absent ones. Nothing renders as "not described" anymore.
- **Ask in human words.** The message ends `Reply 1 = With me, 2 = On my way, 3 = Can't help.`
- **The stored response stays controlled.** `_orbit_reply_choice(text)` maps a number, the words, or a legacy enum onto `WITH_ME` / `ON_WAY` / `CANNOT_HELP`; `respond_to_orbit_alert` now runs every input through it, so a person can answer "2" and the ledger still records the enum.
- **The hash covers the wording.** `_orbit_message_hash` is now `sha256(message || audience-order)`, so a template change necessarily produces a new hash and a preview minted under the old wording can no longer activate. Vocabulary, the no-location guarantee and the append-only response ledger are untouched.

## Two bugs of mine, caught before landing

1. **The parser dropped underscores**, so `ON_WAY`/`CANNOT_HELP` — the strings the web client itself sends — normalised to `onway`/`cannothelp` and were **rejected**. That would have broken every response from the UI. Fixed by turning non-alphanumerics into spaces instead of deleting them.
2. **Trimming happened before substitution**, so `" 2. "` became `" 2 "` and failed to match `2`. Fixed by trimming after collapsing.

## Proof — `ops/orbit-message-proof.mjs`: **15/15 PASS**

| # | Assertion |
|---|---|
| 1 | draft created |
| 2 | no "not described" filler |
| 3 | no `Hair:` clause when hair was omitted |
| 4 | described fields present (`Wearing: yellow raincoat`, `Carrying: green backpack`) |
| 5 | raw enum codes gone from the ask |
| 6 | human reply options named exactly |
| 7 | photo line absent when no photo |
| 8 | activation accepted the preview binding |
| 9 | activated message equals the previewed text |
| 10 | a human reply (`"2"`) is accepted |
| 11 | the **stored** response is still `ON_WAY` |
| 12 | `messageHash = sha256(message \| audience)` |
| 13 | parser maps numbers, words, legacy enums; rejects the rest (11/11) |
| 14 | proof alert CLOSED |
| 15 | no ACTIVE alert remains |

Rendered sample:

```
FridgeGraph Orbit: check-in not recorded for Nora. Wearing: yellow raincoat.
Carrying: green backpack. Reply 1 = With me, 2 = On my way, 3 = Can't help.
```

**No regressions:** `orbit-audience-proof`, `orbit-leakage-proof` and `orbit-vocabulary-proof` all report **0 failures** on this head.

Leftover after the proof: 4 alerts / 6 responses, **all closed** — nothing reset, nothing ACTIVE.
