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

## Public acceptance follow-up, November 4 UTC

The public index served `index-DbcpDZiq.js`. The protected UUID status route returned401 JSON,
and the new black-pill AlertDialog rendered at desktop and390x844. Served reset source hashes
matched reviewed head6c0fda1. Bentley's full deployment/migration receipt remains required.

The strict under2000ms public acceptance gate failed. One diagnostic interval returned502 from
both POST and status GET; backend and static-proxy PIDs changed during those observations.
The UI showed uncertainty at5985.2ms while preserving Kendra and the route. A restart is a possible
explanation for that interval, not a proven root cause.

After health recovered and the observed PIDs stayed unchanged, the strict gate failed again.
Run `bc34b9aa-3094-4d01-80ba-83409bc016d5` received nine successful status GET responses
(83-413ms each) without confirming a commit before bounded recovery ended. Kendra remained
signed in and uncertainty was visible. A later read-only status GET returned committed with
a fresh Kendra session in146.7ms. That later read duration is not the reset duration. The full
public commit latency is unknown, and no successful public after measurement is claimed.

The acceptance test now observes bounded recovery after a missed deadline and logs only paths,
HTTP status, timing and UI booleans. It rethrows the original deadline failure; the2000ms limit
and committed-response requirements are unchanged. No session payload or credential is logged.
Bentley has the run ID for numeric connection, query and lock-wait investigation. No additional
shared reset should be inferred from test discovery or offline checks. Reset acceptance stays open;
Claude owns served PASS, and live analytics implementation remains queued behind this fix.
