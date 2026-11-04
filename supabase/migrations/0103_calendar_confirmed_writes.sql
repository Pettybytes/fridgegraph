-- Forward-only: confirmed calendar writes reuse the manual mutation path.
begin;

-- A guide may edit only the ten canonical showcase children, and only while their
-- household is still marked sandbox. Roster: src/fixtures.ts createShowcaseCalendar. No grants or general guide write rights change.
create or replace function assert_calendar_parent(p_child text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_person() is null or not coalesce(case when current_person()='p_demo_guide'
    then is_demo_guide() and is_sandbox_child(p_child)
      and p_child = any(array['p_nora','p_leo','p_max','p_jax','p_malik','p_emma','p_skye','p_taylor','p_avery','p_micah'])
    else is_parent_of(p_child) end,false) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

create table calendar_write_receipts (
  actor_id text not null references people(id) on delete cascade,
  request_key uuid not null,
  child_id text not null references children(person_id) on delete cascade,
  operation text not null check (operation in ('create','update','delete')),
  request jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_key)
);
alter table calendar_write_receipts enable row level security;
revoke all on calendar_write_receipts from public, anon, authenticated;

-- Unique insertion serializes concurrent retries. The receipt, event and existing
-- village_event append commit together, or all roll back. Replays recheck permission.
create function calendar_write_once(p_operation text, p_request_key uuid, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  receipt calendar_write_receipts;
  v_child text;
  v_actor text := current_person();
  saved events;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_request_key is null then raise exception 'REQUEST_KEY_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor || p_request_key::text,0));
  select * into receipt from calendar_write_receipts where actor_id=v_actor and request_key=p_request_key;
  if found then
    perform assert_calendar_parent(receipt.child_id);
    if receipt.operation <> p_operation or receipt.request <> p_request then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    if receipt.operation <> 'delete' and not exists (
      select 1 from events e where e.id=receipt.result->>'id' and to_jsonb(e)=receipt.result
    ) then raise exception 'CALENDAR_RECEIPT_STALE' using errcode='22023'; end if;
    return receipt.result;
  end if;
  if p_operation='create' then v_child := p_request->>'p_child';
  else select child_id into v_child from events where id=p_request->>'p_id'; end if;
  -- Missing and inaccessible targets deliberately have the same refusal.
  perform assert_calendar_parent(v_child);
  insert into calendar_write_receipts(actor_id,request_key,child_id,operation,request)
    values(v_actor,p_request_key,v_child,p_operation,p_request) on conflict do nothing;
  select * into receipt from calendar_write_receipts where actor_id=v_actor and request_key=p_request_key for update;
  if receipt.operation <> p_operation or receipt.request <> p_request then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end if;
  if receipt.result is not null then return receipt.result; end if;
  if p_operation='create' then
    saved := create_calendar_event(v_child,p_request->>'p_title',(p_request->>'p_start')::timestamp,
      (p_request->>'p_end')::timestamp,p_request->>'p_location',p_request->>'p_notes',p_request->>'p_color',p_request->>'p_status');
    v_result := to_jsonb(saved);
  elsif p_operation='update' then
    saved := update_calendar_event(p_request->>'p_id',p_request->>'p_title',(p_request->>'p_start')::timestamp,
      (p_request->>'p_end')::timestamp,p_request->>'p_location',p_request->>'p_notes',p_request->>'p_color',p_request->>'p_status');
    v_result := to_jsonb(saved);
  elsif p_operation='delete' then
    v_result := to_jsonb(delete_calendar_event(p_request->>'p_id'));
  else raise exception 'INVALID_OPERATION' using errcode = '22023'; end if;
  update calendar_write_receipts set result=v_result
    where actor_id=v_actor and request_key=p_request_key;
  return v_result;
end $$;
revoke all on function calendar_write_once(text,uuid,jsonb) from public, anon;
grant execute on function calendar_write_once(text,uuid,jsonb) to authenticated;
create function calendar_write_access(p_child text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  perform assert_calendar_parent(p_child);
  return true;
exception when insufficient_privilege then return false;
end $$;
revoke all on function calendar_write_access(text) from public, anon;
grant execute on function calendar_write_access(text) to authenticated;
commit;
