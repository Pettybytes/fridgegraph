-- 0011 — Daniel's careplan.read window covers the demo dates instead of pinning 2026-10-26.
--
-- 06a ("as Daniel: carePlan allowed") asserted a grant window that covered TODAY. The seed row was
-- valid_from = valid_until = 2026-10-26, so the check went red the moment the wall clock passed
-- midnight into 2026-10-27 — a date-pinned fixture, not an authorization change. This widens the
-- window to 2026-10-20..2026-11-30 so the check tests "a window that covers now" and stays honest.
-- The expired control (Chris, closed 2026-09-30) is untouched.
update grants
   set valid_from = '2026-10-20', valid_until = '2026-11-30'
 where id = 'g_daniel';
