-- 0018 — durable transport-level dedupe for webhook deliveries.
--
-- webhook.md requires duplicate-event handling at the TRANSPORT layer, in durable storage rather
-- than in-process memory, and separately from the business-level (attemptId, providerMessageId)
-- dedupe. A restart must not forget that an event id was already accepted.
--
-- The insert is the lock: `insert ... on conflict (id) do nothing` and a row-count check. If the
-- row already exists the request is a duplicate and NOTHING else runs — no job lookup, no RPC,
-- no state change.
--
-- Written BEFORE the privileged call, so a crash after the insert still cannot double-apply: the
-- retry is rejected as a duplicate. The trade-off is explicit: a crash between the insert and the
-- RPC loses that one reply rather than risking a double write, which is the correct direction for
-- an availability fact (the person can be called again; a forged or duplicated reply cannot be
-- un-applied).
--
-- No policy and no grants: service role only, like identity_map and real_call_authorizations.
--
-- Rollback: drop table webhook_events;

begin;

create table if not exists webhook_events (
  id             text primary key,                 -- provider event id; signature digest if none
  received_at    timestamptz not null default now(),
  attempt_id     text references attempts(id) on delete cascade,
  request_version int,
  payload_sha256 text not null,
  outcome        text not null check (outcome in ('ACCEPTED','REJECTED_BINDING'))
);

comment on table webhook_events is
  'Transport-level idempotency for coordination webhook deliveries (webhook.md §4). The primary '
  'key IS the dedupe: a second delivery of the same event id changes nothing.';

create index if not exists webhook_events_received_at_idx on webhook_events (received_at);

alter table webhook_events enable row level security;
alter table webhook_events force  row level security;

revoke all on webhook_events from anon, authenticated;
grant all privileges on webhook_events to service_role;

commit;
