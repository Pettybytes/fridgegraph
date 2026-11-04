-- Fictional display locations, never GPS or a person's real address.
begin;
alter table recorded_places drop constraint recorded_places_kind_check;
alter table recorded_places add constraint recorded_places_kind_check check(kind in ('SCHOOL_PICKUP','PRACTICE_FIELD','PARK','HOME'));
create table showcase_person_places(
 child_id text references children(person_id) on delete cascade,
 person_id text references people(id) on delete cascade,
 place_id text references recorded_places(id) on delete cascade,
 primary key(child_id,person_id)
);
alter table showcase_person_places enable row level security;
revoke all on showcase_person_places from public,anon,authenticated,service_role;
create function seed_showcase_person_places(p_children text[] default null) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; n integer:=0; place text; label_text text;
begin
 for r in
 with children_in_showcase as (
 select distinct c.person_id child_id,first_value(m.household_id) over(partition by c.person_id order by m.household_id) household_id
 from children c join household_members m on m.person_id=c.person_id and m.role='child'
 join households h on h.id=m.household_id and h.sandbox
 where c.person_id=any(array['p_nora','p_max','p_leo','p_jax','p_emma','p_malik','p_avery','p_micah','p_skye','p_taylor'])
 and (p_children is null or c.person_id=any(p_children))
 ), roster as (
 select c.*,m.person_id from children_in_showcase c join household_members m on m.household_id=c.household_id where m.role<>'child'
 union select c.*,rel.from_id from children_in_showcase c join relationships rel on rel.to_id=c.child_id
 union select c.*,g.actor_id from children_in_showcase c join grants g on g.child_id=c.child_id
 ) select distinct ro.*,p.display_name from roster ro join people p on p.id=ro.person_id where p.id=any(array['p_nora','p_mom','p_dad','p_leo','p_max','p_gma','p_bryan','p_walter','p_gloria','p_tasha','p_monique','p_chris','p_priya','p_price','p_okafor','p_jennings','p_holt','p_marcus','p_jax','p_dana','p_ray','p_evelyn','p_rosa','p_tomas','p_emma','p_felicia','p_taylor','p_skye','p_simone','p_denise','p_micah','p_avery','p_dwayne','p_malik','p_cassandra','p_oscar','p_whitfield'])
 loop
  place:='showcase_'||substr(md5(r.household_id||':'||r.person_id),1,20);
  label_text:='Fictional home for '||r.display_name;
  insert into recorded_place_catalog(label) values(label_text) on conflict do nothing;
  insert into recorded_places(id,household_id,kind,label,latitude,longitude,sandbox,fixture)
  values(place,r.household_id,'HOME',label_text,42.32+(('x'||substr(md5(r.person_id),1,6))::bit(24)::int%100)*0.0006,
   -83.12+(('x'||substr(md5(r.person_id),7,6))::bit(24)::int%100)*0.0007,true,true)
  on conflict(id) do update set latitude=excluded.latitude,longitude=excluded.longitude;
  insert into showcase_person_places values(r.child_id,r.person_id,place)
  on conflict(child_id,person_id) do update set place_id=excluded.place_id;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function seed_showcase_person_places(text[]) from public,anon,authenticated,service_role;
create function showcase_person_places_for_child(p_child text)
returns table(person_id text,place_id text) language sql stable security definer set search_path=pg_catalog,public as $$
 select s.person_id,s.place_id from showcase_person_places s
 join recorded_places p on p.id=s.place_id and p.sandbox and p.fixture
 join households h on h.id=p.household_id and h.sandbox
 where s.child_id=p_child and (is_parent_of(p_child) or guide_reads_child(p_child) or has_scope(p_child,'address.read'))
 and p.household_id in(select household_id from household_members where person_id=p_child and role='child')
$$;
revoke all on function showcase_person_places_for_child(text) from public,anon;
grant execute on function showcase_person_places_for_child(text) to authenticated;
-- Both existing global reset and the guide's scoped reset call this seed hook.
alter function seed_recorded_places() rename to seed_recorded_places_before_showcase;
revoke all on function seed_recorded_places_before_showcase() from public,anon,authenticated,service_role;
create function seed_recorded_places() returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin n:=seed_recorded_places_before_showcase();return n+seed_showcase_person_places();end $$;
revoke all on function seed_recorded_places() from public,anon;
grant execute on function seed_recorded_places() to authenticated,service_role;
create function showcase_route_allowed(p_child text,p_from text,p_to text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select p_child=any(array['p_nora','p_max','p_leo','p_jax','p_emma','p_malik','p_avery','p_micah','p_skye','p_taylor'])
 and (is_parent_of(p_child) or guide_reads_child(p_child) or has_scope(p_child,'address.read'))
 and (select count(*) from recorded_places p join households h on h.id=p.household_id and h.sandbox
 where p.id=any(array[p_from,p_to]) and p.sandbox and p.fixture
 and p.household_id in(select household_id from household_members where person_id=p_child and role='child'))
 =case when p_from=p_to then 1 else 2 end
$$;
revoke all on function showcase_route_allowed(text,text,text) from public,anon;
grant execute on function showcase_route_allowed(text,text,text) to authenticated;
alter function restore_showcase_snapshot(text,uuid,jsonb) rename to restore_showcase_snapshot_before_map;
revoke all on function restore_showcase_snapshot_before_map(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function restore_showcase_snapshot(p_actor text,p_run_id uuid,p_snapshot jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare report jsonb;
begin
 report:=restore_showcase_snapshot_before_map(p_actor,p_run_id,p_snapshot);
 perform seed_showcase_person_places(array['p_nora','p_max','p_leo']);
 return report;
end $$;
revoke all on function restore_showcase_snapshot(text,uuid,jsonb) from public,anon,authenticated,service_role;
select seed_showcase_person_places();
commit;
