-- 0014 — fix consume_real_call_authorization: it could never succeed.
--
-- Found by the post-apply verification, not by review: 0013 granted EXECUTE only to service_role,
-- but the function body opened with `if current_person() is null then raise 'UNAUTHENTICATED'`.
-- A service_role caller carries no end-user JWT, so current_person() is null and the function
-- raised for every possible caller. Proven empirically: calling it with the service key returned
-- 400 P0001 "UNAUTHENTICATED".
--
-- The identity check was wrong in principle too. This function is not a user action: it is the
-- server's gate-2 claim immediately before dispatch, and the caller's identity is irrelevant to
-- whether a real call may be placed. What must bind is the AUTHORIZATION to the work — id,
-- attempt_id, recipient_ref and request_version — which the UPDATE already does in one atomic
-- statement. Removing the identity gate does not widen access: EXECUTE stays service_role only,
-- and a parent or caregiver still cannot call it at all.
--
-- REAL_CALL_EXCEPTION_ENABLED remains off by default in the dispatch path; this function only
-- decides whether a specific, pre-issued authorization may be spent once.
--
-- Rollback: re-apply the 0013 definition (identity gate restored). No table or grant changes.

begin;

create or replace function consume_real_call_authorization(p_id text, p_attempt text,
                                                          p_recipient text, p_request_version int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  -- Every predicate that binds this authorization to this attempt and this request version.
  -- No read-then-write window: zero rows updated means no call, full stop.
  update real_call_authorizations
     set consumed_at = now()
   where id = p_id
     and attempt_id = p_attempt
     and recipient_ref = p_recipient
     and request_version = p_request_version
     and consumed_at is null
     and expires_at > now();

  get diagnostics v_ok = row_count;
  return coalesce(v_ok, false);
end $$;

revoke all on function consume_real_call_authorization(text, text, text, int) from public, anon, authenticated;
grant execute on function consume_real_call_authorization(text, text, text, int) to service_role;

commit;
