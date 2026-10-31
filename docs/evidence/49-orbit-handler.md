# Evidence 49 — Orbit handler honours the catalog flag (after the gates)

_Branch `feat/orbit-handler`. Server-side handler logic + tests. Catalog metadata is web-owned._

## The defect

`src/rosina/model.ts` refused `prepareOrbitAlert` **unconditionally**: it validated the args, ran the
authority + vocabulary gates, then always pushed `UNIMPLEMENTED` and `continue`d. The catalog flag was
never read, so flipping metadata could not enable the action — both flips together were insufficient.

## The change

`decideOrbitAction()` in `src/rosina/orbit.ts` makes the order explicit and testable:

1. **shape** — a malformed call is `INVALID_ACTION`
2. **gate** — `NOT_PARENT` / `VALUE_NOT_IN_VOCABULARY` always refuse, flag or no flag
3. **catalog `implemented`** — false ⇒ `UNIMPLEMENTED`
4. **handler present** — absent ⇒ `UNIMPLEMENTED`

Only all four together propose the action. The model arm now pushes the action into `proposedActions`
on `propose: true`, and keeps the refusal path otherwise.

`ORBIT_HANDLER_PRESENT` is exported from `model.ts` — it describes whether this server build ships the
app handler. It is paired with the catalog flag, never a substitute for it.

## Fail-closed property

An enabled catalog with **no handler** still answers `UNIMPLEMENTED`. Metadata alone can never enable
the action; the flag only becomes live once a handler that can actually draft/preview/confirm exists.

## Tests — `npm run test:rosina` — 72/72 PASS

New: gate failures never overridden (3 cases); enabled-without-handler refuses; disabled refuses even
with a handler; only the full trio proposes; wired path with the flag flipped proposes the action and
records `isError: false`; wired path with the flag flipped but no authority stays refused (`NOT_PARENT`).

The pre-existing case — valid action, flag `false` → `UNIMPLEMENTED` — still passes unchanged.
