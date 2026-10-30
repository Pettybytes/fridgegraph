# Evidence 31 — Meta Model API (Phase M)

Date: 2026-10-30. Worktree: `../fridgegraph-meta`, branch `feat/meta-model-api` off `main`
(`1a576a7`).

---

## M1 — verification of the two values: **CONFIRMED**

Both were checked against the official documentation, not against memory.

**Base URL** — from `dev.meta.ai`, Chat Completions protocol page
(`https://dev.meta.ai/docs/protocols/chat-completions`), the official example:

```python
client = OpenAI(
    base_url="https://api.meta.ai/v1",
    api_key=os.environ["MODEL_API_KEY"],
)
```

**Model** — from `dev.meta.ai/docs/models`, Muse Spark section:

> Muse Spark 1.3 (`muse-spark-1.3`): the latest version, tuned for agentic workflows (multi-step
> tool, browser, and long-horizon tasks) with improved coding over 1.2. Supports all reasoning
> effort levels, including the "max" level for extended reasoning (not available with
> `muse-spark-1.3-contributor`). Recommended for new work.

So the task's stated values are correct, and `muse-spark-1.3` is also the docs' default in most code
examples. **`muse-spark-1.3-contributor` is a different model on a different data mode** (Meta may
train on your content); it was not used and will not be.

Both constants were written to `.env` through the approved helper:

```
ops/set-env-secret.sh META_BASE_URL     -> https://api.meta.ai/v1     (length 22)
ops/set-env-secret.sh META_MODEL_ID     -> muse-spark-1.3             (length 14)
```

They are public documentation constants, not credentials, so no secret handling was needed for
them; the helper was used anyway so the file is written the same way every time.

---

## M1 — access with Bryan's key: **FAILS. Phase M is blocked here.**

`GET https://api.meta.ai/v1/models`:

```
401 {"error":{"code":"invalid_api_key","message":"Unauthorized","param":null,"type":"authentication_error"}}
```

Minimal completion, to rule out a models-endpoint quirk:

```
POST https://api.meta.ai/v1/chat/completions
{"model":"muse-spark-1.3","messages":[{"role":"user","content":"ping"}],"max_tokens":1}

401 {"error":{"code":"invalid_api_key","message":"Unauthorized","param":null,"type":"authentication_error"}}
```

The key in `.env` was characterised without printing it:

| Property | Value |
|---|---|
| present | yes |
| length | 136 |
| prefix | `LLM…` |
| placeholder-looking | no |
| contains whitespace | no |
| pure `[A-Za-z0-9_-]` | **no** — it contains at least one other character |

So this is not an empty value, a stray quote, a truncated paste, or a placeholder. The endpoint is
right and the model name is right; the credential itself is being rejected.

### What Bryan should check in the Meta console

1. **Which key type it is.** A 136-character `LLM…` value that is not purely alphanumeric does not
   look like the plain API key in the Model API dashboard example (`os.environ["MODEL_API_KEY"]`).
   If it was copied from a different product surface, re-copy from **Meta Model API → API keys**.
2. **That the key is active and not revoked/rotated** — the console shows a creation date and a last
   used time; a key that has never been used is the usual sign of a stale paste.
3. **That the project/org the key belongs to has Model API access enabled** — an org without
   pay-as-you-go enabled returns the same `invalid_api_key` shape rather than a billing error.
4. **That the value in `.env` is exactly what the console shows**, end to end. The stored value
   contains at least one character outside `[A-Za-z0-9_-]`, so if the console's key has none, the
   stored value is wrong.

To replace it, he runs one command and pastes at the hidden prompt:

```
cd /Users/user/Desktop/bentley/fridgegraph-level-b && ops/set-env-secret.sh META_API_KEY
```

No value goes in the command line. After that, re-running `node ops/meta-probe.mjs` is the whole
check.

---

## M2 — provider shape: **CONFIRMED** (the run itself needs a working key)

`src/muse/providers.ts` resolves the meta provider from exactly `META_API_KEY`, `META_BASE_URL`,
`META_MODEL_ID`, and constructs:

```
POST ${baseUrl}/chat/completions
Authorization: Bearer <key>
{ model, messages, tools?, tool_choice: 'auto', temperature: 0, max_tokens: 2000 }
```

With `META_BASE_URL=https://api.meta.ai/v1` that is `https://api.meta.ai/v1/chat/completions` — the
documented endpoint, in the documented OpenAI-compatible shape, with tool calling passed the way
the tool-calling page expects. No endpoint is invented and no field is guessed.

**Not done, because it cannot be:** the `meta` provider was **not** run against the PickupCandidates
tool-calling test, so there is **no grounding score, no latency and no tool-call count** for it. The
target was 4/4; that number does not exist yet and is not being estimated. Baseten's result
(evidence 23/24) stands as the only measured run.

The branch does not lack anything that only exists on unmerged #9 — `providers.ts` is on `main` and
the `meta` provider is complete. The single blocker is the credential.

---

## Unblocked — 2026-10-30 (M2 attempt)

Bryan replaced `META_API_KEY` (the old value had the Supabase JWKS URL glued to it). Probe now:
`GET /models` **200**, `POST /chat/completions` **200**, model `muse-spark-1.3`. The 1-token probe is
a reachability check, **not** a latency benchmark.

### Harness

Identical to the Baseten run in evidence 23/24:
`--provider meta --person p_mom --child p_nora --as-of 2026-10-26 --mcp http://127.0.0.1:5051/mcp --json`
against a freshly raised **offline** stack (subgraphs 4101-4107, router 4012, MCP 5051) so the
GraphOS-connected router on 4010 and Task D's stack were untouched. Read-only: one query.

### Result — ACCEPTANCE **NOT MET** (3/3 runs)

| Run | Tool call | Args | Rounds | Latency | Tokens (p/c/t) | Grounded |
|---|---|---|---|---|---|---|
| 1 | `PickupCandidates` ✓ | `{childId: p_nora, asOf: 2026-10-26}` ✓ | 2 | 5797 ms | 1621 / 691 / 2312 | **no** |
| 2 | `PickupCandidates` ✓ | same ✓ | 2 | 5533 ms | 1621 / 930 / 2551 | **no** |
| 3 | `PickupCandidates` ✓ | same ✓ | 2 | 6776 ms | 1622 / 1107 / 2729 | **no** |

Median latency **5797 ms**; median total tokens **2551**.

**What worked:** Muse chose the right tool, with exactly the caller's child and date, one call, no
invented tool, twice-round-trip loop formed correctly, and it reported the failure plainly instead
of fabricating candidates ("Tool error: UNAUTHENTICATED, no candidates available."). That is the
desired behaviour on a broken dependency.

**What failed:** the MCP execution returned **UNAUTHENTICATED** on all three runs, so no candidates
reached the model and the grounding check is `grounded: false` by construction. **Score is 0/4, not
4/4** — reported as measured, not adjusted.

Cause is in the harness/environment, not the model: the bearer is issued (807-char token, identity
`p_mom`) and forwarded, but the offline stack rejects it. Not diagnosed further in this pass; the
next step is to verify the alt subgraphs' JWKS verification path (`SUPABASE_JWKS_URL`) and confirm the
router's `override_subgraph_url` actually took effect rather than routing to the shared stack.

**PR #15 stays draft.** Step 1 does not meet 4/4 on any run.

---

## M2 rerun — traced to the hop that failed, fixed, then accepted (2026-10-30)

### The trace (log: hop, status, claims — never a token)

| Hop | Observation |
|---|---|
| 1. token | `alg=ES256`, `kid` matches JWKS, **signature VERIFIED**, `iss` project = JWKS project, `aud=authenticated`, `exp` valid (+60 min vs the real clock), `identity_map` → **`p_mom` (Kendra Ellison)** |
| 2. access subgraph 4102 | first attempt returned **schema** errors only — *misleading*: validation runs before auth, so it proved nothing. Re-queried with only fields that subgraph owns → **UNAUTHENTICATED** |
| 3. router 4012 | **UNAUTHENTICATED** |
| 4. MCP 5051 | `initialize` 200, session established, `tools/call` → **UNAUTHENTICATED** |

**Hypothesis tested and rejected:** `p_mom` is Kendra. The claim in the previous report that the
identity was suspect was wrong — sign-in was correct all along. The token was valid at every claim.

### Root cause

`src/auth/verify.ts` resolves the caller from a **file**, not the database table:

```ts
function identityMapPath() { return process.env.IDENTITY_MAP_PATH ?? join(process.cwd(), 'data', 'identity-map.json') }
function getIdentityMap() { if (!existsSync(path)) return {}; ... }
```

`data/identity-map.json` **did not exist in the `fridgegraph-meta` worktree**. A missing file returns
`{}`, so every `sub` resolved to `unmapped` and every request became `UNAUTHENTICATED` — at the
subgraph, and therefore at every hop above it. Nothing was wrong with the model, the key, the router
or the sign-in; the worktree was simply missing a runtime file that the other worktrees have.

**Fix (only that defect):** link the file — `data/identity-map.json` (685 bytes, gitignored).

Two secondary defects in my own harness, found and fixed on the way:

1. The ad-hoc router config omitted `headers.all.request.operations.propagate: Authorization`
   (handoff lesson #10). Necessary but **not sufficient** — with it added the call still failed until
   the identity map was present. Both were needed; neither alone was the cause.
2. `node_modules` and `.demo-credentials` were absent in this worktree too (symlinked, not copied).

After the fix, **before any model call**: router `200`, `candidates=4`; MCP `tools/call`
`isError=false` returning Kendra's four candidates.

### Acceptance — Meta Model API (`muse-spark-1.3`), 3 identical runs

| Run | Tool call | Args | Rounds | Latency | Tokens (p/c/t) | Grounding |
|---|---|---|---|---|---|---|
| 1 | `PickupCandidates` ✓ | `{childId: p_nora, asOf: 2026-10-26}` | 2 | 9222 ms | 1915 / 1483 / 3398 | **4/4** |
| 2 | `PickupCandidates` ✓ | same | 2 | 8413 ms | 1917 / 1262 / 3179 | **4/4** |
| 3 | `PickupCandidates` ✓ | same | 2 | 8650 ms | 1915 / 1309 / 3224 | **4/4** |

**Median latency 8650 ms; median total tokens 3224; 2 model round trips per run; grounded 3/3.**
Grounding = all four candidate names cited and present in the tool result, **0** unsupported phone
numbers, **0** invented names. Run 3's heuristic flagged the phrase "Ask Loretta" as a possible
invented name — a false positive: the name is in the returned data, and `grounded` stayed true.

### First comparison — Baseten `meta-models/muse-spark-open-1026`, same harness, 3 runs

**Label: first comparison.** Not a ranking, not a permanent model-role decision.

| Run | Rounds | Latency | Tokens (p/c/t) | Grounding |
|---|---|---|---|---|
| 1 | 2 | 8394 ms | 2081 / 1610 / 3691 | 4/4 |
| 2 | 2 | 7323 ms | 2081 / 1719 / 3800 | 4/4 |
| 3 | 2 | 8434 ms | 2081 / 2137 / 4218 | 4/4 |

Median latency **8394 ms**, median tokens **3800**, grounded 3/3, 0 unsupported phones, 0 invented.

Both models met 4/4 on every run. Meta used fewer median tokens (3224 vs 3800, ~15% lower) at
comparable median latency (8650 vs 8394 ms, ~3% slower). With n=3 and a single prompt this is a
first observation, not a settled difference.

### Scope

Read-only throughout: one query per run, no `db:reset`, no `seed`, no writes. Offline stack only
(subgraphs 4101-4107, router 4012, MCP 5051); the GraphOS router on 4010 and Task D's stack were not
touched. No token, password or key is printed anywhere in this evidence.
