-- 0085 — private media for "Pin it to the fridge" (Phase 2 intake made real).
--
-- STAGED ONLY — never applied by this PR. Forward-only; 0001-0084 never edited. In particular 0083
-- (teacher-persona's fridge_notes) is UNCHANGED: its `attachment_ref` column already exists and this
-- intake only WRITES that column (a plain ref) and reads it back — no column/contract change there.
-- Full design: docs/contracts/pin-to-fridge.md §6.
--
-- Same posture as orbit_photos (0037): a private table that owns the storage path, a parent-only
-- SECURITY DEFINER register, and an access function that decides authority on EVERY request and
-- returns the path only when access is granted (an unauthorized caller gets the same empty answer as
-- a missing id — no oracle, no signed URL). Authenticated has NO direct table grant: the only way in
-- is through these functions (which re-evaluate the CALLER's JWT authority — SECURITY DEFINER changes
-- the role, not auth.uid()/request.jwt.claims — exactly as orbit_photo_access does).

begin;

create table if not exists pin_media (
  id              text primary key,
  child_id        text not null references children(person_id) on delete cascade,
  owner_person_id text not null references people(id),
  content_sha256  text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path    text not null,
  mime_type       text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size       int  not null check (byte_size > 0),
  created_at      timestamptz not null default now(),
  -- An upload that is never pinned is transient: it expires and is swept (cleanup below). A pin that
  -- references it keeps it alive (the sweep skips referenced media).
  expires_at      timestamptz not null default now() + interval '24 hours',
  -- Every asset uploaded through the live demo app is demo content; the canonical reset clears it,
  -- same convention as every other SANDBOX_TABLES member. (Reset wiring is Bentley's reset.ts — this
  -- migration only provides the column + sweep; see contract §6 for the proposed one-line reset hook.)
  sandbox         boolean not null default true
);

alter table pin_media enable row level security;
alter table pin_media force row level security;
-- Deliberately NO policies and NO grant to authenticated: direct table access is never permitted;
-- every read/write goes through the SECURITY DEFINER functions below. (service_role, used by reset,
-- bypasses RLS as usual.)

-- Upload registration: parent/guardian of the child only; sha256 must be a real digest; the path is
-- server-written (never caller-supplied content). Mirrors register_orbit_photo (0037).
create or replace function register_pin_media(p_child text, p_sha256 text, p_mime text, p_path text, p_size int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_id text;
begin
  if not is_parent_of(p_child) then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'PIN_MEDIA_BAD_HASH' using errcode = '22023'; end if;
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp') then raise exception 'PIN_MEDIA_BAD_MIME' using errcode = '22023'; end if;
  if p_size is null or p_size <= 0 then raise exception 'PIN_MEDIA_BAD_SIZE' using errcode = '22023'; end if;
  v_id := 'pm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into pin_media (id, child_id, owner_person_id, content_sha256, storage_path, mime_type, byte_size)
  values (v_id, p_child, current_person(), p_sha256, p_path, p_mime, p_size);
  return v_id;
end $$;

-- Access decided on EVERY request. PARENT: a parent/guardian of the child (works before any note
-- exists — the owner preparing/confirming a pin). SHARED: a fridge.read grant holder when a SHARED
-- fridge_note references THIS asset — i.e. the media is visible exactly when a note that references it
-- is visible to the caller (fridge_notes_read's own SHARED rule), never more widely. The storage path
-- is returned only when access is granted; everything else answers null (no oracle). No signed URL.
create or replace function pin_media_access(p_media text)
returns table (access text, storage_path text, child_id text, mime_type text)
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select id, child_id, storage_path, mime_type from pin_media where id = p_media
  ),
  lvl as (
    select case
             when (select is_parent_of(child_id) from m) then 'PARENT'
             when exists (
               select 1 from fridge_notes fn
                where fn.attachment_ref = p_media
                  and fn.audience = 'SHARED'
                  and has_scope(fn.child_id, 'fridge.read')
             ) then 'SHARED'
             else null
           end as access
  )
  select lvl.access,
         case when lvl.access is not null then (select storage_path from m) else null end,
         case when lvl.access is not null then (select child_id from m) else null end,
         case when lvl.access is not null then (select mime_type from m) else null end
    from lvl
$$;

-- Expiry sweep: delete transient (never-pinned) uploads past their TTL, returning their storage paths
-- so the caller can unlink the private files. A referenced asset (some fridge_note points at it) is
-- NEVER swept, regardless of TTL. SECURITY DEFINER so a scheduled/service caller can run it; it makes
-- no authority decision (it is pure TTL + reference housekeeping, never serves bytes).
create or replace function cleanup_expired_pin_media()
returns setof text
language sql
security definer
set search_path = public
as $$
  delete from pin_media pm
   where pm.expires_at < now()
     and not exists (select 1 from fridge_notes fn where fn.attachment_ref = pm.id)
  returning pm.storage_path
$$;

commit;
