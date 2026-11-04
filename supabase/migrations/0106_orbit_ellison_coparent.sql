-- Restore Scenario 8's co-parent audience after 0105. Simulation only; no transport or consent changes.
begin;
insert into public.household_policies (household_id, rule, value)
select h.id, 'orbit_notify_eligible', 'p_dad,p_gma,p_bryan'
from public.households h
where h.id = 'h_a' and h.sandbox
on conflict (household_id,rule) do update set value=excluded.value;
commit;
