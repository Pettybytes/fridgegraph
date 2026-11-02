-- 0071 — school-day report proposals: PROPOSE (stage, model-callable) / CONFIRM (file, human-only).
--
-- Same shape as Orbit's draft/preview/activate (0032): a server-side row holds the exact reviewed
-- content, a version counter bumps on edit, and a signed-in actor's deliberate confirm is the only
-- path that ever writes the real, parent-visible `school_reports` row (0001/0070).
--
-- `propose_school_report` ONLY ever writes to `school_report_proposals` — never to `school_reports`
-- — and is the one operation this task deliberately exposes as a Rosina MCP tool (see
-- src/rosina/model.ts's ALLOWED_MCP_TOOL_NAMES comment for why this is a narrow, reviewed
-- exception, not a reversal of "no mutation changes real data"). `confirm_school_report` is NOT
-- exposed to Rosina's tool transport at all (no ops/*.graphql operation file exists for it): a
-- model tool call or generated text can never reach it, by construction, not by convention.
--
-- Authority is the SAME `school.report` grant 0070 introduced — never a hardcoded persona name.

begin;

create table if not exists school_report_proposals (
  id                  text primary key,
  actor_id            text not null references people(id),
  child_id            text not null references children(person_id) on delete cascade,
  kind                text not null,
  text                text not null,
  version             int not null default 1,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  confirmed_report_id text references school_reports(id),
  confirmed_at        timestamptz
);

alter table school_report_proposals enable row level security;
alter table school_report_proposals force row level security;

-- No INSERT/UPDATE grant to `authenticated` at all: every write goes through the two SECURITY
-- DEFINER functions below, exactly like orbit_alerts (0032) — this table is never written
-- directly, by anyone, including its own actor.
create policy school_report_proposals_read on school_report_proposals for select to authenticated
  using (actor_id = current_person());

create or replace function propose_school_report(
  p_child text, p_kind text, p_text text, p_ttl_seconds int default 900
) returns school_report_proposals
language plpgsql
security definer
set search_path = public
as $$
declare v_caller text; v_row school_report_proposals;
begin
  v_caller := current_person();
  if v_caller is null then raise exception 'UNAUTHENTICATED'; end if;
  -- Explicit, not just incidental: the guide holds no grants anywhere today, so has_scope()
  -- alone would already refuse her, but that is a fact about today's seed, not a guarantee —
  -- this is the same defense-in-depth every TS write resolver gives with refuseDemoGuideWrite().
  if is_demo_guide() then raise exception 'DEMO_GUIDE_READ_ONLY' using errcode = '42501'; end if;
  if not has_scope(p_child, 'school.report') then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if p_kind is null or length(trim(p_kind)) = 0 then raise exception 'SCHOOL_REPORT_KIND_REQUIRED' using errcode = '22023'; end if;
  if p_text is null or length(trim(p_text)) = 0 then raise exception 'SCHOOL_REPORT_TEXT_REQUIRED' using errcode = '22023'; end if;

  -- Re-proposing for the SAME (actor, child) replaces the prior unconfirmed draft and bumps
  -- `version` — mirrors draft_orbit_share (0032) exactly, so a client holding an old version
  -- number becomes stale, not silently still valid, the moment the content changes.
  select * into v_row from school_report_proposals
   where actor_id = v_caller and child_id = p_child and confirmed_report_id is null
   order by created_at desc limit 1;

  if found then
    update school_report_proposals
       set kind = p_kind, text = p_text, version = version + 1,
           expires_at = now() + make_interval(secs => greatest(p_ttl_seconds, 60))
     where id = v_row.id
     returning * into v_row;
  else
    insert into school_report_proposals (id, actor_id, child_id, kind, text, expires_at)
    values ('srp_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            v_caller, p_child, p_kind, p_text, now() + make_interval(secs => greatest(p_ttl_seconds, 60)))
    returning * into v_row;
  end if;
  return v_row;
end $$;

revoke all on function propose_school_report(text, text, text, int) from public, anon;
grant execute on function propose_school_report(text, text, text, int) to authenticated;

create or replace function confirm_school_report(p_proposal text, p_version int)
returns school_reports
language plpgsql
security definer
set search_path = public
as $$
declare v_prop school_report_proposals; v_report school_reports; v_id text; v_caller text;
begin
  v_caller := current_person();
  if v_caller is null then raise exception 'UNAUTHENTICATED'; end if;
  if is_demo_guide() then raise exception 'DEMO_GUIDE_READ_ONLY' using errcode = '42501'; end if;

  -- The row lock serializes concurrent confirms of the SAME proposal: whichever call gets here
  -- first proceeds to the insert below; any other call blocks until that commits, then re-reads
  -- `confirmed_report_id` already set and takes the idempotent-replay branch. Two concurrent
  -- confirms of the same proposal can therefore never create two rows.
  select * into v_prop from school_report_proposals where id = p_proposal for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_prop.actor_id <> v_caller then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;

  -- TRUE idempotent replay: already confirmed, by ANY earlier call (sequential retry or the loser
  -- of a concurrent race) — return the SAME report, never a second insert.
  if v_prop.confirmed_report_id is not null then
    select * into v_report from school_reports where id = v_prop.confirmed_report_id;
    return v_report;
  end if;

  -- Re-checked here, not just at propose time: authority is the live grant, not a snapshot.
  if not has_scope(v_prop.child_id, 'school.report') then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if v_prop.expires_at < now() then raise exception 'PROPOSAL_EXPIRED' using errcode = '22023'; end if;
  if v_prop.version <> p_version then raise exception 'PROPOSAL_STALE' using errcode = '40001'; end if;

  v_id := 'sr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into school_reports (id, child_id, kind, text, at)
  values (v_id, v_prop.child_id, v_prop.kind, v_prop.text, local_today())
  returning * into v_report;

  update school_report_proposals set confirmed_report_id = v_id, confirmed_at = now()
   where id = p_proposal;

  return v_report;
end $$;

revoke all on function confirm_school_report(text, int) from public, anon;
grant execute on function confirm_school_report(text, int) to authenticated;

commit;
