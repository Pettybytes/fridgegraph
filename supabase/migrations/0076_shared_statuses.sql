-- 0076 — Dad status chip: a person-chosen status shared with a child's village. Opt-in, never
-- inferred. "🍼 Changing a diaper · ETA: unknown" is text the person themselves set, not a
-- derivation from Busy/Free, calendar gaps, or any other recorded field.
--
-- ONE ROW PER PERSON. `setSharedStatus`/`clearSharedStatus` (village.ts) write it directly via
-- the caller's own RLS-scoped client — an upsert and a delete, not SECURITY DEFINER RPC
-- functions. RLS alone decides who may write what: only the owning person, and the demo guide is
-- refused on every write policy (consistent with every other write path in this schema).
-- `grantAccess` (access.ts) is the precedent for a single-table RLS-governed write with no
-- cross-table atomicity need, so this follows that shape rather than the propose/confirm RPC
-- pattern used by villager_proposals/school_report_proposals, which exist because THOSE flows
-- need an atomic multi-table commit this one does not.
--
-- READ VISIBILITY — "visible only to people who can already see that person in the child's
-- village": defined here as sharing at least one child's village in common. `_connected_children`
-- is the reusable building block (a person's own children if they're a parent, any child they
-- hold an ACTIVE relationship to, any child they hold a currently-valid grant for);
-- `can_view_shared_status` is true when the viewer's and the target's connected-children sets
-- overlap. A person always sees their own status this way too — they are trivially in their own
-- connected-children set once connected to at least one child.
--
-- LOCAL-DAY DISCIPLINE: grant-window comparisons use `local_today()` (0006), never `current_date`
-- — the exact class of defect evidence 72 just found live in the Add-a-Villager flow (a UTC day
-- read as "already tomorrow" at Detroit evening). `expires_at` itself is a timestamptz (an
-- instant), so its own comparison against `now()` needs no timezone handling.
--
-- Additive, forward-only. No existing table altered.

begin;

create table if not exists shared_statuses (
  person_id  text primary key references people(id) on delete cascade,
  emoji      text,
  text       text not null,
  eta_text   text,
  set_at     timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint shared_statuses_text_shape check (
    char_length(text) <= 60 and char_length(btrim(text)) > 0
  )
);

alter table shared_statuses enable row level security;
alter table shared_statuses force row level security;

create or replace function _connected_children(p_person text) returns setof text
language sql stable security definer set search_path = public as $$
  select to_id from relationships where from_id = p_person and status = 'ACTIVE'
  union
  select child_id from grants
   where actor_id = p_person
     and (valid_from  is null or local_today() >= valid_from)
     and (valid_until is null or local_today() <= valid_until)
  union
  select hm_child.person_id
    from household_members hm_parent
    join household_members hm_child
      on hm_child.household_id = hm_parent.household_id and hm_child.role = 'child'
   where hm_parent.person_id = p_person and hm_parent.role = 'parent'
$$;

create or replace function can_view_shared_status(p_viewer text, p_person text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from _connected_children(p_viewer) v
      join _connected_children(p_person) p on v = p
  )
$$;

revoke all on function _connected_children(text) from public, anon;
revoke all on function can_view_shared_status(text, text) from public, anon;
grant execute on function _connected_children(text) to authenticated, service_role;
grant execute on function can_view_shared_status(text, text) to authenticated, service_role;

-- Expiry is enforced HERE, in RLS, not left to app-layer diligence: "null when there's no
-- status, it has expired, or the viewer may not see that person" collapses all three into the
-- same "no row" shape at the one place that can't be bypassed, and keeps a direct SQL client
-- from ever observing a stale row the UI would never show.
create policy shared_statuses_read on shared_statuses for select to authenticated
  using (
    expires_at > now()
    and (person_id = current_person() or can_view_shared_status(current_person(), person_id))
  );

create policy shared_statuses_write_own on shared_statuses for insert to authenticated
  with check (person_id = current_person() and not is_demo_guide());

create policy shared_statuses_update_own on shared_statuses for update to authenticated
  using (person_id = current_person() and not is_demo_guide())
  with check (person_id = current_person() and not is_demo_guide());

create policy shared_statuses_delete_own on shared_statuses for delete to authenticated
  using (person_id = current_person() and not is_demo_guide());

grant select, insert, update, delete on shared_statuses to authenticated;

commit;
