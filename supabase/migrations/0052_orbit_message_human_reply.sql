-- 0052 — Orbit message: say only what is known, and ask in human words.
--
-- The parent preview is the EXACT text recipients get, so two defects in the template were also
-- defects in what a real village would read:
--
--   1. absent descriptors were rendered as "Hair: not described." — a sentence that tells a reader
--      nothing, in a message whose whole job is to be scannable in an emergency;
--   2. replies were requested as raw enum codes ("Reply WITH_ME, ON_WAY, or CANNOT_HELP"), which is
--      not something a person texts back.
--
-- Fixed at the source: undescribed fields are omitted entirely, and the ask is human ("Reply 1 = With
-- me, 2 = On my way, 3 = Can't help."). The STORED response stays the controlled enum
-- WITH_ME / ON_WAY / CANNOT_HELP — `_orbit_reply_choice` maps either the number or the words onto it,
-- so the vocabulary, the no-location guarantee and the append-only response ledger are unchanged.
--
-- The message hash now covers the RENDERED message (plus the audience order), so a template change
-- necessarily produces a new hash and any preview minted under the old wording can no longer activate.

-- ---------------------------------------------------------------- template
create or replace function _orbit_message_for(p_alert orbit_alerts)
returns text
language sql stable security definer set search_path = public
as $$
  select concat_ws(' ',
    'FridgeGraph Orbit: check-in not recorded for ' || split_part(p.child_name, ' ', 1) || '.',
    case when trim(concat_ws(' ', p_alert.wear_color, p_alert.wear_garment)) <> ''
         then 'Wearing: ' || trim(concat_ws(' ', p_alert.wear_color, p_alert.wear_garment)) || '.' end,
    case when coalesce(trim(p_alert.hair_desc), '') <> ''
         then 'Hair: ' || trim(p_alert.hair_desc) || '.' end,
    case when trim(concat_ws(' ', p_alert.carry_color, p_alert.carry_item)) <> ''
         then 'Carrying: ' || trim(concat_ws(' ', p_alert.carry_color, p_alert.carry_item)) || '.' end,
    case when p_alert.photo_id is null then null else 'Photo attached.' end,
    'Reply 1 = With me, 2 = On my way, 3 = Can''t help.'
  )
  from (select display_name as child_name from people where id = p_alert.child_id) p
$$;

-- ---------------------------------------------------------------- reply parser
/**
 * Maps a human reply (or a legacy enum code) onto the stored enum. NULL means "not a valid reply".
 * Numbers are accepted because the message asks for a number; the words are accepted because people
 * answer in words. Nothing else is guessed.
 */
create or replace function _orbit_reply_choice(p_reply text)
returns text
language sql immutable
as $$
  with normalised as (
    -- Non-alphanumerics become spaces, not nothing: 'CANNOT_HELP' must normalise to 'cannot help'
    -- (the web client sends that enum), and '2.' must normalise to '2'.
    select btrim(regexp_replace(
             regexp_replace(lower(btrim(coalesce(p_reply, ''))), '[^a-z0-9'' ]', ' ', 'g'),
             '\s+', ' ', 'g'
           )) as v
  )
  select case v
    when '1' then 'WITH_ME'
    when 'with me' then 'WITH_ME'
    when 'with_me' then 'WITH_ME'
    when '2' then 'ON_WAY'
    when 'on my way' then 'ON_WAY'
    when 'on way' then 'ON_WAY'
    when 'on_way' then 'ON_WAY'
    when '3' then 'CANNOT_HELP'
    when 'can''t help' then 'CANNOT_HELP'
    when 'cant help' then 'CANNOT_HELP'
    when 'cannot help' then 'CANNOT_HELP'
    when 'cannot_help' then 'CANNOT_HELP'
    else null
  end
  from normalised
$$;

-- ---------------------------------------------------------------- responder accepts the ask
create or replace function respond_to_orbit_alert(p_alert text, p_response text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_alert orbit_alerts; v_id text; v_choice text;
begin
  v_choice := _orbit_reply_choice(p_response);
  if v_choice is null then
    raise exception 'ORBIT_BAD_RESPONSE' using errcode = '22023';
  end if;
  select * into v_alert from orbit_alerts where id = p_alert;
  if not found then raise exception 'ORBIT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_alert.status <> 'ACTIVE' then raise exception 'ORBIT_NOT_ACTIVE' using errcode = '22023'; end if;
  if not exists (select 1 from orbit_audience_members m
                  where m.orbit_alert_id = p_alert and m.person_id = current_person()) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  v_id := 'or_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into orbit_responses (id, orbit_alert_id, person_id, response)
  values (v_id, p_alert, current_person(), v_choice);
  return v_id;
end $$;

-- ---------------------------------------------------------------- hash covers the wording
create or replace function _orbit_message_hash(p_alert orbit_alerts)
returns text
language sql stable security definer set search_path = public, extensions
as $$
  select encode(digest(
    _orbit_message_for(p_alert) || '|' ||
    coalesce((select string_agg(a.person_id, ',' order by a.notify_order)
                from orbit_audience_for(p_alert.child_id) a), '')
  , 'sha256'), 'hex')
$$;

grant execute on function _orbit_reply_choice(text) to authenticated;
