-- 0046 — Stage 1 consent: one explicit approver per household, and idempotency enforced in the DB.
--
-- CONSENT authority is deliberately separate from schedule_swap_approval (which governs parenting
-- swaps only). The rule value is either 'parent' (any parent/guardian) or a single person id.

alter table household_policies drop constraint if exists household_policies_rule_check;
alter table household_policies add constraint household_policies_rule_check
  check (rule in ('caregiver_approval','ride_cost_cap_usd','sibling_supervision_min_age',
                  'schedule_swap_approval','orbit_notify_eligible','consent_approval'));

-- A permission-slip approval may be recorded at most once per approver per slip. A repeated click
-- cannot double-count even if the application layer is bypassed.
create unique index if not exists approvals_permission_slip_once
  on approvals (subject_type, subject_id, approver_id)
  where subject_type = 'permission_slip';
