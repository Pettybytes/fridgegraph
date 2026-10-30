# 26 — EXECUTE posture after 0012 (anon refused, authenticated intact)

- endpoint: `https://<project>.supabase.co/rest/v1/rpc/…` (PostgREST, publishable key; no service role)
- run: 2026-10-30T23:16:27.062Z
- identity: real Supabase password-grant JWTs per caller; tokens redacted, never stored
- migration under test: `supabase/migrations/0012_revoke_public_execute.sql`

## anon (publishable key, no user token) — must be refused

| function | HTTP | code |
| --- | --- | --- |
| `current_person` | 401 | 42501 |
| `local_today` | 401 | 42501 |
| `is_parent_of` | 401 | 42501 |
| `has_scope` | 401 | 42501 |

## authenticated (Kendra) — must still execute

| function | HTTP |
| --- | --- |
| `current_person` | 200 |
| `local_today` | 200 |
| `is_parent_of` | 200 |
| `has_scope` | 200 |

## Authorization logic unchanged

- Angela (holds `pickup.verify` for Nora) → `pickup_candidates_for`: HTTP 200, 18 row(s)
- Walter (no pickup rights) → `pickup_candidates_for`: HTTP 200, 0 row(s)

Revoking PUBLIC removed inherited EXECUTE from `authenticated` as well, so the migration
re-grants it explicitly. Both sides are asserted: anon is refused AND a real authorized
caller still receives rows. Function bodies and RLS policies are untouched by the migration.
