-- 0073 — the demo reset must cover the school-report tables.
--
-- THE GAP (measured 2026-11-02)
-- `resetDatabase()` clears only tables that carry a `sandbox` column, plus fixture-owned id tables.
-- `school_report_proposals` (0071) and `school_reports` (0001) have no such column, so a canonical
-- reset left `srp_9d5f73043fcc` and `sr_6fb1555f27d0` behind after a teacher-persona live check.
-- A leftover draft in a demo is not a cosmetic problem: it is a real row a judge can read.
--
-- WHAT THIS SCOPES ON
-- A proposal is demo-created when its actor is a demo identity (`identity_map`), which is the same
-- boundary the rest of the demo uses. Reports are removed only through the proposal that confirmed
-- them. Nothing is deleted by id prefix, by time window, or by table-wide truncation.
--
-- WHAT IT DOES NOT COVER (stated, not implied)
-- A report filed directly through `reportSchoolDay` (0070) has NO provenance column — no author, no
-- demo marker — so it cannot be scoped safely here. Those rows are left alone and this function says
-- so. Teaching 0070's write path a provenance marker is the follow-up, not a guess in this migration.

begin;

create or replace function public.reset_demo_school_reports()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_proposals int := 0;
  v_reports int := 0;
  v_ids text[];
begin
  select coalesce(array_agg(p.id), '{}')
    into v_ids
    from school_report_proposals p
   where exists (select 1 from identity_map m where m.person_id = p.actor_id);

  if array_length(v_ids, 1) is null then
    return jsonb_build_object('proposals', 0, 'reports', 0);
  end if;

  with gone as (
    delete from school_report_proposals
     where id = any(v_ids)
     returning confirmed_report_id
  )
  select count(*), array_remove(array_agg(confirmed_report_id), null)
    into v_proposals, v_ids
    from gone;

  if array_length(v_ids, 1) is not null then
    delete from school_reports where id = any(v_ids);
    get diagnostics v_reports = row_count;
  end if;

  return jsonb_build_object('proposals', v_proposals, 'reports', v_reports);
end $$;

revoke all on function public.reset_demo_school_reports() from public, anon, authenticated;
grant execute on function public.reset_demo_school_reports() to service_role;

commit;
