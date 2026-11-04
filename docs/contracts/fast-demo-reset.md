# Fast shared demo reset

The browser makes one `POST /api/demo/reset` with `{runId: <UUID v4>}` and its current demo bearer.
The endpoint derives the actor and permitted seeded persona from the verified JWT and server cast.
Seeded parents, guardians and the marked Demo guide may reset; caregivers cannot. This is the
single guide-write exception. Origin, loopback, per-client-IP, cooldown and serialization guards
remain. Created-family personas cannot reset the baseline that would remove their own identity.

Migration0096 adds the owner-only `restore_demo_snapshot(actor,runId,fixtures,cast)` function and
private `demo_reset_runs` table. Canonical fixture data is supplied only by server code. There is no
public snapshot RPC grant, table truncate, new policy, dispatch or provider outreach. The single
statement preserves sandbox/known-ID deletion scope, original fixture/Cast precedence, existing
privileged reset helpers and transactional rollback. Identical upserts skip unnecessary updates.
A runId belongs to one actor; a repeated runId returns that actor's original committed receipt.

The200 response is `{ok:true,runId,status:'committed',personaId,session}`. `session` is the existing
public Supabase session shape, never its refresh token. Session mint wait is bounded; null retains
the still-valid caller bearer and normal renewal. A committed data restore cannot become a false
rollback report because minting or external account disposal fails.

A lost/timed-out POST is followed only by `GET /api/demo/reset/:runId`, with the same current bearer.
Status is running, committed, failed or unknown. Committed receipts survive process restart. Only
explicit SQL abort errors establish failed; connection-resolution errors remain unknown. Status
reads are actor-scoped and limited per client. Bounded unresolved recovery retains the perspective,
clears stale local stores and asks the user to check current data; it never retries the mutation.

The browser swaps a returned token before starting new reads, clears private caches, increments its
local generation and retains persona, child scope and route. No GraphQL confirmation read blocks
success. The black shared pill closes its accessible confirmation, restores focus and shows a short
success toast. A late response cannot change a newer perspective.

External created-account cleanup runs after commit. Its sweep cutoff is the original durable reset
time with a60-second grace, including on replay. A pending family whose marker was removed by reset
cannot activate and compensates its Auth account instead of committing an unregistered identity.

Deployment order: Bentley rehearses and applies0096 before starting the new demo backend, then
serves the matching frontend. This migration is forward-only. Do not edit an applied migration.
No seed command is required to install the function; the first reset supplies the canonical rows.

Local database proof:

```bash
docker run --rm --detach --name fg-reset-fast-proof --env POSTGRES_HOST_AUTH_METHOD=trust --publish 127.0.0.1:56439:5432 postgres:16-alpine
node --import tsx ops/fast-reset-proof.ts
```

The proof creates a separate database and never reads shared runtime database configuration. After
Bentley deploys the matched backend and frontend, the following command intentionally restores the
shared public demo ONCE and asserts under2000ms plus Kendra's retained perspective:

```bash
cd web
RESET_ALLOW_SHARED=1 RESET_BASE_URL=https://fridgegraph.loomz.stream npx playwright test -c playwright.reset.config.ts
```

Claude owns final served acceptance. The queued five-second live analytics work is a separate slice.
