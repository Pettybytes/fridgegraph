# Judge-path smoke test

A single Playwright walkthrough of the "judge" path, runnable against **any** running instance.

- Spec: `web/e2e/judge-path.spec.ts`
- Config: `web/playwright.judge.config.ts` (own config; excluded from the default `npm run test:e2e`)
- Script: `npm --prefix web run test:e2e:judge`

## Base URL

Pass the target with `JUDGE_BASE_URL`. With it unset, the config spins up the local dev server on
`127.0.0.1:4182`.

```bash
# against the current local host
JUDGE_BASE_URL=http://localhost:5189 npm --prefix web run test:e2e:judge

# against a public hostname later
JUDGE_BASE_URL=https://<public-host> npm --prefix web run test:e2e:judge
```

Step screenshots land in `web/test-results/judge-path/<test>/NN-*.png` (gitignored). Override the
directory with `JUDGE_SHOTS_DIR=/abs/dir`.

## What it covers (read-only by default)

Picker loads with the persona cards → sign in as Kendra → Today + judge checklist → The Fridge
(overview + both doors) → Ask Rosina page renders → Mission Control + Village pulse → Activity →
Orbit → switch to the Demo guide (read-only; asserts no approve/confirm/replay controls).

## Error gate

The run **fails** on unexpected first-party console errors, failed requests, HTTP ≥ 400 responses,
and GraphQL errors embedded in HTTP 200 responses. Every observed negative is logged. Expected
negatives are declared **narrowly** at the top of the spec (not globally ignored) and recorded as
`[OK]`:

| Category | Match | Why it is allowed |
|---|---|---|
| failed request | host `tiles.openfreemap.org` | known map-tile fallback (third-party) |
| failed request | `net::ERR_ABORTED` on first-party `/graphql` | in-flight read the app cancels on navigation / persona switch (not a network failure) |
| HTTP 400 | op `WebActivityVillagerAdditions` | Activity villager-additions query rejected by the current deployed village subgraph |
| console | the generic `… 400 (Bad Request)` line | direct echo of the allowed HTTP 400 |
| GraphQL-200 error | field `householdMembers`, code `UNAUTHORIZED` | intended per-perspective field refusal |

Anything outside these narrow rules — including any other authorization error or any non-abort
network failure — fails the run. When the deployed subgraphs change, re-tighten the two
operation/field allowlists in the spec rather than widening the categories.

## Proposal mode (OPT-IN — authorized window only)

A second test walks a notice **up to the proposal and stops before confirming**. Creating a proposal
can persist data and spend model credits, so it is **skipped unless** you opt in with an environment
switch (Playwright does not accept a `--mutating` flag — this is the documented switch/wrapper):

```bash
JUDGE_PROPOSAL=1 JUDGE_BASE_URL=https://<host> npm --prefix web run test:e2e:judge
```

It asserts a `Review … proposal` affordance appears and that a `Confirm …` control exists, then
**never clicks confirm**. Verify the sample entry-point selector in your hosting window before the
run; it follows the RosinaPanel `Review … → Confirm …` pattern.
