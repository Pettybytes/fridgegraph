-- Approved test responders for all ten showcase children. No transport or live consent is enabled.
begin;
insert into public.household_policies (household_id, rule, value)
select h.id, 'orbit_notify_eligible', 'p_tasha,p_gma,p_bryan'
from public.households h
where h.id in ('h_a','h_b','h_c','h_emma','h_taylor','h_micah','h_malik') and h.sandbox
on conflict (household_id,rule) do update set value=excluded.value;
commit;
