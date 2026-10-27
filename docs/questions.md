# Questions / deviations (Milestone 1)

Things the prompt left open, and how they were resolved. Nothing here blocks Milestone 1.

1. **`npm run reset` against a running in-memory store.** The store lives inside one Node process,
   so a separate `tsx src/reset.ts` cannot reach it by re-importing. `src/reset.ts` therefore POSTs
   to a local `POST /__reset` control endpoint that each subgraph server exposes (same process,
   shared store). Script name and semantics match the spec: it restores the fixtures.
2. **Child identity.** `Child.id` is the person's id (`p_nora`, `p_jax`), so the graph needs no
   separate child→person mapping. `Child.person` resolves to the same record.
3. **Who may call the derived queries.** `pickupCandidates` / `supervisionCandidates` /
   `approverFor` require the caller to be a parent of the child **or** to hold any grant valid at
   `asOf` for that child. Evidence #8 (Angela reads vehicles of Nora's pickupCandidates) is only
   reachable that way, since Angela holds `pickup.verify` but not `pickup.request`. Field-level
   data inside the result is still gated per the scope table.
4. **`CarePlan` and `HouseholdPolicy` write ownership.** `approveRelationship` (village) must also
   write an `Approval` row, which `access` owns. Federation has no cross-subgraph transaction, so
   the store exposes one `recordApproval()` helper used by both mutations. This is the single
   intentional cross-table write, required by Step 3.
5. **`approverFor` on a date with no schedule row.** Returns `approver: null` and all parents in
   `fyiParents` rather than guessing a default parent.
6. **Policy lookup.** `caregiver_approval` is read from the child's households. Only Household A
   carries it. If no policy row exists, the mutation still requires the caller to be a parent
   (single-authority behaviour), which is what `ANY_PARENT` means for one household.
7. **`Approval.at`** stores the request's "now" (`x-demo-date` or real date) as a plain date, since
   Milestone 1 has no clock service.
8. **Scope of `vehicle` read for parents.** A parent may read any vehicle of a pickupCandidate for
   their own child without holding `pickup.verify` — parents already have full access.
9. **Sibling types.** `brother`, `sister`, `sibling` are treated as sibling relationship types for
   the supervision age rule. No ages are hardcoded; the threshold comes from `HouseholdPolicy`.

10. **CLOSED — item 9 labelling, not a permission change.** The original brief asked for *Ray
    (Jax's father)* to be denied Jax's carePlan and *Evelyn (grandmother)* to be allowed. Read
    against the brief's own rules that is contradictory, so nothing was changed to force it:
    **Ray Coleman (parent) has full access to Jax's carePlan; Evelyn Carter (grandmother, no
    `careplan.read`) is UNAUTHORIZED.** No grant was added, removed or altered. Evidence #9 was
    relabelled to state this (`docs/evidence/09a-*`, `09b-*`). If a grandchild's care plan should be
    readable by a grandmother, that is a deliberate scope decision for a later milestone — it is
    not a bug to fix silently.
11. **Jax has a care plan in the fixtures.** Nothing in the fixture list specifies its text, but
    item 9 is only meaningful if there is something to read (an allowed query returning `null` looks
    identical to a policy gap). Added one line: "Mild asthma. Inhaler in the front pocket of the
    school bag." Replace or delete freely.
12. **`ops/PickupCandidates.graphql` uses `authorization: ***`** because the field type in the brief
    is written as `***`; it is modelled as `String` with the constant value `AUTHORIZED`.

13. **Router-level JWT authentication is licence-gated (blocks part of the plan).** The brief asked
    for `authentication.router.jwt` in `router.yaml`. An unlicensed self-hosted router refuses to
    start with it:
    `ERROR Not connected to GraphOS ... license for: Authentication plugin .authentication.router`
    and `ERROR license violation ... ["Authentication plugin"]`. Through `rover dev` this only shows
    as `Failed healthcheck`; running the router binary directly reveals it, and
    `router config validate` passes, so it is the licence check and not a config error.
    **Resolution:** verification moved into the subgraphs (`src/auth/verify.ts`), which is the
    stronger boundary anyway. If a GraphOS licence lands, the block to re-enable is quoted in
    `router.yaml`. **Needs your decision for the demo:** is there an `APOLLO_KEY`/licence you want
    the local router connected to, or is subgraph-side verification the accepted story?

14. **`05b` (Gloria) retired.** Gloria has no Supabase user because the approved seed list is
    exactly 13 people and she is not among them. `05a` (Walter) already demonstrates the
    schedule-only denial, and the stale `05b` file was deleted rather than left claiming a result
    that can no longer be reproduced. Reinstating it needs a 14th identity approved.

15. **UTC vs local date bug (fixed).** `today` was derived from `toISOString()`, so after 20:00
    Detroit time the graph believed it was already tomorrow and a same-day grant appeared expired.
    Now computed in `APP_TIME_ZONE` (default `America/Detroit`). Milestone 1 masked it because every
    test sent an explicit date.

16. **Stack traces are included in dev error responses** (`includeStacktraceInErrorResponses`).
    Useful locally, but it leaks source paths to clients — must be off before anything public.
