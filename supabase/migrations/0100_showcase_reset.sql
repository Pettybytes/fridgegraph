-- Owner-only atomic restore for the writable Ellison showcase, never a global reset.
begin;
create function public.restore_showcase_snapshot(p_actor text,p_run_id uuid,p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 children text[]; t text; rows jsonb; fixture_row jsonb; cols text; n int; receipt jsonb;
 cleared jsonb:='{}'; restored jsonb:='{}'; prior public.demo_reset_runs%rowtype;
 tables constant text[]:=array['orbit_alerts','school_report_proposals','villager_proposals',
 'coordination_jobs','conversation_state','fridge_item_preferences','fridge_notes','goals',
 'care_plans','care_facts','events','school_reports','permission_slips','grants'];
begin
 if p_actor<>'p_demo_guide' then raise exception 'SHOWCASE_RESET_ACTOR_REFUSED' using errcode='42501'; end if;
 if not pg_try_advisory_xact_lock(918273645) then raise exception 'RESET_IN_FLIGHT' using errcode='55P03'; end if;
 select * into prior from demo_reset_runs where run_id=p_run_id;
 if found then
  if prior.actor<>p_actor then raise exception 'RESET_RUN_NOT_OWNED' using errcode='42501'; end if;
  return prior.report;
 end if;
 if jsonb_typeof(p_snapshot)<>'object' or not(p_snapshot ?& array['care_plans','events','goals']) then
  raise exception 'RESET_SNAPSHOT_REQUIRED';
 end if;
 select array_agg(g.child_id) into children from showcase_parent_grants g
 where g.enabled and exists(select 1 from household_members m join households h on h.id=m.household_id
  where m.person_id=g.child_id and m.role='child' and h.sandbox and h.id in ('h_a','h_b'));
 -- Only relationships actually created by this showcase's proposal are disposable.
 delete from relationships r using villager_proposals p
 where p.child_id=any(children) and p.relationship_id is null and r.id=p.confirmed_relationship_id and r.to_id=any(children);
 foreach t in array tables loop
  execute format('delete from public.%I r where r.child_id=any($1) and coalesce(to_jsonb(r)->>''sandbox'',''true'')=''true''',t) using children;
  get diagnostics n=row_count; cleared:=cleared||jsonb_build_object(t,n);
 end loop;
 -- Restore child rows first, then job-dependent receipts. Snapshot values are supplied
 -- exclusively by the owner process from versioned fixtures, never an HTTP body.
 foreach t in array array['goals','care_plans','care_facts','events','school_reports','permission_slips','grants',
 'coordination_jobs','attempts','candidate_evaluations','confirmations','voice_notes','fridge_notes','fridge_item_preferences'] loop
  rows:=coalesce(p_snapshot->t,'[]');
  if t in ('attempts','candidate_evaluations','confirmations','voice_notes') then
   select coalesce(jsonb_agg(r),'[]') into rows from jsonb_array_elements(rows) r
   where exists(select 1 from coordination_jobs j where j.id=r->>'job_id' and j.child_id=any(children) and j.sandbox);
  else
   select coalesce(jsonb_agg(r),'[]') into rows from jsonb_array_elements(rows) r where r->>'child_id'=any(children);
  end if;
  if jsonb_array_length(rows)=0 then continue; end if;
  n:=0;
  for fixture_row in select value from jsonb_array_elements(rows) loop
   select string_agg(format('%I',k),',') into cols from jsonb_object_keys(fixture_row) k;
   execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict do nothing',t,cols) using fixture_row;
   n:=n+1;
  end loop;
  restored:=restored||jsonb_build_object(t,n);
 end loop;
 receipt:=jsonb_build_object('restored',restored,'cleared',cleared,'demoDecisionsCleared',0,'createdFamiliesRemoved',0,'familyRows','[]'::jsonb);
 insert into demo_reset_runs(run_id,actor,report) values(p_run_id,p_actor,receipt);
 return receipt;
end $$;
revoke all on function public.restore_showcase_snapshot(text,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
