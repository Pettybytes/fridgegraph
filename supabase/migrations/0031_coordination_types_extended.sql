-- 0031 — widen the coordination type enum: CONSENT, ORBIT_ALERT, SUPERVISION.
--
-- Pure constraint widening, zero behavioural change: no table or function behind these types exists
-- yet in this migration. ORBIT_ALERT's tables land in 0032; CONSENT and SUPERVISION stay unbuilt.
--
-- PICKUP ISOLATION is NOT established here (there is nothing to isolate yet). It is established by
-- 0032: an ORBIT_ALERT job can never enter pickup candidate evaluation, ranking, costing, attempt
-- creation or approval transitions, because those functions filter on type = 'PICKUP'.

begin;

do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'coordination_jobs'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%''PICKUP''%';
  if cname is not null then
    execute format('alter table coordination_jobs drop constraint %I', cname);
  end if;
  alter table coordination_jobs add constraint coordination_jobs_type_check
    check (type in ('PICKUP','INVITATION','ONBOARDING','CONSENT','ORBIT_ALERT','SUPERVISION')) not valid;
end $$;

commit;
