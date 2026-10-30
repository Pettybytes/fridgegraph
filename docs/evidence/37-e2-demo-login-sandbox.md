# Evidence 37 — Task E2: demo login, sandbox enforcement, guide scope

Branch `feat/e-group2`. Migration `0025_demo_sandbox.sql`. No token, link, OTP, password or user id
appears in this file.

---

## E2a — demo login endpoint

Full contract: [`docs/handoff/E2A-REPORT.md`](../handoff/E2A-REPORT.md).

**Endpoint** `POST http://127.0.0.1:4008/api/demo/login`, body `{ personaId }`. Loopback bind only,
`DEMO_LOGIN_ENABLED=1` required, refuses `NODE_ENV=production`, localhost origins only, no-store.

**Session source: Supabase Auth, primary path, no password.**
`admin.generateLink({ type: 'magiclink' })` → `verifyOtp({ token_hash, type: 'magiclink' })`, both
clients created per request (`persistSession:false`, `autoRefreshToken:false`). The password fallback
was not implemented because the primary path works on this project — so no server reads
`.demo-credentials` and that rule is unchanged.

Observed on the first probe (`ops/e2-mint-probe.mjs`):

| Step | Outcome |
|---|---|
| `generateLink(magiclink)` | ok, hashed token present, `verification_type=magiclink` |
| `verifyOtp(token_hash, magiclink)` on a fresh client | session issued, refresh token present |
| subject → identity map | `p_mom` |
| `app_metadata` keys on the user | `demo`, `provider`, `providers` |
| existing JWKS verifier accepts the minted token | yes |
| `app_metadata.demo` in the verified claim | true |
| `app_metadata.demo_guide` in the verified claim | false |

**Marking.** `app_metadata.demo = true` on all 14 seeded identities, `app_metadata.demo_guide = true`
on `p_demo_guide` only, set idempotently by `scripts/seed-auth-users.ts` (re-run wrote 0 changes the
second time). `src/auth/verify.ts` exposes them from the verified payload only, both defaulting to
false; `src/context.ts` carries them on `Ctx`.

**Persona allow-list** (`src/demo/personas.ts`, server code). READY is derived from the identity map:

- READY (7): `demo-guide`, `kendra`, `andre`, `loretta`, `priya`, `dana`, `jax-family`
- UNAVAILABLE (4, no seeded identity): `rosa`, `felicia`, `simone`, `dwayne`
- Unknown ids → `UNAVAILABLE / UNKNOWN_PERSONA`, never another identity

**Proofs** `npx tsx ops/e2a-proof.mjs` — **46/46 PASS**:

| # | Check | Result |
|---|---|---|
| a | endpoint sign-in; real Supabase session; **the existing verifier** resolves `p_mom`; persona/scope shape matches the web AuthAdapter | PASS |
| b | demo marker in the verified token; guide = demo + demo_guide; Kendra is not guide; response marks agree | PASS |
| c | Kendra+Andre then Andre+Priya in parallel: own personId each, different tokens, no cross-identity, earlier session unaffected | PASS |
| d | `nobody`, `not-a-persona`, `p_mom`-as-personaId, and the four unseeded personas → UNAVAILABLE, no session, no substitute | PASS |
| e | live GraphQL through the router: Kendra/Andre (parents) and Priya (`schedule.read`) read Nora's event; Dana (unrelated adult) → `UNAUTHORIZED`; guide reads the same sandbox record; guide mutation → `DEMO_GUIDE_READ_ONLY`; no token → `UNAUTHENTICATED` | PASS |
| f | per-persona limit: 8×200 then 429 | PASS |

**Exposure.** No tunnel, host, proxy or forwarding rule. The listener is `127.0.0.1:4008` inside this
machine and the process refuses to start in production mode.

---

## E2b — sandbox enforcement (database + server)

_(section completed below once the E2b proofs ran)_
