# Posted fridge notes — follow-up to merged #165

Base: aff06e5f942e61d782c61c5f7cad2ffc20b9afad.
Branch/worktree: feat/fridge-posted-notes / fridgegraph-fridge-posted-notes.
Capture source: b63ce3221c358ded7383fbee28535622adacd4cb (same source captured before commit; no code edits during browser run).
Own local preview: port 5242. Shared 5189 untouched.

Mock verification only. The existing evidence-only mounted App supplies controlled adapters and mock picker sessions. All screens carry “Mock data · no records written”. No deployment or live calls; production editing remains disabled behind the unchanged verified-deployment gate. Compatibility detection is unchanged.

## Behavior

Authorized Phase 2 records render as paper notes on the collage door, using their confirmed text, paper color, audience and recorded author. Tapping a paper opens the existing notes editor. The scrollable paper area keeps every returned record reachable by keyboard and pointer without covering faces. Stored notes are never merged into the sample manifest; the decorative invitation remains in the separate sample tray while stored papers occupy the door. The sample dinner stays visibly labeled.

The existing hook supplies confirmed records only. A failed edit or removal preserves the previous display. Refused reads supply no stored papers. Existing session/child keys clear the notes and editor and discard late responses. The adapter/server audience boundary is unchanged. Browser layout storage continues to contain geometry only; no note content is persisted.

## Verification

- Full web suite: 555/555, 91 files, one worker; see web-tests.txt.
- New mounted App regression: delayed post does not display or announce Saved; confirmed post appears; failed edit/remove preserve the paper; explicit retries update/remove; persona switch clears immediately and the next refused view contains no previous content. Existing sample papers and geometry-only storage are asserted.
- Web build/typecheck and root typecheck pass.
- Secret scan clean (rerun after staging evidence).
- Playwright browser post/edit/remove flows pass at 1440×900 and 390×844. Zero backend request attempts; see browser-flow.txt.
- Eight captures: overview, focused door, scrolled papers and newly posted paper at each width. Reviewed phone paper readability, scrolling to all notes, and sample/stored separation.
- Browser console: evidence entry has a favicon 404; no product behavior changed to suppress it.
- No preview HTML in production dist. No dependency, lockfile, backend, HANDOFF or rollout changes.
- #159 was already CLOSED when checked after #165 merged.

The new mounted test was corrected during authoring to scope the edit textbox to its form and wait for picker cleanup to enable the next persona; no pre-existing test or assertion was changed.
