# Ellison family fridge pack — sample delivery

**Status: SAMPLE DELIVERED FOR REVIEW. Not integrated, not merged, no backend or routing change.**
Generated 2026-11-02 with `muse-image-1.0`; credential used in place, never printed or logged.

## What the pack is

One complete, fictional pack for the Ellison family, built to test the fridge idea end to end on a
single family before any of the other five packs are made. Art is decorative, shared within the
village, and conveys no permissions. Live content is a separate layer and stays caller-authorized.

## Assets (12)

| Asset | Slot | People (fictional) | Note |
| --- | --- | --- | --- |
| `pack_dog` | `fridge.photo.dog` | Nora, Max, Leo | family dog; fluffy brown-and-white |
| `pack_walter_navy` | `fridge.keepsake.navy` | Walter | vintage Navy keepsake, face indistinct |
| `pack_loretta_card` | `fridge.note.retirement_invite` | Loretta | blank card; wording is DOM `SAMPLE` |
| `pack_crayon_family` | `fridge.art.crayon-family` | Nora | child's drawing, no text in image |
| `pack_candid_kitchen` | `fridge.photo.candid-kitchen` | Kendra, Andre, Nora | faces not visible |
| `pack_candid_porch` | `fridge.photo.candid-porch` | Kendra, Andre, Nora, Max, Leo | dusk, faces indistinct |
| `pack_candid_soccer` | `fridge.photo.candid-soccer` | Nora, Max, Leo, Marcus | distant, faces unreadable |
| `pack_permission_slip` | `fridge.note.permission-slip` | Nora, Kendra, Andre | blank paper; DOM `SAMPLE` |
| `pack_sitter_schedule` | `fridge.note.sitter-schedule` | Priya, Kendra, Andre | blank pad; DOM `SAMPLE` |
| `pack_holiday` | `fridge.photo.holiday` | — | no people |
| `pack_birthday` | `fridge.photo.birthday` | Nora | hands only |
| `pack_keepsake` | `fridge.keepsake.tray` | — | no faces, no text |

## States

- **Populated:** caller-authorized live items beside the pack art.
- **Empty:** authorized but nothing scheduled — an explicit "nothing scheduled" result, not a hole.
- **Refused:** no permission (or the demo guide) — generic "not available", no existence oracle;
  the pack art still renders.

## Behaviour

- **Co-parents:** shared art, each parent's layout person-scoped and private; no custody meaning.
- **Caregivers in several families:** only the selected child's village pack; packs never merge.
- **Demo guide:** pack renders; live content refused; no person-scoped privileges.
- **New family:** empty fridge, no inherited pack, live content empty until authorized.

## Choices and limits

- **No reference-image support was verified.** The verified request shape is text-only, so candids
  avoid recognizable faces and the Navy keepsake is turned away with a softened face. No asset
  establishes a conflicting identity.
- Pets, holidays, service history and celebrations are creative fixture choices, explicitly
  recorded — not facts inferred from names, ethnicity or relationships.
- Text is never baked into an image. The three text-bearing samples are blank artwork plus DOM text
  labelled `SAMPLE`, so no booking, signature or submission is implied.

## Where the files are

`/Users/user/.openclaw/workspace/portrait-pilot/` — `final/pack/`, `final/pack-manifest.json`,
`pack-contact-sheet.png`, `mocks/` (desktop and phone, populated / empty / refused),
`final/provenance.json`.

Integration is deliberately not done: slots map by person ID only, and the app still serves the old
placeholder portraits.
