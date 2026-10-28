# 24 — Muse Spark Open on Baseten

- Run: 2026-10-28T20:12Z–20:13Z (local EDT)
- Worktree: `/Users/user/orca/workspaces/fridgegraph/muse-first-call`, branch `feat/muse-first-call`
- Provider: Baseten, OpenAI-compatible. Base URL from `BASETEN_BASE_URL` (ends `/v1`).
- Model: `meta-models/muse-spark-open-1026` — used exactly as configured; the key is scoped to it.
- Client: `src/muse/providers.ts` — `meta` and `baseten` behind one `chat()` interface, so the
  caller swaps providers with `--provider` and nothing else in the loop changes.

## Configuration check (names only)

`grep -c '^NAME=' .env`: `BASETEN_API_KEY` 1, `BASETEN_BASE_URL` 1, `BASETEN_MODEL_ID` 1.
No value is printed here or anywhere in the client.

## 1. Smoke call

```
npx tsx src/muse/run.ts --provider baseten --person p_mom --smoke --json
```

```json
{
  "provider": "baseten",
  "model": "meta-models/muse-spark-open-1026",
  "content": "MUSE_SMOKE_OK",
  "reasoningField": "reasoning_content",
  "reasoningChars": 128,
  "messageKeys": ["content", "role", "reasoning_content"],
  "usage": { "prompt": 155, "completion": 53, "total": 208 },
  "latencyMs": 1315,
  "httpStatus": 200
}
```

## 2. The tool-calling prompt (same prompt as evidence 23)

```
npx tsx src/muse/run.ts --provider baseten --person p_mom --child p_nora \
    --as-of 2026-10-26 --mcp http://127.0.0.1:5051/mcp --json
```

| Measurement | Value |
| --- | --- |
| Tool call correct | **yes** — `PickupCandidates`, `{childId: p_nora, asOf: 2026-10-26}`, one call, no invented tool |
| Tool call arguments | exactly the caller's child and date; no scope widening attempt |
| Candidates returned / cited | 4 / 4 |
| Grounded | **yes** — 0 unsupported phone numbers, 0 invented names |
| Round 1 (tool-calling) | 1261 ms, `finish_reason: tool_calls`, 1067 tokens |
| Round 2 (answer) | 3251 ms, `finish_reason: stop`, 2526 tokens |
| End-to-end | 6503 ms |
| Tokens | prompt 2081, completion 1512, total 3593 |
| Reasoning volume | round 1: 588 chars; round 2: **4544 chars** for a 5-line answer |

Negative test on the same model (Walter, no pickup rights): tool returned `UNAUTHORIZED`, the model
reported it plainly, 345 ms tool latency, no fabricated fallback. See evidence 23.

## 3. How the always-on reasoning is shaped, and what the client does with it

The API returns reasoning as a **separate message field**: `choices[0].message.reasoning_content`,
with `content` holding the answer. `messageKeys` = `["content","role","reasoning_content"]`.
It is always present, including on the smoke call and on the tool-calling round.

Client policy (implemented in `src/muse/providers.ts` + `src/muse/index.ts`):

- **Read, never re-send.** Only `content` and `tool_calls` are appended to the conversation; the
  reasoning text is not fed back into the next turn. Re-sending it would inflate prompt tokens
  every round and let a stray thought contaminate the next decision.
- **Captured per round** as `reasoningField` + length, so evidence can show its size without
  storing walls of internal monologue.
- **Stripped from the answer.** `answer` is `content` only; reasoning never reaches the user-facing
  string or the grounding check.

### Budget consequence (found by measurement, then fixed)

With `max_tokens: 900`, round 2 returned `finish_reason: "length"` and an **empty** answer: the
always-on reasoning consumed the completion budget before the answer began (3521 reasoning chars,
900 completion tokens). The first run was correctly reported as ungrounded rather than accepted.
The default was raised to 2000, after which the same prompt finished with `stop` and a correct,
grounded answer. Any caller that caps completion tokens below the reasoning volume will see
truncated answers, and the failure is silent unless `finish_reason` is checked.

## 4. Cost per call

Token counts are recorded above (208 smoke, 3593 for the tool-calling run). A dollar figure is
**not** reported: no Baseten rate card is available in the repo or environment, and inventing a
per-token price would make the number meaningless. To price a call: `total_tokens × rate` for this
model id.

## 5. Recommendation on the split

Build Line plan: *Spark Open = week-ahead scan + note extraction; Muse Spark API = live pickup
decisions.* **Measured evidence confirms it, with one caveat.**

Supporting measurements:

- **Correct tool discipline under a strict prompt.** One call, exact arguments, no invented
  operations — the failure mode that matters most for a batch scan is an invented tool call or a
  hallucinated person. Neither occurred, at temperature 0.
- **Perfect grounding on a real permission boundary.** All 4 real candidates, all real reasons, no
  fabricated contact details — and a clean refusal on the unauthorized caller.
- **Latency fits batch work comfortably** (~1.3 s tool round, ~6.5 s end to end) and is **borderline
  for live calls**: a parent waiting on a phone needs a sub-2 s first response, so a live decision
  should not wait for a full reasoning round plus a second answering round.
- **Cost concentrates in reasoning**, not in the answer (4544 reasoning chars vs a 5-line answer).
  That is cheap for a daily/weekly scan, and wasteful per live decision.

Caveat that must be stated: the comparison against **Muse Spark** (closed) could not be made,
because `META_BASE_URL` and `META_MODEL_ID` are absent — the Meta path is blocked (evidence 23).
So the split is confirmed on Spark Open's own numbers and on architectural reasoning, not on a
head-to-head latency/cost measurement. Re-run `--provider meta` once those two values exist and
replace this caveat with numbers.

Do not build the week-ahead scan or note extraction yet — out of scope for this prompt.
