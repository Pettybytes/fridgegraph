-- 0054 — Orbit close: an outcome, and the thank-you that belongs to the same explicit close.
--
-- Closing used to record only that someone closed it. That is not what a village needs to hear: the
-- people who dropped everything to look need to know the child was found. So a close now carries a
-- `close_outcome`, and the SAME explicit action delivers one thank-you to the FROZEN audience.
--
-- Deliberate limits:
--   * status stays CLOSED — the outcome does not add a state, so every existing read still works;
--   * FOUND_SAFE is the only outcome this slice records; NULL means "closed before outcomes existed",
--     and the constraint below keeps an outcome off a draft or an active alert;
--   * only a parent or guardian closes (`is_parent_of` already covers both roles);
--   * WITH_ME never closes — responding and closing remain different acts;
--   * the close and the thank-you are IDEMPOTENT: a retry returns the existing close and writes
--     nothing, so a retried request cannot send a second thank-you.

begin;

alter table orbit_alerts add column if not exists close_outcome text;

alter table orbit_alerts drop constraint if exists orbit_close_outcome_values;
alter table orbit_alerts add constraint orbit_close_outcome_values
  check (close_outcome is null or close_outcome in ('FOUND_SAFE'));

alter table orbit_alerts drop constraint if exists orbit_close_outcome_only_when_closed;
alter table orbit_alerts add constraint orbit_close_outcome_only_when_closed
  check (close_outcome is null or status = 'CLOSED');

-- One thank-you per frozen audience member, written inside the close.
alter table orbit_audience_members add column if not exists thankyou_at timestamptz;
alter table orbit_audience_members add column if not exists thankyou_outcome text;
alter table orbit_audience_members drop constraint if exists orbit_thankyou_outcome_values;
alter table orbit_audience_members add constraint orbit_thankyou_outcome_values
  check (thankyou_outcome is null or thankyou_outcome in ('SIMULATED', 'PENDING_SEND'));

-- ---------------------------------------------------------------- thank-you text
/**
 * The exact words a recipient gets. Rendered from stored data only, so the same close always
 * produces the same sentence and the preview/close wording cannot drift apart.
 */
create or replace function _orbit_thankyou_for(p_alert orbit_alerts)
returns text
language sql stable security definer set search_path = public
as $$
  select 'FridgeGraph Orbit: ' || split_part(p.child_name, ' ', 1) ||
         ' was found safe and sound. Thank you for being there.'
    from (select display_name as child_name from people where id = p_alert.child_id) p
$$;

-- ---------------------------------------------------------------- close
drop function if exists close_orbit_alert(text);

create or replace function close_orbit_alert(p_alert text, p_outcome text default 'FOUND_SAFE')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_alert orbit_alerts; v_outcome text;
begin
  select * into v_alert from orbit_alerts where id = p_alert for update;
  if not found then raise exception 'ORBIT_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Parent or guardian only. An audience member — including one who answered WITH_ME — cannot close.
  if not is_parent_of(v_alert.child_id) then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;

  v_outcome := nullif(upper(btrim(coalesce(p_outcome, ''))), '');
  if v_outcome is null then v_outcome := 'FOUND_SAFE'; end if;
  if v_outcome <> 'FOUND_SAFE' then
    raise exception 'ORBIT_BAD_OUTCOME' using errcode = '22023';
  end if;

  -- Idempotent: a retry returns the existing close and sends nothing new, whatever outcome it names.
  if v_alert.status = 'CLOSED' then return v_alert.id; end if;
  if v_alert.status <> 'ACTIVE' then raise exception 'ORBIT_NOT_ACTIVE' using errcode = '22023'; end if;

  update orbit_alerts
     set status = 'CLOSED', closed_by = current_person(), closed_at = now(),
         close_outcome = v_outcome
   where id = p_alert
   returning * into v_alert;

  -- ONE thank-you per frozen audience member, and only if this close is the first one. The
  -- `thankyou_at is null` predicate is the second line of defence for the idempotency above.
  update orbit_audience_members
     set thankyou_at = now(),
         thankyou_outcome = case when is_demo_caller() then 'SIMULATED' else 'PENDING_SEND' end
   where orbit_alert_id = p_alert and thankyou_at is null;

  return p_alert;
end $$;

-- ---------------------------------------------------------------- audience-facing reads
/**
 * The place for one alert, gated by the SAME rule as the message: a parent/guardian, or a member of
 * the FROZEN audience. Nobody else — including a family member who is not in this alert's audience
 * — gets a row, and a missing place answers exactly like a place they may not see.
 *
 * This exists because `recorded_places` is household-scoped by RLS: an audience member (a
 * grandparent, a neighbour) is often not a household member, so a plain table read would hide the
 * label from the very people the alert is about. The gate is re-stated here in one place.
 */
create or replace function orbit_place_for(p_alert text)
returns table (id text, kind text, label text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.kind, p.label
    from orbit_alerts a
    join recorded_places p on p.id = a.last_seen_place_id
   where a.id = p_alert
     and (is_parent_of(a.child_id) or _orbit_is_audience_member(a.id))
$$;

/** The thank-you for one alert, under the same audience gate. Null while the alert is not closed. */
create or replace function orbit_thankyou_for(p_alert text)
returns text
language sql stable security definer set search_path = public
as $$
  select case when a.status = 'CLOSED' then _orbit_thankyou_for(a) end
    from orbit_alerts a
   where a.id = p_alert
     and (is_parent_of(a.child_id) or _orbit_is_audience_member(a.id))
$$;

revoke all on function orbit_place_for(text) from public, anon;
revoke all on function orbit_thankyou_for(text) from public, anon;
grant execute on function orbit_place_for(text) to authenticated;
grant execute on function orbit_thankyou_for(text) to authenticated;

-- ---------------------------------------------------------------- audience read after close
-- Requirement (d): a recipient must still see the alert status, the close outcome and the thank-you
-- after the close. The 0032 policy gated the audience on `status = 'ACTIVE'`, so the moment a parent
-- closed the alert the very people who had been looking lost their own record. The gate is now the
-- FROZEN MEMBERSHIP ROW, which is created at activation and never removed, rather than the status.
-- Nothing widens: only a row in orbit_audience_members can pass, and the audience own-row policy
-- still pins it to `person_id = current_person()`.
drop policy if exists orbit_alerts_audience on orbit_alerts;
create policy orbit_alerts_audience on orbit_alerts for select to authenticated
  using (_orbit_is_audience_member(id));

drop policy if exists orbit_audience_own on orbit_audience_members;
create policy orbit_audience_own on orbit_audience_members for select to authenticated
  using (person_id = current_person() and _orbit_is_audience_member(orbit_alert_id));

revoke all on function close_orbit_alert(text, text) from public, anon;
grant execute on function close_orbit_alert(text, text) to authenticated;

commit;
