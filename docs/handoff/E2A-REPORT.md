# E2a — demo login endpoint (report for the W4 login slice)

_Status: **E2a DONE**. Local only. No public route exists._

## Endpoint

`POST http://127.0.0.1:4008/api/demo/login`

- Listener binds **127.0.0.1 only**, starts only when `DEMO_LOGIN_ENABLED=1`, and refuses to start
  when `NODE_ENV=production`. Port overridable with `DEMO_LOGIN_PORT` (default 4008).
- `GET /api/demo/health` returns the persona list with its readiness; no session, no secret.
- Localhost/127.0.0.1 origins only (any port); anything else gets `403 ORIGIN_NOT_ALLOWED`.
- `Cache-Control: no-store` everywhere; 2 kb body limit.

### Request

```json
{ "personaId": "kendra" }
```

`personaId` is the only accepted selector. A `personId`, email or user id is not accepted — the
allow-list is server code (`src/demo/personas.ts`).

### Response — READY (HTTP 200)

```json
{
  "status": "READY",
  "personaId": "kendra",
  "personId": "p_mom",
  "persona": {
    "id": "kendra", "personId": "p_mom", "name": "Kendra", "role": "Nora's mom",
    "childId": "p_nora", "childName": "Nora Ellison", "villageId": "v_nora",
    "grants": [], "parent": true
  },
  "scope": { "childId": "p_nora", "childName": "Nora Ellison", "parentName": "Kendra", "villageId": "v_nora" },
  "session": {
    "access_token": "<Supabase session token>",
    "refresh_token": "<Supabase refresh token>",
    "token_type": "bearer",
    "expires_in": 3600,
    "expires_at": 1790000000
  },
  "marks": { "demo": true, "demoGuide": false }
}
```

`persona` + `scope` are exactly the `AuthSession` fields the web `AuthAdapter` builds in
`web/src/features/personas/auth.ts`; `session` is the verbatim Supabase session
(`access_token`, `refresh_token`, `token_type`, `expires_in`, `expires_at`). Tokens are credentials:
they are returned to the caller, never logged, stored or written to evidence.

### Response — UNAVAILABLE (HTTP 200)

```json
{ "status": "UNAVAILABLE", "personaId": "rosa", "reason": "NO_SEEDED_IDENTITY" }
```

`reason` is `UNKNOWN_PERSONA` or `NO_SEEDED_IDENTITY`. Never a substitute identity, never a session.

### Other responses

| Case | HTTP | Body |
|---|---|---|
| missing/oversized `personaId` | 400 | `{"error":"INVALID_REQUEST"}` |
| over a rate limit | 429 | `{"error":"RATE_LIMITED"}` + `Retry-After` |
| mint failure (link/verify/mismatch/marker) | 503 | `{"status":"UNAVAILABLE","personaId":"…","reason":"MINT_*"}` |
| disallowed origin | 403 | `{"error":"ORIGIN_NOT_ALLOWED"}` |

## Personas

Allow-list = Cast v2 personas + the Demo guide. READY is derived from the identity map (a persona is
ready only when a real Supabase Auth user exists for it), never hardcoded.

| Persona | personId | State |
|---|---|---|
| `demo-guide` | `p_demo_guide` | **READY** (created by this task, guide marker) |
| `kendra` | `p_mom` | **READY** |
| `andre` | `p_dad` | **READY** |
| `loretta` | `p_gma` | **READY** |
| `priya` | `p_priya` | **READY** |
| `dana` | `p_dana` | **READY** |
| `jax-family` | `p_ray` | **READY** |
| `rosa` | `p_rosa` | UNAVAILABLE — no seeded identity |
| `felicia` | `p_felicia` | UNAVAILABLE — no seeded identity |
| `simone` | `p_simone` | UNAVAILABLE — no seeded identity |
| `dwayne` | `p_dwayne` | UNAVAILABLE — no seeded identity |

Unknown ids (`nobody`, `p_mom` used as a personaId) → `UNAVAILABLE / UNKNOWN_PERSONA`.

## How `demo` is marked

- `app_metadata.demo = true` on every seeded demo identity; `app_metadata.demo_guide = true` on the
  Demo guide identity only. Set idempotently by `scripts/seed-auth-users.ts` via
  `PUT /auth/v1/admin/users/{id}`; written only when the value differs.
- `app_metadata` is server-writable only. `user_metadata`, a header or a browser flag cannot produce
  the marker, and `src/auth/verify.ts` reads it **only** from the verified token payload
  (`demo`/`demoGuide`, both defaulting to false).
- The mint refuses to return a session whose subject does not map to the requested person
  (`MINT_IDENTITY_MISMATCH`) or whose token lacks the marker (`MINT_MARKER_MISSING`).

## Session minting

Primary path only — **no password is involved anywhere**:

1. `admin.generateLink({ type: 'magiclink', email })` with the service-role key, server-side.
2. `verifyOtp({ token_hash, type: 'magiclink' })` on a fresh publishable-key client.

Both clients are created **per request** with `persistSession:false`, `autoRefreshToken:false`,
`detectSessionInUrl:false` — no module-level client, no shared session state.

Because the primary path works on this project, the password fallback was **not** implemented: no
server reads `.demo-credentials`, and the existing rule stands unchanged.

## Rate limits

Per IP: 20/minute. Per persona: 8/minute. In-memory sliding windows, pruned every 30 s.

## Proofs (ops/e2a-proof.mjs — 46/46 PASS, run with `npx tsx`)

| # | Proof | Result |
|---|---|---|
| a | allow-listed persona signs in via the endpoint; Supabase issues the session; the existing `verifyBearer()` resolves `p_mom` | PASS |
| b | the trusted demo marker is in the verified token; guide = demo + demo_guide; nobody else gets the guide mark | PASS |
| c | Kendra + Andre, then Andre + Priya in parallel: each resolves to its own personId, tokens differ, no cross-identity | PASS |
| d | unknown ids and the four unseeded Cast v2 personas → UNAVAILABLE, with no session and no substitute | PASS |
| e | live GraphQL via the router: Kendra/Andre (parents) and Priya (schedule.read) read Nora's event; Dana (unrelated adult) gets `UNAUTHORIZED`; the guide reads the same sandbox record; the guide's mutation is refused `DEMO_GUIDE_READ_ONLY`; no token → `UNAUTHENTICATED` | PASS |
| f | per-persona limit: 8 × 200 then 429 | PASS |

## Not done here (by design)

- No tunnel, hosting, proxy or port-forward: the endpoint is unreachable from outside this machine.
- Sandbox enforcement for outreach is E2b; guide scope is E2c.
