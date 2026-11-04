-- Read-only demo finishes. Operator rehearses and applies through the migration catalog.
begin;
-- Only deterministic fictional notes are part of the public guide tour. Parent posts retain
-- their existing audience rules, even when they are authored during a demo session.
create policy fridge_demo_guide_notes on public.fridge_notes for select to authenticated
 using (public.is_demo_guide() and sandbox and public.is_sandbox_child(child_id)
        and starts_with(id,'fridge_demo_note_'));
create policy fridge_demo_guide_preferences on public.fridge_item_preferences for select to authenticated
 using (public.is_demo_guide() and public.is_sandbox_child(child_id) and (
  kind='art'
  or (kind='note' and exists(select 1 from public.fridge_notes n where n.id=item_id and n.child_id=fridge_item_preferences.child_id))
  or (kind='goal' and exists(select 1 from public.goals g where g.id=item_id and g.child_id=fridge_item_preferences.child_id))
 ));
-- The existing server-side deterministic seed uses the service role, never a browser role.
grant select, insert, update on public.goals, public.fridge_notes, public.fridge_item_preferences to service_role;
-- No INSERT/UPDATE/DELETE policy or write function changes. Guide writes remain refused.
commit;
