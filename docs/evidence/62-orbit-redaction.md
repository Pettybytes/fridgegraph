# Evidence 62 — Orbit post-close redaction (database boundary)

**Branch `feat/orbit-redaction` from `main` `9d73892`. Migration 0055.**

## The two traps, both tested

1. **A column REVOKE does not override a table-level SELECT.** `authenticated` held BOTH
   (`rDxtm` in `relacl` plus explicit grants on `wear_color`, `minimal_message`, `photo_id`,
   `last_seen_at`, …). Revoking columns alone would have changed nothing. 0055 revokes the table
   grant first, then the sensitive columns, then grants back only the safe ones.
2. **`orbit_photo_access` and `preview_orbit_share` granted EXECUTE to PUBLIC** (`=X` in `proacl`).
   Any role could call them. EXECUTE is now revoked from PUBLIC and granted to `authenticated`.

## The accessor

`orbit_share_for(p_alert)` returns descriptors, stored message, photo id, place and time for a
parent/guardian, **or** a frozen audience member **while ACTIVE** — never "ACTIVE" alone, which would
hand an active alert to an unrelated caller. Identity comes from `current_person()`; nothing is taken
from an argument. `search_path` is pinned to `pg_catalog, public`, every name is schema-qualified,
EXECUTE is revoked from PUBLIC.

`orbit_place_for` now follows the same rule (it previously answered any frozen audience member
regardless of status — the leak this closes). `orbit_thankyou_for` stays deliberately status-free: the
thank-you exists *because* the alert closed and carries no descriptor, place or photo.

## Proof

Rolled-back dry run `ops/0055-dry-run.mjs`: **25/25**, including a real registered photo so the photo
gate is measured rather than vacuous.

Live proof `ops/orbit-redaction-proof.mjs`: **33/33**, real credentials, receipt
`62-orbit-redaction.json`. Bypass routes tested: GraphQL, **direct PostgREST table read** (403 on the
sensitive columns even while ACTIVE), **PostgREST RPC** (`orbit_share_for` → `[]` after the close),
and the **photo endpoint** (200 → 404). After the close the recipient keeps status, outcome,
thank-you and their own response; the parent keeps everything including the photo (`PARENT`).

The photo endpoint never mints a signed URL — every GET re-evaluates the accessor and streams the
bytes itself — so no URL can outlive the close. The question is answered by construction, and the
same GET that returned bytes before the close returns 404 after it.

## Deploy coupling (stated, not discovered later)

`main`'s resolver reads the columns 0055 revokes. **The migration and the resolver must ship in the
same deploy.** This window applied 0055, served the branch, proved the boundary, then reverted the
grants (`ops/0055-revert.mjs`) so the restored `main` would keep serving. The migration is not
deleted; it is re-established the moment it is applied again alongside the resolver.

## Behaviour change to review

The read-only demo guide gets the alert shell but **no descriptors, message, place or photo**, because
`orbit_share_for` does not include the guide. That is stricter than before and matches "the guide must
not bypass"; it is called out because the guide is a demo affordance.
