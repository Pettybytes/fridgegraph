-- 0057 — the address.read seed, reproducible instead of ad hoc.
--
-- Decisions: Kendra (p_mom) yes, Andre (p_dad) yes, Loretta (p_gma) per household policy, Priya
-- (p_priya) no. NO household policy grants address.read (checked: none exists), so Loretta gets no
-- grant — deny, and say so rather than inventing a policy to justify it. Priya deliberately gets
-- nothing: she already holds supervise.request / schedule.read / careplan.read, which is exactly the
-- case the coordinate gate exists for.
--
-- Parents also inherit coordinates through is_parent_of(); these rows make the capability explicit
-- and testable rather than implied.

begin;

insert into grants (id, actor_id, child_id, scopes, valid_from, valid_until, granted_by)
values
  ('gr_addr_kendra_nora', 'p_mom', 'p_nora', array['address.read'], null, null, 'p_mom'),
  ('gr_addr_andre_nora',  'p_dad', 'p_nora', array['address.read'], null, null, 'p_mom')
on conflict (id) do update set scopes = excluded.scopes;

commit;
