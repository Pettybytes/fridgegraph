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
