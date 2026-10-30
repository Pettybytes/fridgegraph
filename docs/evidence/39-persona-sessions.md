# Evidence 39 — one reused Supabase session per persona

_Task E-NEXT, sub-task 1. Branch `feat/e-next-persona-sessions` off `main` `b3173b9` (#26 merged).
Local only: the demo login still binds 127.0.0.1 and does not start without `DEMO_LOGIN_ENABLED=1`._

## What changed

| File | Change |
|---|---|
| `src/demo/persona-sessions.ts` | **new.** Process-memory cache: one Supabase session per persona, single-flight mint, single-flight refresh, 5-minute renewal safety window, `dropPersonaSessionCache()` |
| `src/demo/session.ts` | `refreshCachedSession(persona, refreshToken)` — server-side refresh that re-checks identity + demo marker |
| `src/demo/server.ts` | `POST /api/demo/login` now serves from the cache; the response carries `publicPersonaSession(session)` |
| `src/demo/personas.ts` | response type: `session` loses `refresh_token` |
| `ops/persona-sessions-proof.mjs` | **new.** Proofs a–e (26 checks) |
| `ops/e2a-proof.mjs` | assertion a3 updated to the new contract (no refresh token in the browser response) |

## Response contract (what W4b builds against)

`POST http://127.0.0.1:4008/api/demo/login` with `{ "personaId": "kendra" }` — unchanged transport,
origin, size and loopback rules from E2a.

READY (HTTP 200):

```json
{
  "status": "READY",
  "personaId": "kendra",
  "personId": "p_mom",
  "persona": { "id": "kendra", "personId": "p_mom", "name": "Kendra", "role": "Nora's mom",
               "childId": "p_nora", "childName": "Nora Ellison", "villageId": "v_nora",
               "grants": [], "parent": true },
  "scope": { "childId": "p_nora", "childName": "Nora Ellison", "parentName": "Kendra", "villageId": "v_nora" },
  "session": { "access_token": "<JWT>", "token_type": "bearer", "expires_in": 3540, "expires_at": 1793406601 },
  "marks": { "demo": true, "demoGuide": false }
}
```

- **`session` has no `refresh_token`.** The refresh token never leaves the server process. Any client
  that reads it is wrong by contract.
- `expires_at` is the session's ACTUAL expiry (seconds, from Supabase). `expires_in` is derived as
  `max(0, expires_at − now)`; neither is ever invented or extended.
- **Renewal:** call the same endpoint again with the same `personaId`. Inside the last **5 minutes**
  before expiry the server refreshes the cached session once (single-flight) and returns the new
  token and its real `expires_at`; outside the window it returns the cached token with no mint and no
  refresh. The browser never re-picks manually and never refreshes on its own.
- **`MINT_*` (HTTP 503, `{"status":"UNAVAILABLE","personaId":"…","reason":"MINT_…"}`)** stays
  retryable. Codes: `MINT_LINK_FAILED`, `MINT_VERIFY_FAILED`, `MINT_IDENTITY_MISMATCH`,
  `MINT_MARKER_MISSING`, `MINT_REFRESH_FAILED`, `DEMO_LOGIN_UNAVAILABLE`. A failed refresh falls back
  to one mint; a failed mint is a retryable 503.
- **RATE_LIMITED (HTTP 429, `{"error":"RATE_LIMITED"}`, `Retry-After`)** retryable. 60/min per IP,
  8/min per persona, in memory.
- `UNAVAILABLE` (HTTP 200, `UNKNOWN_PERSONA` / `NO_SEEDED_IDENTITY`) is terminal for that persona —
  no session, no substitute identity.

## Semantics that are now true

- Sessions are **per persona, shared by every visitor** of that persona. Judging needs no sign-in.
- **No global "current persona"** exists on the server. Selection is browser-local; the endpoint is
  stateless with respect to who picked what.
- Switching or leaving a persona is a client-side state change. **Nothing signs out or revokes** the
  shared Supabase session.
- Cache lives in process memory only — never on disk, never in a log line. A restart or
  `dropPersonaSessionCache()` (wired to `resetDemo` in Group 5) clears it.
- Concurrent mint and concurrent refresh each collapse to **one** operation per persona, because
  Supabase rotates refresh tokens: two refreshes would invalidate each other.

## Proofs — `npx tsx ops/persona-sessions-proof.mjs` — 26/26 PASS

| Proof | How | Result |
|---|---|---|
| a | 30 concurrent **cache-layer** calls (not the endpoint) for Kendra | 1 mint, 29 joined the same flight, identical access token, resolves to `p_mom` |
| b | endpoint: 8 × Kendra → 200 READY, all one token, no `refresh_token` field, real `expires_at`; 9th → 429 + `Retry-After`; per-IP window filled to exactly 60 with unknown ids (all 200 UNAVAILABLE, no session) and the 61st → 429 + `Retry-After`; one mint across the whole run | PASS |
| c | Kendra + Andre | different tokens, `p_mom` / `p_dad`, separate cache keys |
| d | clock injected: outside the window → cached token, `mints=1 refreshes=0`; 2 min before expiry → `source=renewed`, exactly 1 refresh, new token, `expires_at` unchanged-or-later (real value; seconds after the mint it legitimately lands in the same second); 10 concurrent renewals → exactly 2 refreshes total for the run | PASS |
| e | switch Kendra → Dana → Kendra → Dana | Kendra's cached token never replaced, both identities still resolve, no extra mint |

Run: `npx tsx ops/persona-sessions-proof.mjs` (needs `.env` + `data/identity-map.json`). Typecheck
clean, `npm run check` 380 files / 0 findings.

## Honest limits

- **Caching is not a throttle guarantee.** After a restart, a dropped cache or a rejected refresh a
  mint is still required, which is why `MINT_*` remains retryable.
- **Per-persona 8/min caps renewals**, not only picks. A browser that renews more than 8 times a
  minute for one persona gets 429; the access token is valid for an hour, so normal renewal is 1/hour.
- **Nothing about personas beyond the existing allow-list**: still 7 READY personas; `rosa`,
  `felicia`, `simone`, `dwayne` stay UNAVAILABLE until Group 4 seeds their auth users.
- **`resetDemo` does not call `dropPersonaSessionCache()` yet** — the function exists and is proven;
  wiring it is part of Group 5.
- **E2a proof a3 changed** with the contract (it asserted a refresh token was present). That is a
  deliberate contract change recorded here, not a silent edit.
