# Evidence 71 — `pickupRideEstimate` served: parents get the stored price, a caregiver gets UNAUTHORIZED

**Date:** 2026-11-02 · **Window:** N+1 · **Serving code:** branch `ebf994c` + inline subgraph typeDefs, 4008 pid **48261**, coordination subgraph 4003
**Contract:** #87 (agreed 01:59:18Z). Parent/guardian of the job's child, or the server-verified demo guide.

## What was asked

```graphql
query($j: ID!, $c: ID!) {
  pickupRideEstimate(jobId: $j, candidateId: $c) {
    jobId candidateId estimatedRideCostUsd costBasis distanceMiles costCalculatedAt householdCapUsd paidRidePath
  }
}
```

Run against the **coordination subgraph** (4003). It is *not yet* exposed through the composed supergraph — `rover supergraph compose` has not been re-run in this window, so `/graphql` on 4010/4012 still rejects the field. That recompose is part of delivering #87, and is not claimed here.

## Results — `node ops/ride-estimate-gate-proof.mjs` → **8 PASS · 0 FAIL**

| check | caller | result |
|---|---|---|
| stored estimate | Kendra (parent) | **12.4** |
| household cap | Kendra | **10** |
| basis verbatim | Kendra | contains `not a provider quote` |
| distance | Kendra | **8.86** |
| `paidRidePath` | Kendra | `true` |
| refused | **Loretta (the candidate herself)** | **`UNAUTHORIZED`** |
| refused | Dana (unrelated) | `UNAUTHORIZED` |
| refused with the **same** code | nonexistent job | `UNAUTHORIZED` |

## Why this matters

- The caregiver **cannot** read the price through this read even though she is the one who accepted — matching evidence 70, where cost fields came back null on her own evaluation.
- A nonexistent job and a hidden job produce the **same** answer, so the read is not an existence oracle.
- The values are the **stored** row's, not recomputed: 12.40 / 8.86 / cap 10 agree with `job_c7c989701b484493bde7f3c493b277b0`'s evaluation and `h_a`'s `ride_cost_cap_usd`.

## Still missing before #87 is complete

- `villageWorld(childId, asOf)` — not implemented.
- Supergraph recompose so the field is reachable at `/graphql`.
- `placeState` / `coordinateState` / per-person association fields — agreed, not built.
