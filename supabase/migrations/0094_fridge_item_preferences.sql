-- Fridge positions/styles and media child binding. Forward-only; operator applies after rehearsal.
begin;

create table public.fridge_item_preferences (
 child_id text not null references public.children(person_id) on delete cascade,
 kind text not null check (kind in ('art','note','goal')),
 item_id text not null check (length(item_id) between 1 and 120),
 position jsonb,
 color text check (color in ('black','blue','red','green')),
 font text check (font in ('kalam','caveat')),
 primary key (child_id,kind,item_id),
 check (position is null or (
   kind in ('art','note') and jsonb_typeof(position)='object'
   and position ?& array['x','y','width','rotation']
   and position - array['x','y','width','rotation'] = '{}'::jsonb
   and jsonb_typeof(position->'x')='number' and jsonb_typeof(position->'y')='number'
   and jsonb_typeof(position->'width')='number' and jsonb_typeof(position->'rotation')='number'
   and (position->>'x')::numeric between 0.19 and 0.496
   and (position->>'y')::numeric between 0.09 and 0.49
   and (position->>'width')::numeric > 0 and (position->>'width')::numeric <= 0.306
   and (position->>'x')::numeric + (position->>'width')::numeric <= 0.496
   and abs((position->>'rotation')::numeric) <= 15
 )),
 check (kind='goal' or (color is null and font is null))
);
alter table public.fridge_item_preferences enable row level security;
alter table public.fridge_item_preferences force row level security;
create policy fridge_preferences_read on public.fridge_item_preferences for select to authenticated using (
 public.is_parent_of(child_id)
 or (kind='note' and exists (select 1 from public.fridge_notes n where n.id=item_id and n.child_id=fridge_item_preferences.child_id and n.audience='SHARED' and public.has_scope(n.child_id,'fridge.read')))
 or (kind='goal' and exists (select 1 from public.goals g where g.id=item_id and g.child_id=fridge_item_preferences.child_id and g.status='APPROVED' and public.has_scope(g.child_id,'goals.read')))
);
revoke all on public.fridge_item_preferences from public, anon, authenticated;
grant select on public.fridge_item_preferences to authenticated;

create function public.read_fridge_preferences(p_child text) returns jsonb
language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'itemId',item_id,'position',position,'color',color,'font',font) order by kind,item_id),'[]'::jsonb)
 from public.fridge_item_preferences where child_id=p_child
$$;

create function public.save_fridge_preference(p_child text,p_kind text default null,p_item text default null,p_position jsonb default null,p_color text default null,p_font text default null,p_tidy boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_parent_of(p_child) then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
 if p_tidy then
  update public.fridge_item_preferences set position=null where child_id=p_child and kind in ('art','note');
 else
  if p_kind='note' and not exists(select 1 from public.fridge_notes where id=p_item and child_id=p_child) then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_kind='goal' and not exists(select 1 from public.goals where id=p_item and child_id=p_child) then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  insert into public.fridge_item_preferences as stored(child_id,kind,item_id,position,color,font)
  values(p_child,p_kind,p_item,p_position,p_color,p_font)
  on conflict(child_id,kind,item_id) do update set
   position=coalesce(excluded.position,stored.position),color=coalesce(excluded.color,stored.color),font=coalesce(excluded.font,stored.font);
 end if;
 return public.read_fridge_preferences(p_child);
end $$;
revoke all on function public.read_fridge_preferences(text) from public,anon;
revoke all on function public.save_fridge_preference(text,text,text,jsonb,text,text,boolean) from public,anon;
grant execute on function public.read_fridge_preferences(text) to authenticated;
grant execute on function public.save_fridge_preference(text,text,text,jsonb,text,text,boolean) to authenticated;

-- A shared reference must belong to the media's actual child, not just any authorized child.
create or replace function public.pin_media_access(p_media text)
returns table(access text,storage_path text,child_id text,mime_type text)
language sql stable security definer set search_path=public as $$
 with m as (select pm.* from public.pin_media pm where pm.id=p_media),
 lvl as (select case when (select public.is_parent_of(m.child_id) from m) then 'PARENT'
 when exists(select 1 from public.fridge_notes fn join m on m.id=fn.attachment_ref and m.child_id=fn.child_id
 where fn.audience='SHARED' and public.has_scope(fn.child_id,'fridge.read')) then 'SHARED' else null end as access)
 select lvl.access,
 case when lvl.access is not null then (select m.storage_path from m) end,
 case when lvl.access is not null then (select m.child_id from m) end,
 case when lvl.access is not null then (select m.mime_type from m) end from lvl
$$;
revoke all on function public.pin_media_access(text) from public,anon;
grant execute on function public.pin_media_access(text) to authenticated;
commit;
