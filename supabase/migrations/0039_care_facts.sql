-- 0039 — CareFact: a care fact carries its SOURCE and its VERIFICATION, never a bare claim.
--
-- Rosina answers "can she have a snack?", "how much TV?", "what time is bedtime?" from these rows.
-- A fact without a source is not a fact; `source_kind` and `source_ref` are NOT NULL, and a fact is
-- CONFIRMED only when a person verified it (`verified_by` + `verified_at`). PROVISIONAL facts are
-- visible but clearly unverified, so Rosina can say which it is.
--
-- Visibility: parent/guardian, a caregiver holding `careplan.read` on that child, or the Demo guide
-- on sandbox rows. Everyone else gets no rows — identical to a child with no facts (no oracle).

begin;

create table if not exists care_facts (
  id           text primary key,
  child_id     text not null references children(person_id) on delete cascade,
  key          text not null check (key in ('snack','tv','bedtime','allergy','routine')),
  value        text not null,
  source_kind  text not null check (source_kind in ('PARENT_CONVERSATION','CARE_PLAN','SCHOOL_NOTE','DEMO')),
  source_ref   text not null,
  verified_by  text references people(id),
  verified_at  timestamptz,
  confidence   text not null default 'CONFIRMED' check (confidence in ('CONFIRMED','PROVISIONAL')),
  sandbox      boolean not null default true,
  fixture      boolean not null default false,
  unique (child_id, key),
  -- A CONFIRMED fact must name who verified it and when; PROVISIONAL must not pretend otherwise.
  constraint care_fact_verified_shape check (
    (confidence = 'CONFIRMED' and verified_by is not null and verified_at is not null)
    or (confidence = 'PROVISIONAL')
  )
);

alter table care_facts enable row level security;

drop policy if exists care_facts_read on care_facts;
create policy care_facts_read on care_facts for select to authenticated
  using (
    is_parent_of(child_id)
    or exists (
      select 1 from grants g
       where g.actor_id = current_person()
         and g.child_id = care_facts.child_id
         and 'careplan.read' = any(g.scopes)
         and (g.valid_from is null or g.valid_from <= current_date)
         and (g.valid_until is null or g.valid_until >= current_date)
    )
    or (is_demo_guide() and sandbox)
  );

grant select on care_facts to authenticated;
grant select, insert, update, delete on care_facts to service_role;

commit;
