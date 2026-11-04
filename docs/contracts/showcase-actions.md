# Demo guide showcase actions

The verified guide remains `p_demo_guide`. It does not impersonate Kendra and gains no household membership. Trusted demo markers plus a server-owned grant authorize parent actions for Nora, Max and Leo in the fictional Ellison households. Revoking that grant or removing the household's sandbox marker removes the action authority. Other fictional families retain the separate showcase read grant. Real-family grants and scheduled-parent rules are unchanged.

`guide_can_manage_child` is the database authority predicate. `isParentOf`, explicit `canManageChild` reads, per-child `showcase.manage` UI scopes, parent RLS and RPC checks consume it. A readable status result never establishes action authority. Pickup approval has an explicit showcase grant alongside the existing scheduled-parent rule. Confirmations and audit receipts record the guide identity. Grant/revoke and relationship approvals use atomic, scoped RPCs for the guide.

Writes to unmarked goals, notes and coordination jobs remain refused. Triggers enforce the child boundary on old and new rows, including security-definer writes, and cap committed guide writes at 120 per minute. Existing Muse generation budgets, rate limits, confirmation requirements and real-outreach refusals remain enforced. In-app simulated outreach consumes explicit caller authority and the existing fixed test-responder roster. Live SMS retains its existing operator gates, caps, approved roster and window.

Guide Reset calls only `restore_showcase_snapshot`, an owner-only function using versioned fixtures. It is atomic and idempotent by run ID. It preserves other families and unmarked rows; it neither creates nor deletes authentication accounts. The UI names the Ellison boundary before confirmation. This is a shared showcase with Reset, not a separate sandbox per judge. Concurrent judges using Ellison see each other's changes and resets.

Deploy both forward-only migrations with the application/schema release. The guide's action UI remains disabled until the server reports its per-child action scope. No live migration or reset is performed by the offline test harness.
