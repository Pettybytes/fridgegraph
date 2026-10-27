# Milestone 2A — verified identity plan

Checkpoint this builds on: `c721424`. Supabase proves **who** the caller is; `Grant` rows and
household policies still decide **what** they may do. Nothing about federation, the seven subgraphs
or the GraphOS registration changes.

## Step 0 findings (read-only)

### 0.1 Where the demo headers enter today

| Layer | File | Role |
| --- | --- | --- |
| Router | `router.yaml` (`headers.all.request.operations`) | propagates `x-demo-user`, `x-demo-date` to every subgraph |
| Subgraph context | `src/context.ts` (`makeContext`) | reads both headers into `{ callerId, today }` |
| Authorization | `src/authz.ts` (`requireCaller`) | treats `ctx.callerId` as the caller; no verification |
| MCP | `.apollo/mcp.local.yaml` (`headers:`) | pins `x-demo-user: p_mom` for **every** MCP request |
| Evidence | `ops/run-evidence.mjs` | sets `x-demo-user` per test; the assertions themselves never read it |
| MCP probe | `ops/mcp-probe.mjs` | sends no identity header at all — relies on the pinned config |
| Docs | `README.md`, `docs/apollo-notes.md`, `docs/questions.md` | describe the headers as INSECURE dev inputs |

So there are exactly **two** identity injection points (router propagation, MCP static header) and
**one** consumer (`makeContext` → `requireCaller`). That is the whole surface to replace.

### 0.2 Supabase environment

`SUPABASE_URL` **present**, `SUPABASE_PUBLISHABLE_KEY` **present**,
`SUPABASE_SERVICE_ROLE_KEY` **present**. `.env` is 193 bytes and matched by `.gitignore:2`. Names
only were inspected; no value was printed, logged or copied.

### 0.3 JWKS

`GET <SUPABASE_URL>/auth/v1/.well-known/jwks.json` → HTTP 200, one key:

```
kty=EC  crv=P-256  alg=ES256  use=sig  key_ops=["verify"]  kid=07013b17-…
```

Matches the expected signing setup. ES256 confirmed, so the plan proceeds (no stop condition).

### 0.4 Installed-version behaviour (docs for the versions actually running)

**Router 2.18.0 — does not forward `Authorization` to subgraphs by itself.**
<https://www.apollographql.com/docs/graphos/routing/security/jwt>
"By enabling JWT authentication, you can block malicious traffic at the *edge* of your graph
instead of relying on header forwarding to propagate tokens to your subgraphs."
"If you *do* need to pass entire JWTs to subgraphs, you can do so via the GraphOS Router's
general-purpose HTTP header propagation settings."

→ `router.yaml` must propagate `Authorization` explicitly, in addition to enabling
`authentication.router.jwt.jwks`.

**MCP Server 2.1.0 — `forward_headers`, not implicit passthrough.**
<https://www.apollographql.com/docs/apollo-mcp-server/config-file#forwarding-headers>
"The `forward_headers` option allows you to forward specific headers from incoming MCP client
requests to your GraphQL API." Header values are forwarded as-is. The server **logs a warning**
when forwarding sensitive headers such as `Authorization`. `disable_auth_token_passthrough` only
affects automatic OAuth token propagation.

→ remove the pinned `headers:` identity block; use `forward_headers: [authorization]`. The warning
is expected and documented; we accept it because the router — not the MCP server — is the
validator for these tokens.

## Design

1. **Verify in every subgraph, not only at the router.** Subgraph ports are reachable on
   localhost, so a router-only check is bypassable. Each subgraph verifies the same token with the
   same rules; the router's check exists to reject junk early, not to be the boundary.
2. **ES256 only.** `createRemoteJWKSet` + `jwtVerify` with `algorithms: ['ES256']`. `HS256`,
   `none`, and anything else are rejected before signature work. Segmented by the header's `alg`
   because jose would otherwise accept a key/scheme combination we did not choose.
3. **Claims:** `iss = <SUPABASE_URL>/auth/v1`, `aud = authenticated`, `exp` required,
   `algorithms: ['ES256']`, small clock tolerance.
4. **Identity = map[sub].** `sub` → `personId` from a **server-side gitignored** file loaded at
   startup. Email is never an identity. A client-sent `personId` is never trusted (and the header is
   gone). A valid token whose `sub` is unmapped → `UNAUTHENTICATED` (fail closed).
5. **Two distinct codes.** Bad/absent identity → `UNAUTHENTICATED`; verified identity without the
   required scope → `UNAUTHORIZED`. Milestone 1's assertions keep checking `UNAUTHORIZED` for
   scope denials, so the split must not blur.
6. **`x-demo-date` survives only as a test clock.** Honoured only when `DEMO_CLOCK=1`; otherwise the
   real date is used regardless of the header. Documented as such.
7. **No second auth system, no self-made keys.** Supabase is the only issuer; jose is only a
   verifier. The service-role key never leaves `scripts/` (server-side) and never appears in a
   response, log or committed file.

## Steps

| Step | Work | Gate |
| --- | --- | --- |
| 1 | `scripts/seed-auth-users.ts` (Admin API, idempotent), `.demo-credentials`, `data/identity-map.json` | **show command, wait** |
| 2 | `src/auth/verify.ts` shared verifier; `src/context.ts` rewritten; `requireCaller` unchanged in behaviour; delete `x-demo-user`; router JWT + explicit `Authorization` propagation | — |
| 3 | MCP `forward_headers`, pinned identity removed | — |
| 4 | Evidence runner signs in real users; 13 checkpoints; tokens in memory only, redacted on disk | — |
| 5 | README / PROVENANCE / apollo-notes §4, secret re-scan | **show push, wait** |

## Time boundary

Hard stop midnight ET. At the boundary: commit completed work, list what is unfinished **here**,
and never report an unfinished test as passed.

## Open questions / assumptions recorded as I go

- Supabase Admin API shape (`POST /auth/v1/admin/users`, `GET /auth/v1/admin/users`,
  `POST /auth/v1/token?grant_type=password`) is used directly over `fetch`; verified live in Step 1,
  not assumed.
- Identity map location: `data/identity-map.json`, gitignored, loaded at startup by the servers.
- `.demo-credentials` is gitignored and never read by the servers — it exists only so the evidence
  runner and I can sign in.

---

## Accepted decisions (Oct 26, 2026)

**Router-level JWT.** "Router-level JWT authentication is licence-gated in the current local
environment. Revisit Thursday after connecting the router to GraphOS with the graph key and checking
the plan's entitlements." The commented block stays in `router.yaml` as the place to turn it on. No
licence was purchased, managed federation was not enabled, and the running router was not changed.

**Why verification lives in the subgraphs.** Verification in all seven subgraphs is **required**
because subgraph ports are reachable; router-level auth would add an earlier rejection point and is
**NOT active today**.

**MCP.** "MCP forwards the caller's token; downstream subgraphs reject missing or invalid tokens. The
MCP HTTP endpoint itself does not authenticate requests."

**Clock.** The `APP_TIME_ZONE` fix stays. `DEMO_CLOCK` exists only as a test clock and is not needed
by any evidence check.

**Evidence 06b.** Rewritten to use a grant whose window closed 2026-09-30 rather than a future date
header, so the expiry is evaluated against the real local date at either clock setting.
