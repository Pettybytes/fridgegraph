# Caregiver Briefing — notes, gaps, and the Codex card

"What do I need to know for today?" answered ONLY from what the signed-in caller may read. The caller
is never impersonated; every read runs as their own bearer. Each caregiver's briefing is exactly
their own grant — on p_nora, per the seed (`0002_seed.sql`, `src/fixtures.ts`):

- **Priya** (sitter, `g_priya` = `supervise.request, schedule.read, careplan.read`) → schedule **and**
  care notes.
- **Loretta** (grandmother, `g_loretta` = `pickup.request, schedule.read, goals.read`) → schedule but
  **no** care notes (she lacks `careplan.read`). Her `pickup.request` would add an approved-pickup
  role line once the confirmation read exists (gap 1); `goals.read` isn't surfaced in the briefing
  yet.
- **A parent** (e.g. Kendra) additionally sees the **check-in** (parent-only) and the parenting-time
  role.
- An **unrelated caller** is refused.

So neither Loretta nor Priya strictly dominates — the on-camera contrast is that **Priya sees care
notes and Loretta does not**, while both see the schedule (and a parent sees the check-in on top).
The boundary is enforced in code (`briefingGather.ts` only issues a read the caller's scope permits;
`briefing.ts` can only word what the context carries), not in a prompt — see `briefing.test.ts` /
`briefingTool.test.ts`.

Files: `briefing.ts` (deterministic composer), `briefingGather.ts` (scope-gating gatherer, injected
readers), `briefingTool.ts` (prod readers from live MCP tools + `runCaregiverBriefing`), wired as the
local `CaregiverBriefing` tool in `model.ts`, with a BRIEFING instruction in `systemPrompt.ts`.

## Reads used (all existing Rosina tools, called as the caller)
- `ChildEvents` → what's scheduled and where (place **labels** only, never coordinates)
- `EffectiveSchedule` → "today is your parenting time" role (only when it names the caller)
- `CareFacts` → care notes (only issued with `careplan.read`), worded as the recorded fact
- `CheckInStatus` → parent-only; a non-parent read is denied and the section is simply absent

## Gaps (recorded, NOT built — backend is out of this lane)
1. **Approved-pickup role** ("you're the approved pickup at 12:30") is not reliably derivable from
   the reads exposed to Rosina: the job's `confirmation { candidate }` is not a Rosina tool, and the
   job stores only a coarse window + date (no clock time). `pickupRole` returns null in production
   and the role falls back to parenting time; the approved-pickup path is fully built + tested for
   when a confirmation read (candidate + time) lands.
2. **School reports** — `schoolReports(childId)` exists in the school subgraph but is not a Rosina
   tool, so it is not in the briefing. Needs `ops/SchoolReports.graphql` + the allowlist + MCP config
   + its own persona test.
3. **Parent-side "what will Loretta see?" variant (task #4) — SKIPPED, on purpose.** The clean,
   non-impersonating implementation is to describe a recipient's grant SCOPES (e.g. "Loretta can see
   the schedule and request pickup; Priya can see the schedule and care notes"), never a copy of
   their data. The read for that is `grants(childId,
   actorId)` in the access subgraph — but it is **not** exposed as a Rosina tool, and wiring it needs
   an MCP-config change (backend lane) plus its own persona-boundary tests. Out of this
   `src/rosina`-only task; left as a clean follow-up rather than impersonating anyone.
4. **Coordinates** are intentionally not emitted in v1 (labels only). Geometry-gated coordinates
   would require `address.read`; the `hasGeometryAccess` flag is plumbed through but unused, so "no
   coordinates without geometry access" holds trivially.

## For Codex — optional structured card (no RosinaPanel edit needed)
The tool returns `Briefing` JSON alongside the text; the panel already renders Rosina's text answer,
so a card is optional. If you want one, render `sections: [{ heading, lines[] }]` as a titled
"Today's briefing" card, with:
- a muted banner when `limitedAccess` is true (show `text`'s first line: "You have limited access …");
- a plain refusal state when `refused` is true (one line, no detail);
- the `Not visible to you` section styled as a quiet footnote, not an error.
No coordinates ever appear in the payload, so there is nothing map-like to render.
