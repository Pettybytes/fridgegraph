# Fast demo reset, developer evidence

Public before measurement, November 4 UTC, from the Kendra perspective at
https://fridgegraph.loomz.stream/#/mission-control:

- Native Confirm click to uncertainty and picker: **60,271.1 ms**.
- No reset HTTP response arrived before the client abandoned the request.
- Kendra was no longer signed in. The red uncertainty text was visible.
- The client has a 60-second abort. Both committed success and uncertainty previously called
  `clearAfterReset`, deliberately deleting this tab's perspective.

The first timing capture failed during final result collection; the repeated capture above stored
its clock in the browser and returned the complete result. Both attempts reproduced ejection.

The new path sends a client-generated UUID, restores canonical rows in one owner-only SQL statement,
and commits an actor-owned receipt in that same transaction. Existing scoped cleanup and privileged
Orbit eligibility helpers stay inside it. External account cleanup runs separately after commit.
The caller receives the fresh Supabase session when available; a slow mint cannot relabel a proven
commit as failure. Only explicit SQL rollback codes establish failure. Connection ambiguity is
resolved using GET status for the same run, never by replaying POST.

Reset is a narrowly authorized exception for the seeded parents/guardians and the verified Demo
guide. Caregivers and non-demo identities are refused. Other guide actions remain read-only. No
RLS policy or ordinary Orbit append-only rule is changed.

Local migration rehearsal uses an isolated Postgres16 Docker server at 127.0.0.1:56439, with no
shared connection configuration. It applies the migration history, inserts canonical fixtures,
and checks idempotency, protected sentinels, pending-family activation after reset, early and late
injected-failure rollback, receipt/audit rollback, and refusal of anon/authenticated/service-role
execution. The payload retains the existing reset's216 simulated jobs plus20 legacy history jobs.
The pure TypeScript baseline exporter is shared with the existing seed source.

The old provenance guard test initially failed because it expected an individual TypeScript RPC
call. It now checks the TypeScript-to-atomic-function link and the same provenance-before-Orbit-audit
ordering inside SQL; the real database proof covers transaction rollback.

Public after timing and independent served acceptance remain pending Bentley's0096 rehearsal,
migration application, backend/frontend deployment, and Claude's verification. No shared migration
was applied by the fix owner.
