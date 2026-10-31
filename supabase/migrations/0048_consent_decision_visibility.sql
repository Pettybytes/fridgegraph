-- 0048 — a permission-slip decision is visible to the child's parents, and demo callers stay in the
--        sandbox.
--
-- 0047 records ONE decision per slip. The ledger read policy (0003) exposes an approval only to its
-- approver, or when the subject is a Grant/Relationship belonging to the caller's child. A
-- permission-slip row would therefore be visible to the approver alone: a second eligible parent
-- could not see that the decision already exists, and the slip's history would look empty to the
-- household that is supposed to be able to read it.
--
-- This adds exactly that read, for parents/guardians of the slip's child. It grants no write and no
-- wider read. The guide's read stays the separate sandbox policy (0025 demo_guide_approvals), and
-- every guide write is already refused by 0025's restrictive policies.
--
-- Second part: approvals carry no sandbox column (they are audit history, never reset). A demo
-- caller therefore needs the subject's own record to decide whether the write is sandbox-scoped,
-- and it may only write a permission-slip approval for a sandbox child. RESTRICTIVE so it ANDs with
-- the permissive self-approval policy instead of replacing it. Scoped to subject_type =
-- 'permission_slip' on purpose: grants and relationship approvals keep their existing behaviour.

create policy approvals_permission_slip_read on approvals for select to authenticated
  using (
    subject_type = 'permission_slip'
    and exists (
      select 1 from permission_slips ps
       where ps.id = approvals.subject_id and is_parent_of(ps.child_id)
    )
  );

create policy approvals_permission_slip_demo_insert on approvals as restrictive for insert to authenticated
  with check (
    not is_demo_caller()
    or subject_type <> 'permission_slip'
    or exists (
      select 1 from permission_slips ps
       where ps.id = approvals.subject_id and is_sandbox_child(ps.child_id)
    )
  );
