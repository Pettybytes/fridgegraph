-- 0055 — Orbit post-close redaction, enforced in the database.
--
-- Bryan's rule: once an alert is FOUND_SAFE, a recipient keeps the outcome and the thank-you and
-- loses everything that describes the child — the descriptors, the stored message, the photo
-- reference, the last-seen place and time. The parent keeps the full record.
--
-- The web client already drops those fields. A client is not a boundary: a cold deep link replaying a
-- cached payload, a curl, or any future client would still read them. This migration moves the
-- guarantee into PostgreSQL.
--
-- TWO TRAPS, both tested rather than assumed:
--   1. a column-level REVOKE does NOT override a table-level SELECT grant. `authenticated` held BOTH
--      (`rDxtm` in relacl plus explicit column grants on every descriptor), so revoking columns alone
--      would have changed nothing. The table grant is revoked FIRST, then the sensitive columns, then
--      only the safe columns are granted back.
--   2. `orbit_photo_access` and `preview_orbit_share` still granted EXECUTE to PUBLIC (`=X` in
--      proacl), so any role could call them. EXECUTE is revoked from PUBLIC and granted to
--      `authenticated` only.
--
-- The sensitive accessor answers for a parent/guardian, or for a FROZEN audience member while the
-- alert is ACTIVE — never for "ACTIVE" alone, which would hand an active alert to an unrelated
-- caller. Identity is always `current_person()` from the authenticated caller; nothing is taken from
-- an argument.
--
-- Preserved on purpose: the parent's full access after closure, the recipient's status / close
-- outcome / thank-you / own response, Codex's client sanitizer, the 0037 photo gate, the stored
-- message, `_orbit_message_hash` and the append-only response history.

begin;

-- ---------------------------------------------------------------- sensitive accessor
create or replace function public.orbit_share_for(p_alert text)
returns table (
  wear_color        text,
  wear_garment      text,
  hair_desc         text,
  carry_color       text,
  carry_item        text,
  photo_id          text,
  minimal_message   text,
  last_seen_place_id text,
  last_seen_at      timestamptz,
  place_kind        text,
  place_label       text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.wear_color, a.wear_garment, a.hair_desc, a.carry_color, a.carry_item,
         a.photo_id, a.minimal_message, a.last_seen_place_id, a.last_seen_at,
         rp.kind, rp.label
    from public.orbit_alerts a
    left join public.recorded_places rp on rp.id = a.last_seen_place_id
   where a.id = p_alert
     and (
       public.is_parent_of(a.child_id)
       or (a.status = 'ACTIVE' and public._orbit_is_audience_member(a.id))
     )
$$;

revoke all on function public.orbit_share_for(text) from public, anon;
grant execute on function public.orbit_share_for(text) to authenticated;

comment on function public.orbit_share_for(text) is
  'Descriptors, stored message, photo reference and last-seen place/time for one alert. Answers a '
  'parent/guardian always, a frozen audience member only while ACTIVE, and nobody else.';

-- ---------------------------------------------------------------- place + thank-you, restated
-- The place follows the same rule as the descriptors now. It previously answered any frozen audience
-- member regardless of status, which is exactly the leak this migration closes.
create or replace function public.orbit_place_for(p_alert text)
returns table (id text, kind text, label text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.id, p.kind, p.label
    from public.orbit_alerts a
    join public.recorded_places p on p.id = a.last_seen_place_id
   where a.id = p_alert
     and (
       public.is_parent_of(a.child_id)
       or (a.status = 'ACTIVE' and public._orbit_is_audience_member(a.id))
     )
$$;

-- The thank-you is deliberately NOT status-gated: it exists BECAUSE the alert closed, and it is what
-- the recipient is meant to keep. It carries no descriptor, no place and no photo.
create or replace function public.orbit_thankyou_for(p_alert text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when a.status = 'CLOSED' then public._orbit_thankyou_for(a) end
    from public.orbit_alerts a
   where a.id = p_alert
     and (public.is_parent_of(a.child_id) or public._orbit_is_audience_member(a.id))
$$;

revoke all on function public.orbit_place_for(text) from public, anon;
revoke all on function public.orbit_thankyou_for(text) from public, anon;
grant execute on function public.orbit_place_for(text) to authenticated;
grant execute on function public.orbit_thankyou_for(text) to authenticated;

-- ---------------------------------------------------------------- PUBLIC execute, removed
-- `=X/postgres` in proacl means every role can execute. Nothing here needs that.
revoke all on function public.orbit_photo_access(text) from public, anon;
grant execute on function public.orbit_photo_access(text) to authenticated;

revoke all on function public.preview_orbit_share(text) from public, anon;
grant execute on function public.preview_orbit_share(text) to authenticated;

revoke all on function public.register_orbit_photo(text, text, text) from public, anon;
grant execute on function public.register_orbit_photo(text, text, text) to authenticated;

revoke all on function public.orbit_audience_for(text) from public, anon;
grant execute on function public.orbit_audience_for(text) to authenticated;

revoke all on function public.draft_orbit_share(text, text, text, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.draft_orbit_share(text, text, text, text, text, text, text, text, timestamptz) to authenticated;

revoke all on function public.activate_orbit_alert(text, integer, text) from public, anon;
grant execute on function public.activate_orbit_alert(text, integer, text) to authenticated;

revoke all on function public.respond_to_orbit_alert(text, text) from public, anon;
grant execute on function public.respond_to_orbit_alert(text, text) to authenticated;

revoke all on function public.close_orbit_alert(text, text) from public, anon;
grant execute on function public.close_orbit_alert(text, text) to authenticated;

revoke all on function public.orbit_vocab_ok(text, text) from public, anon;
grant execute on function public.orbit_vocab_ok(text, text) to authenticated;

-- ---------------------------------------------------------------- the column boundary
-- Table-level SELECT first: while it stands, no column REVOKE has any effect.
revoke select on table public.orbit_alerts from authenticated;

-- Then the explicit column grants that were added when the vocabulary landed.
revoke select (
  wear_color, wear_garment, hair_desc, carry_color, carry_item, photo_id,
  minimal_message, last_seen_place_id, last_seen_at,
  wearing, hair, carrying, distinctive
) on table public.orbit_alerts from authenticated;

-- Then grant back exactly what a caller may see for themselves.
grant select (
  id, child_id, created_by, created_at, status, draft_version,
  activated_by, activated_at, closed_by, closed_at, close_outcome,
  job_id, message_hash, sandbox, fixture
) on table public.orbit_alerts to authenticated;

-- Attacker roles left behind by earlier proofs held table-level SELECT on this table. They are
-- NOLOGIN, but a boundary that depends on that is not a boundary. Revoke and leave them otherwise.
do $$
declare r record;
begin
  for r in
    select ro.rolname as grantee
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
      join pg_roles ro on ro.oid = a.grantee
     where n.nspname = 'public' and c.relname = 'orbit_alerts'
       and ro.rolname like 'proof_attacker%'
  loop
    execute format('revoke all on table public.orbit_alerts from %I', r.grantee);
  end loop;
end $$;

commit;
