-- 0084 — 30-day demo pickup-coordination history: two new jobTimeline event kinds' underlying
-- columns, plus a new voice_notes table for private playback.
--
-- Full design: docs/contracts/demo-history.md (v1, PROPOSED). STAGED ONLY — never applied by this
-- PR. Forward-only; 0001-0083 never edited. `candidate_evaluations`/`coordination_jobs` are
-- EXISTING, already-applied tables (0001/0013) — only additive columns, defaulting to a value that
-- is correct for every row that already exists (NULL, the "no response/decision recorded yet"
-- state — never a value that would misrepresent a pre-existing row, the exact class of mistake
-- `fix/0083-goals-provenance` (#161) found and fixed in `goals.sandbox`).
--
-- RESPONSE_RECORDED — candidate_evaluations.responded_at/response_kind, set ONLY by a real human
-- answering (accept_pickup, both branches — redefined below, same signature, additive only).
-- Never touched by cost calculation or any other system write, which is why `updated_at` (touched
-- by both) was not reused.
--
-- JOB_DECLINED — coordination_jobs.decided_at, set ONLY by approve_pickup's DECLINED branch
-- (redefined below, same signature, additive only). failure_reason (existing) carries the reason.
--
-- voice_notes — one concrete FK to candidate_evaluations, not a polymorphic subject_type/
-- subject_id (deferred until a second subject type is actually needed). ON DELETE CASCADE through
-- candidate_evaluations -> coordination_jobs means this table needs no sandbox column and no
-- reset-code entry of its own: it is cleared automatically whenever its parent job is.
--
-- status PENDING/READY — the delivered-asset columns (transcript/duration_seconds/storage_path/
-- sha256) are NULL until Bentley supplies the real audio, its Muse transcript, its measured
-- duration and its real sha256; proposed_script holds this PR's own draft line, kept apart from
-- `transcript` so a draft is never read back as a delivered one. voice_note_access refuses
-- playback for a PENDING note the same way it refuses an unauthorized one — never distinguishable.

begin;

alter table candidate_evaluations
  add column if not exists responded_at timestamptz,
  add column if not exists response_kind text check (response_kind in ('ACCEPTED', 'DECLINED'));

alter table coordination_jobs
  add column if not exists decided_at timestamptz;

-- Redefines accept_pickup (0013): identical signature and behavior, plus responded_at/
-- response_kind set in BOTH branches that already write available/decline_reason/accepted_via —
-- the late-reply branch (audit only, changes nothing else) and the normal branch.
create or replace function accept_pickup(p_attempt text, p_available boolean, p_decline text,
                                         p_entry text, p_request_version int)
returns text language plpgsql security definer set search_path = public as $$
declare v_job text; v_candidate text; v_status text; v_rv int; v_code text; v_transport boolean;
        v_kind text;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_entry is null or p_entry not in ('WEBHOOK_CALLBACK','CANDIDATE_JWT') then
    raise exception 'BAD_ENTRY_POINT';
  end if;

  select a.job_id, a.candidate_id into v_job, v_candidate
    from attempts a where a.id = p_attempt for update;
  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  -- A caller may only answer for herself. The webhook path resolves the same identity from the
  -- Attempt's recipient + provider metadata before calling this function.
  if v_candidate is distinct from current_person() then raise exception 'UNAUTHORIZED'; end if;

  select j.status, j.request_version into v_status, v_rv
    from coordination_jobs j where j.id = v_job for update;

  if v_rv <> p_request_version then raise exception 'STALE_REQUEST_VERSION'; end if;
  if v_status in ('confirmed','failed') then raise exception 'JOB_TERMINAL'; end if;

  v_kind := case when p_available then 'ACCEPTED' else 'DECLINED' end;

  -- Late reply: recorded for audit, changes nothing (pickup-job.md §7).
  if v_status <> 'discovering' then
    update candidate_evaluations
       set available = p_available, decline_reason = p_decline, accepted_via = p_entry,
           late_reply = true, updated_at = now(),
           responded_at = now(), response_kind = v_kind
     where job_id = v_job and candidate_id = v_candidate;
    return 'late';
  end if;

  v_transport := exists (select 1 from capabilities c
                          where c.person_id = v_candidate and c.name = 'transport.child')
             and exists (select 1 from vehicles v where v.owner_id = v_candidate);

  v_code := case
              when p_available is false and p_decline = 'NO_TRANSPORT' then 'AVAILABLE_NO_TRANSPORT'
              when p_available is false then 'UNAVAILABLE'
              when p_available is true and not v_transport then 'AVAILABLE_NO_TRANSPORT'
              else null
            end;

  update candidate_evaluations
     set available = p_available,
         decline_reason = p_decline,
         accepted_via = p_entry,
         reason_code = v_code,
         updated_at = now(),
         responded_at = now(),
         response_kind = v_kind
   where job_id = v_job and candidate_id = v_candidate;

  perform _rank_and_advance(v_job);
  return 'recorded';
end $$;

revoke all on function accept_pickup(text, boolean, text, text, int) from public, anon;
grant execute on function accept_pickup(text, boolean, text, text, int) to authenticated;

-- Redefines approve_pickup (0017): identical signature and behavior, plus decided_at set on the
-- DECLINED branch only (the APPROVED branch already gets a real timestamp via confirmations.
-- received_at — unchanged).
create or replace function approve_pickup(p_job text, p_version int, p_request_version int,
                                          p_decision text, p_reason text,
                                          p_accept_over_limit boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_child text; v_as_of date; v_rv int; v_ver int;
        v_cand text; v_over text;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_decision not in ('APPROVED','DECLINED') then raise exception 'BAD_DECISION'; end if;

  select j.status, j.child_id, j.as_of, j.request_version, j.version, j.over_limit_candidate_id
    into v_status, v_child, v_as_of, v_rv, v_ver, v_over
    from coordination_jobs j where j.id = p_job for update;

  if v_status is null then raise exception 'JOB_NOT_FOUND'; end if;
  if v_status in ('confirmed','failed') then raise exception 'JOB_TERMINAL'; end if;
  if v_ver <> p_version then raise exception 'STALE_VERSION'; end if;
  if v_rv <> p_request_version then raise exception 'STALE_REQUEST_VERSION'; end if;
  if v_status <> 'awaiting_approval' then raise exception 'NOT_AWAITING_APPROVAL'; end if;
  if not _is_approver_for(v_child, v_as_of) then raise exception 'UNAUTHORIZED'; end if;

  if p_decision = 'DECLINED' then
    update coordination_jobs
       set status = 'failed', failure_reason = coalesce(p_reason, 'approver_declined'),
           version = version + 1, decided_at = now()
     where id = p_job;
    return p_job;
  end if;

  if v_over is not null then
    -- An over-limit option is never approved implicitly.
    if p_accept_over_limit is not true then
      raise exception 'OVER_LIMIT_NOT_ACCEPTED';
    end if;
    v_cand := v_over;
  else
    select candidate_id into v_cand
      from candidate_evaluations
     where job_id = p_job and reason_code = 'APPROVAL_PENDING';
  end if;

  if v_cand is null then raise exception 'NO_RECOMMENDATION'; end if;

  -- Verbatim from 0017 — same deterministic id scheme (job+candidate), unchanged by this redefine.
  insert into confirmations (id, job_id, received_at, candidate_id, approved_by, over_limit_approved)
  values ('cf_' || substr(md5(p_job || v_cand), 1, 24), p_job, now(), v_cand, current_person(),
          v_over is not null);

  update coordination_jobs
     set status = 'confirmed', version = version + 1
   where id = p_job;

  return p_job;
end $$;

revoke all on function approve_pickup(text, int, int, text, text, boolean) from public, anon;
grant execute on function approve_pickup(text, int, int, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- voice_notes
-- ---------------------------------------------------------------------------------------------

-- status: PENDING until Bentley delivers the real audio file, its Muse-generated transcript, its
-- measured duration and its real sha256 — those four columns are NULL, not a fabricated stand-in,
-- until that happens (never a placeholder hash presented as a completed asset). proposed_script
-- holds the DRAFT line this PR invented to describe what the story needs to say — kept in its own
-- column precisely so it is never read back as `transcript`, the delivered/final field. READY is
-- set only once all four delivered columns are filled in together, by the row that fills them.
create table if not exists voice_notes (
  id                text primary key,
  response_id       text not null references candidate_evaluations(id) on delete cascade,
  speaker_person_id text not null references people(id),
  status            text not null default 'PENDING' check (status in ('PENDING', 'READY')),
  proposed_script   text check (proposed_script is null or char_length(proposed_script) > 0),
  transcript        text check (transcript is null or char_length(transcript) > 0),
  duration_seconds  numeric(6,2) check (duration_seconds is null or duration_seconds > 0),
  -- Coarse, turn-level only: [{speaker, startSec, endSec}, ...]. Never word-level.
  turn_timings      jsonb,
  storage_path      text,
  sha256            text,
  created_at        timestamptz not null default now(),
  constraint voice_notes_ready_has_delivered_assets check (
    status = 'PENDING'
    or (transcript is not null and duration_seconds is not null and storage_path is not null and sha256 is not null)
  )
);

alter table voice_notes enable row level security;
alter table voice_notes force row level security;

-- Same boundary as candidate_evaluations_read (0013: is_parent_of the story's child), plus the
-- speaker always hears their own note back — same "author always sees their own" shape
-- fridge_notes_read (0083) already established.
create policy voice_notes_read on voice_notes for select to authenticated
  using (
    speaker_person_id = current_person()
    or exists (
      select 1 from candidate_evaluations ce
      join coordination_jobs j on j.id = ce.job_id
      where ce.id = voice_notes.response_id and is_parent_of(j.child_id)
    )
  );

-- No insert/update/delete grant to authenticated at all: this table is reset/seed-written only
-- (via the disposable-DB-owning connection, which bypasses RLS), same posture as
-- candidate_evaluations itself (0013's own comment: "authenticated gets SELECT only").
grant select on voice_notes to authenticated;

-- Decided on EVERY request, by the database itself — same shape as orbit_photo_access (0037).
-- storage_path is returned only when access is granted AND the note is READY: a PENDING note (no
-- delivered audio file yet) is refused the SAME WAY as a forbidden one — a caller must never be
-- able to tell "not yet delivered" from "not authorized" or "doesn't exist," and must never be
-- handed a storage_path that doesn't point at a real file. No signed URL is ever produced.
create or replace function voice_note_access(p_voice_note text)
returns table (access text, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  with vn as (
    select id, response_id, speaker_person_id, storage_path, status from voice_notes where id = p_voice_note
  ),
  lvl as (
    select case
             when (select status from vn) is distinct from 'READY' then null
             when (select speaker_person_id from vn) = current_person() then 'SPEAKER'
             when exists (
               select 1 from candidate_evaluations ce
               join coordination_jobs j on j.id = ce.job_id
               where ce.id = (select response_id from vn) and is_parent_of(j.child_id)
             ) then 'PARENT'
             else null
           end as access
  )
  select lvl.access,
         case when lvl.access is not null then (select storage_path from vn) else null end
    from lvl
$$;

revoke all on function voice_note_access(text) from public, anon;
grant execute on function voice_note_access(text) to authenticated;

commit;
