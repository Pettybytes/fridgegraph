# Fridge Phase 1

Base: db66009 (fetched origin/main). Only this feature, public/fridge, and evidence/fridge-experience are changed. After #151 merged, Bryan authorized the final route mount: The Fridge follows Today in navigation; #/fridge, #/fridge/notes and #/fridge/goals mount ConnectedFridge inside the existing session and child-access providers. Preview.tsx is used only by evidence/fridge-experience/preview.html; the production entry does not import it.

## Source inventory, before notes implementation

| Candidate | Existing read | Visibility | Destination / disposition |
| --- | --- | --- | --- |
| Care notes | carePlan(childId) { text }, existing CareInformation screen | authorizeChild careplan.read; server enforces parent/grant authority | #/care-information; only recorded text; no invented author |
| School notices | No list operation in current web contract; school reports are different records | Cannot infer access from school membership | Omitted |
| Pending proposals | Chat-local proposals, no supported persisted listing read | Signed proposals are not a general list | Omitted |
| Goals | goals(childId) { id title horizon status } | Existing resolver: parent records, approved-only for a valid goals.read grant, otherwise refusal; server also owns sandbox guide policy | Read-only board; verbatim horizons/status, no inferred deadlines |

The Apollo client and eligible-read wrapper come from ChildAccess; this feature creates no client or credential store. Context keys contain person, child and session generation. Pending reads abort and cannot publish after unmount. All caller data is memory-only. localStorage contains validated x/y/width/rotation values, keyed by person; no text, record bodies or tokens.

Samples are supplied separately from live source slots. Four paper colors are supported; an absent author stays unknown. Scene asset mappings and generation provenance are in public/fridge/PROVENANCE.md. The revised displayed selection is sofa, porch reading, soccer and the blank invitation. The other five verified scene assets are available for later manifest selection, with no app identity attached.

Door regions measured from the 2336×3504 image: left x=.19, y=.09, w=.306, h=.47; right x=.505, y=.09, w=.309, h=.47. Coordinates remain relative to the original image at every zoom. Drag works in collage focus only, with Alt+arrow keyboard alternative. Tidy up is local layout only.

No live backend check was performed. Preview uses clearly labeled sample goals, empty notes, and controlled refusal/failure states. Routing and navigation are mounted; capture review and deployment remain pending. School notices and proposal listing remain unsupported. Goal editing remains Phase 2.

## Revision 2

Care feedback is placed on the left door, with an independent retry control. Care and goals are independent reads; neither subscribes to unrelated app notifications. Request generations discard superseded results per source. Door controls, Escape and hash/history changes share the same view state. The clipped door is inert and aria-hidden, including Retry controls.

Local OFL-licensed Kalam replaces the Google Fonts import. Original decorative magnets have no keyboard targets. The goals board labels recorded horizons explicitly and keeps status text readable.

`visualFixture.ts` supplies controlled care/goals reads to evidence-only Preview/AppPreview entries. All preview modes are labeled “Mock data · visual preview”; empty/refused/failed cases exercise actual source-state components with no live calls. The production entry imports neither harness.

## Approved Ellison pack and content revision

All 12 approved images from #154 head fb91e9cbbe04adfe8f3a2dc880d40287527baf64 are copied with three responsive sizes and verified image/prompt hashes. See public/fridge/packs/ellison/provenance.json. The manifest selects this decorative pack only for recorded child ID p_nora (h_a/h_b, v_nora); other child IDs keep the generic sample collage. Selection is independent of display names and does not authorize any record. Seven images are displayed: dog, Navy keepsake, crayon drawing, kitchen candid, retirement card, permission slip and sitter schedule. Other assets remain available without overcrowding the door.

Forms are blank art with DOM titles and Sample labels; dialogs explicitly deny signatures, submissions, bookings or consent records. Dinner and the fictional December 12 baby shower/reveal save-the-date are sample DOM content. No decorative content enters Rosina context. The fridge has no alert dependencies, reads, subscriptions or feedback; the app's alert feature is untouched.

Mounted evidence uses AppPreview with the real App/Session/ChildAccess/ConnectedFridge component tree, mock picker sessions, and a controlled care/goals reader. This override is absent from production. It makes no live requests. The accepted route/nav commit 99840a1 remains unchanged.

## Phase 2 integration (deployment gate remains OFF)

Integration base: `6a0544bd75bac3e7f411a738f641f474e34aa7d2`. #159 component commit `434ba50f5a13f7c04cf54da8581979a28988286f` is cherry-picked, not recreated. Its existing editors/hook open in a focus-contained dialog from the Fridge; confirmed goal changes update the photographic whiteboard. Family notes retain their paper treatment in the existing note editor. The three decorative sample cards have a readable overview strip; the save-the-date displays “2 PM” while its fictional calendar time remains Detroit.

Production enablement requires **both** migration 0083 and a compatible backend deployed and verified in an authorized slot. Only then may the web build set `VITE_FRIDGE_EDITING_VERIFIED=true`. It defaults off. No live calls or deployment proof have been performed for this integration. A merge does not establish deployment readiness. The flag is an operational rollout gate, not authorization; the server still enforces all permissions.

The compatibility operation `FridgePhase2Compatibility` is a query, not a mutation, and never uses `__schema` or `__type`. It selects `__typename` and validates Phase 2 goals/note fields beneath literal `@skip(if:true)`. GraphQL validates skipped fields but never executes their record resolvers. Offline tests execute it with introspection disabled and resolver spies. This checks the **read schema shape only**, not migration state, mutation availability or a caller's grants. Those require the deployment verification above and the separate actual reads below. The compatibility response must successfully identify the Query root.

Only `GRAPHQL_VALIDATION_FAILED` with a recognized `Cannot query field` diagnostic for Goal.period/Goal.completedAt or Query.fridgeNotes means absent capability and enables the old read-only fallback. A missing database column, unknown validation error, mixed error, authentication failure, refusal or network error never means “old backend.” Each retains a distinct state. Reads use the session's existing Apollo client/current bearer and eligible-read renewal wrapper. Mutations use that client directly, once per explicit action; no automatic renewal replay or retry. There is no new client, token store, authentication path or write probe.

Phase 1 care/goals queries remain separate and unchanged. Even compatibility or Phase 2 read failure cannot add unsupported fields to them. Phase 2 read boundaries distinguish authentication, refusal, connection failure, database failure, empty and generic failure. The UI says Saved only after a matching returned record/confirmed deletion. Completion remains independent of proposal/approval; horizons are sent verbatim; grouping requires explicit period.

Parent/guardian controls use the signed-in session's role **only for its own child**. Selecting a different child does not inherit write authority from the default child or read scopes. Caregiver views remain read-only in this first UI slice, as #157 §5/#159 specify; no caregiver posting/grant UI is added. Guide is read-only and notes remain refused, with no note read request. A parent edits their own note and may explicitly share/unshare or remove visible notes. New posts send PARENTS_ONLY; content edits never send audience. Attachment loading is outside this contract.

Viewer/person/child/session keys unmount dialogs and editing state and discard late compatibility, read and mutation responses. An already committed mutation cannot be undone by unmounting. All record/draft state stays in memory. Existing local layout storage remains geometry only.

`Phase2IntegrationPreview.tsx` and its HTML are evidence-only, visibly mocked, and absent from production dist. Its controlled adapter is supplied through a preview factory scoped to the viewer; production never substitutes that mock for a failed read. #159 remains open; close it as superseded only after this integration PR is merged by Bryan. No HANDOFF edits.
