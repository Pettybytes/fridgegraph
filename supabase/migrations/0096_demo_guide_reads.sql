-- Restore sandbox-wide guide reads. Parent and grant predicates remain unchanged.
-- The operator applies this migration with the application release.
begin;

-- An explicit server-issued read identity, never a family member or a client flag.
-- Existing SELECT policies consume this predicate together with sandbox provenance.
create or replace function public.is_demo_guide()
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.current_person() = 'p_demo_guide'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'demo_guide', 'false') = 'true'
$$;


create or replace function public.guide_reads_child(p_child text)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.current_person() is not null and public.is_demo_guide() and public.is_sandbox_child(p_child)
$$;
revoke all on function public.guide_reads_child(text) from public, anon;
grant execute on function public.guide_reads_child(text) to authenticated;

create or replace function village_places_for_child(p_child text)
returns table (id text, kind text, label text, latitude numeric, longitude numeric, state text)
language sql
stable
security definer
set search_path = public
as $$
  with gate as (
    select
      ((public.is_parent_of(p_child) or public.guide_reads_child(p_child)) or public.has_scope(p_child, 'schedule.read')) as may_see,
      ((public.is_parent_of(p_child) or public.guide_reads_child(p_child)) or public.has_scope(p_child, 'address.read'))  as may_locate
  )
  select
    rp.id,
    rp.kind,
    rp.label,
    case when gate.may_locate then rp.latitude end,
    case when gate.may_locate then rp.longitude end,
    case
      when not gate.may_locate then 'withheld'
      when rp.latitude is null or rp.longitude is null then 'absent'
      else 'granted'
    end
  from recorded_places rp, gate
  where gate.may_see
    and rp.household_id in (
      select m.household_id from household_members m where m.person_id = p_child
    )
  order by rp.kind, rp.label
$$;

create or replace function public.place_route_geometry_for(p_child text, p_place text)
returns table (id text, label text, state text, latitude numeric, longitude numeric)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with rel as (
    select ((public.is_parent_of(p_child) or public.guide_reads_child(p_child))
            or exists (
                 select 1 from public.grants g
                  where g.actor_id = public.current_person()
                    and g.child_id = p_child
                    and (g.valid_from is null or current_date >= g.valid_from)
                    and (g.valid_until is null or current_date <= g.valid_until)
               )) as may_see,
           ((public.is_parent_of(p_child) or public.guide_reads_child(p_child)) or public.has_scope(p_child, 'address.read')) as may_locate
  )
  select p.id,
         p.label,
         case
           when not rel.may_locate then 'withheld'
           when p.latitude is null or p.longitude is null then 'absent'
           else 'granted'
         end,
         case when rel.may_locate then p.latitude  end,
         case when rel.may_locate then p.longitude end
    from public.recorded_places p, rel
   where p.id = p_place
     and rel.may_see
     -- same family rule as 0056: another family's place answers like a missing one
     and p.household_id in (
       select m.household_id from public.household_members m where m.person_id = p_child
     )
$$;

create or replace function public.event_day_places(p_child text, p_day date)
returns table (
  event_id    text,
  title       text,
  start_at    timestamp,
  state       text,
  place_id    text,
  place_label text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  with gate as (
    select ((public.is_parent_of(p_child) or public.guide_reads_child(p_child)) or public.has_scope(p_child, 'schedule.read')) as may_see
  )
  select e.id,
         e.title,
         e.start_at,
         case when e.place_id is null then 'unlinked'
              when rp.id is null      then 'withheld'
              else 'linked' end,
         case when rp.id is not null then e.place_id end,
         case when rp.id is not null then rp.label   end
    from public.events e
    cross join gate
    left join public.recorded_places rp
      on rp.id = e.place_id
     and rp.household_id in (
       select hm.household_id from public.household_members hm where hm.person_id = p_child
     )
   where e.child_id = p_child
     and e.start_at::date = p_day
     and gate.may_see
   order by e.start_at, e.id
$$;

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
  last_seen_source  text,
  place_kind        text,
  place_label       text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.wear_color, a.wear_garment, a.hair_desc, a.carry_color, a.carry_item,
         a.photo_id, a.minimal_message,
         case when a.last_seen_source is null then null else a.last_seen_place_id end,
         case when a.last_seen_source is null then null else a.last_seen_at end,
         a.last_seen_source,
         case when a.last_seen_source is null then null else rp.kind end,
         case when a.last_seen_source is null then null else rp.label end
    from public.orbit_alerts a
    left join public.recorded_places rp on rp.id = a.last_seen_place_id
   where a.id = p_alert
     and (
       public.is_parent_of(a.child_id)
       or (public.guide_reads_child(a.child_id) and a.sandbox)
       or (a.status = 'ACTIVE' and public._orbit_is_audience_member(a.id))
     )
$$;

create policy demo_guide_fridge_preferences on public.fridge_item_preferences
for select to authenticated using (public.guide_reads_child(child_id));
create policy demo_guide_recorded_places on public.recorded_places
for select to authenticated using (
  public.is_demo_guide() and exists (
    select 1 from public.household_members m
    where m.household_id = recorded_places.household_id and m.role = 'child'
      and public.guide_reads_child(m.person_id)
  )
);
create policy demo_guide_orbit_audience on public.orbit_audience_members
for select to authenticated using (
  public.is_demo_guide() and exists (
    select 1 from public.orbit_alerts a where a.id = orbit_alert_id
      and a.sandbox and public.guide_reads_child(a.child_id)
  )
);
create policy demo_guide_orbit_responses on public.orbit_responses
for select to authenticated using (
  public.is_demo_guide() and exists (
    select 1 from public.orbit_alerts a where a.id = orbit_alert_id
      and a.sandbox and public.guide_reads_child(a.child_id)
  )
);
create policy demo_guide_fridge_notes on public.fridge_notes
for select to authenticated using (public.guide_reads_child(child_id));
create or replace function orbit_photo_access(p_photo text)
returns table (access text, storage_path text, child_id text)
language sql
stable
security definer
set search_path = public
as $$
  with ph as (
    select id, child_id, storage_path from orbit_photos where id = p_photo
  ),
  alert as (
    select al.id, al.status
      from orbit_alerts al
     where al.photo_id = p_photo
     order by al.activated_at desc nulls last, al.created_at desc
     limit 1
  ),
  lvl as (
    select case
             when (select is_parent_of(child_id) from ph) then 'PARENT'
             when (select public.guide_reads_child(child_id) from ph) then 'GUIDE'
             when (select status from alert) = 'ACTIVE'
                  and (select _orbit_is_audience_member((select id from alert))) then 'AUDIENCE'
             else null
           end as access
  )
  select lvl.access,
         case when lvl.access is not null then (select storage_path from ph) else null end,
         case when lvl.access is not null then (select child_id from ph) else null end
    from lvl
$$;
create or replace function public.pin_media_access(p_media text)
returns table(access text,storage_path text,child_id text,mime_type text)
language sql stable security definer set search_path=public as $$
 with m as (select pm.* from public.pin_media pm where pm.id=p_media),
 lvl as (select case when (select public.is_parent_of(m.child_id) from m) then 'PARENT'
 when (select public.guide_reads_child(m.child_id) from m) then 'GUIDE'
 when exists(select 1 from public.fridge_notes fn join m on m.id=fn.attachment_ref and m.child_id=fn.child_id
 where fn.audience='SHARED' and public.has_scope(fn.child_id,'fridge.read')) then 'SHARED' else null end as access)
 select lvl.access,
 case when lvl.access is not null then (select m.storage_path from m) end,
 case when lvl.access is not null then (select m.child_id from m) end,
 case when lvl.access is not null then (select m.mime_type from m) end from lvl
$$;

-- Restrict the older row-marked policies to the fictional family grant too.
alter policy demo_guide_coordination_jobs on public.coordination_jobs
using (public.guide_reads_child(child_id) and sandbox);
alter policy demo_guide_orbit_alerts on public.orbit_alerts
using (public.guide_reads_child(child_id) and sandbox);
create policy demo_guide_villager_proposals on public.villager_proposals
for select to authenticated using (public.guide_reads_child(child_id));

commit;
