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
