-- 0083 — Phase 2 fridge backend: goals CRUD (completion separate from approval, optional period)
-- plus a new fridge_notes table (first slice: parent/guardian posting, explicit sharing).
--
-- Full design, rationale and every deliberate first-slice limitation: docs/contracts/fridge-notes.md.
-- STAGED ONLY — never applied by this PR. Forward-only; 0001-0082 never edited.
--
-- GOALS — `goals_read`/`goals_parent_write` (0003_rls.sql) are UNCHANGED: parents see every goal,
-- a `goals.read` grant holder sees APPROVED only. This migration only adds columns plus a trigger
-- that makes child_id/proposed_by_id permanently immutable once a row exists — a strengthening
-- beyond what was asked (nothing previously enforced that), added because it is cheap and closes
-- a real gap in the existing `for all` write policy.
--
-- FRIDGE NOTES — owned by `village` (same subgraph as goals/care_plans: parent-authored,
-- child-scoped content, no cross-table write). RLS decides WHO may attempt a write;
-- `_fridge_notes_guard` (BEFORE UPDATE trigger) decides WHICH COLUMNS that attempt may actually
-- change — RLS's own WITH CHECK cannot express "this column only for this role."

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Goals: period + completed_at, immutability trigger
-- ---------------------------------------------------------------------------------------------

alter table goals
  add column if not exists period text check (period in ('DAY', 'WEEK', 'MONTH')),
  add column if not exists completed_at timestamptz;

create or replace function _goals_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.child_id is distinct from old.child_id then
    raise exception 'GOAL_CHILD_IMMUTABLE' using errcode = '42501';
  end if;
  if new.proposed_by_id is distinct from old.proposed_by_id then
    raise exception 'GOAL_PROPOSER_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists goals_guard on goals;
create trigger goals_guard before update on goals
  for each row execute function _goals_guard();

-- ---------------------------------------------------------------------------------------------
-- 2. Fridge notes
-- ---------------------------------------------------------------------------------------------

create table if not exists fridge_notes (
  id             text primary key,
  child_id       text not null references children(person_id) on delete cascade,
  author_id      text not null references people(id),
  text           text not null check (char_length(text) <= 500 and char_length(btrim(text)) > 0),
  paper_color    text not null default 'yellow'
                 check (paper_color in ('yellow', 'pink', 'blue', 'green', 'white')),
  audience       text not null default 'PARENTS_ONLY'
                 check (audience in ('PARENTS_ONLY', 'SHARED')),
  -- No FK, no new storage: a reference into whatever store already authorizes/serves it, same
  -- shape as orbit_alerts.photo_id (0032). See docs/contracts/fridge-notes.md §2.
  attachment_ref text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  revision       int not null default 1,
  -- Every fridge note created through the live demo app is demo content; the canonical reset
  -- clears it unconditionally, same mechanism as coordination_jobs/attempts/care_facts.
  sandbox        boolean not null default true
);

alter table fridge_notes enable row level security;
alter table fridge_notes force row level security;

create policy fridge_notes_read on fridge_notes for select to authenticated
  using (
    is_parent_of(child_id)
    or author_id = current_person()
    or (audience = 'SHARED' and has_scope(child_id, 'fridge.read'))
  );

-- Household membership alone (resident_adult, or any membership with no grant) implies nothing —
-- only is_parent_of (parent/guardian role specifically) or an explicit fridge.post grant.
create policy fridge_notes_insert on fridge_notes for insert to authenticated
  with check (
    author_id = current_person()
    and (is_parent_of(child_id) or has_scope(child_id, 'fridge.post'))
  );

create policy fridge_notes_update on fridge_notes for update to authenticated
  using (is_parent_of(child_id) or author_id = current_person())
  with check (is_parent_of(child_id) or author_id = current_person());

-- Parents only, explicitly — not "any author of any note may delete it."
create policy fridge_notes_delete on fridge_notes for delete to authenticated
  using (is_parent_of(child_id));

grant select, insert, update, delete on fridge_notes to authenticated;

create or replace function _fridge_notes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.child_id is distinct from old.child_id then
    raise exception 'FRIDGE_NOTE_CHILD_IMMUTABLE' using errcode = '42501';
  end if;
  if new.author_id is distinct from old.author_id then
    raise exception 'FRIDGE_NOTE_AUTHOR_IMMUTABLE' using errcode = '42501';
  end if;
  -- Only a parent may touch audience at all — no widening, no narrowing, through any other path.
  if new.audience is distinct from old.audience and not is_parent_of(old.child_id) then
    raise exception 'FRIDGE_NOTE_AUDIENCE_LOCKED' using errcode = '42501';
  end if;
  if new.text is distinct from old.text
     or new.paper_color is distinct from old.paper_color
     or new.attachment_ref is distinct from old.attachment_ref
     or new.audience is distinct from old.audience then
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists fridge_notes_guard on fridge_notes;
create trigger fridge_notes_guard before update on fridge_notes
  for each row execute function _fridge_notes_guard();

commit;
