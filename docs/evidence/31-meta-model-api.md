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
