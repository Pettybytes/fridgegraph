# Design evidence — fixture captures

All screenshots under `web/evidence/design/**` are **fixture evidence**, captured
against the local dev server with **`VITE_DEV_MOCK_AUTH=true`** (mock auth, fictional
personas, no live backend, no real data). They are not live-session recordings.

- Mock personas (Kendra, Andre, …) and fictional portraits only.
- Status chips in these shots read `Sample` / `Fictional demo` because the data is
  mock; a live session would read `Live` / `Connected`.
- `run-chip-dark-1031/` — dark-mode session-chip legibility fixture.
- `run-depth-after/` — ambient gradient field + glass depth, light + dark.
- `run-focus-mode/` — dev-only recording focus mode (`?focus`) at 1280×720.
- `run-phoneframe-showcase/` — the dev-only PhoneFrame gallery (PR B).

Live recordings live under `web/evidence/signature/**` (Codex's workstream), not here.
