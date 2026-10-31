# Evidence 50 — scenario instant (time-of-day) for demo runs

_Branch `feat/scenario-now`. Additive; gated by `DEMO_CLOCK=1`. **Authentication stays real-clock.**_

## Why

`x-demo-date` answers *what day is it* for day-granular grants and schedules, but the overdue check
needs a **time**. `isCheckInOverdue(status, now = new Date())` used the real wall clock, so a fixed
`dueAt` could not be made overdue on demand.

## What was added

- `scenarioNowFrom(headers, demoClock)` in `src/context.ts` — reads `x-demo-now` as a **full ISO
  instant**, and returns `undefined` unless `DEMO_CLOCK=1`. Date-only values, garbage and impossible
  timestamps are ignored rather than thrown.
- `RosinaTurnOptions.scenarioNow` — threaded only into `isCheckInOverdue`; defaults to the real clock.
- `server.ts` passes `scenarioNowFrom(req.headers, DEMO_CLOCK)`.

**Auth is untouched**: `verifyBearer` and token expiry never see this value.

## Proof — `npm run test:rosina` — 77/77

| Check | Result |
|---|---|
| ignored entirely when `DEMO_CLOCK` off | `undefined` |
| valid instant honoured under demo clock | `2026-10-31T20:05:00.000Z` |
| date-only value is not an instant | ignored |
| garbage / impossible timestamps | ignored, no throw |
| **same fixture, two instants**: `dueAt 2026-10-31T20:00Z` | **19:55Z → not overdue**, **20:05Z → overdue** |

The last row is the acceptance property: one seeded `dueAt`, two scenario instants, opposite answers —
so the overdue flag is genuinely computed from the supplied instant and not from the seed.
