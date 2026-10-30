# Living Village v2 — mock UI projection

Authority: coordination-v2 §5, §5.6, §7, §9.5. Web only; no server authorization or seed change.

`web/src/features/village/v2/fixture.ts` contains six family networks and ten family children.
Zion is an additional directory roster entry, as named in §5.6, not a seventh private network.
Known names/relationships come from Cast v2 and existing fictional fixtures; unknown surnames,
contact details, schedules and care facts are not supplied. This is a focused frontend fixture,
not a claim of complete/live village membership. Original graph implementation/tests remain
separate; the lazy village entry point now selects the v2 mock surface.

## Scope boundary

`villageChildren` and `readVillage` model an upstream scoped read, not browser authorization for
live data. A delivered backend must enforce the same rights before returning any private data.
Child options are explicit persona scopes; never a menu of every fixture child.

- Kendra/Andre: Nora; Dana/Ray: Jax; Rosa: Emma with guardian authority.
- Felicia: Taylor, with Skye’s shared half-sibling existence only. No Imani or third-household
  membership/label is returned. The complete three-household shape exists only in the fixture;
  the authorized view intentionally cannot expose all three household names.
- Simone: Micah and Avery; Dwayne: Malik.
- Priya: Nora or Malik through independent grants. Each projection returns the selected child
  and Priya only, no other helpers, named household clusters or cross-household connections.
- Loretta: Nora and a separate Avery pickup-help context; no calendar/care rights inferred.

Full parent/guardian village projections show readable household clusters/support connections.
Grant-only projections are deliberately narrow: they do not claim a grant exposes the whole
village. Missing future graph reads remain unavailable, not filled from other family contexts.

## Shared directories

Parent/guardian views of Nora/Jax/Micah may open the Tigers roster and coach Marcus Reyes.
Those roster names are directory facts, never buttons into private child records. Teachers and
Room 12 project only the selected child and Angela Price; no class-wide family traversal.
Bus Route 14/Gary Holt likewise expose only that child’s connection, never other riders’ records.
Rosa can open Emma’s teacher connection without receiving Nora/Jax/Micah data. A shared person
creates no additional scope. Unknown/foreign connection IDs produce no detail.

Relationship text and approval authority are separate fixture fields. Grandmother/grandfather
labels coexist with guardian approval; Marcus Vance’s stepfather label confers no approval.
Both Lee mothers have recorded authority; Ferris helpers are not approvers. No authority badge
is inferred by parsing relationship text. Personal schedules, addresses, contacts and care plans
are absent from this surface, including shared directory sheets.

## Presentation and integration state

The selected child anchors a react-force-graph-2d map. Household color and matching labeled
clusters express household membership; people may appear in both household lists where the
record has both memberships. The accessible list opens the same details as graph nodes.
Mobile retains the map and stacks clusters. Selection resets on child/persona switches;
persona-generation unmount removes all private sheets synchronously. Scoped legacy person-card
hash links are honored without opening unknown/foreign people.

Fixture state: unavailable as live data. Projection/graph layout: derived. UI labels it demo.
No v2 surface is labeled live. UI completion and mock integration do not mark the task DONE.

Backend follow-up alongside W4: v2 seed, scoped village/household/member/relationship reads,
recorded approval authority independent of descriptive relationships, separately scoped grants,
directory-only roster/teacher/bus results and no transitive permission expansion. Integrate
against delivered fields only; repeat persona and shared-node exploration against real services.
