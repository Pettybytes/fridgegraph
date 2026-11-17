# Tuning workflow

1. **Freeze the benchmark.** Include successful tasks, corrected context, interruption/recovery, and deliberately wrong outputs. Keep separate calibration and holdout scenarios. Set latency and quality budgets before collecting results.
2. **Plan candidates.** `python tune.py --grid configs/tuning_grid.json` emits a Cartesian run plan, capped at 1,000 configurations. Names are adapter parameters, not automatically recognized provider settings.
3. **Run the application.** Apply each candidate in the actual runtime. Capture the same cases, device/region and measurement boundaries. Record cold/warm and cache hit/miss runs separately. Repeat enough turns to describe variability. Do not replace failures with new successful retries.
4. **Rank calibration.** `tune.py --experiments captures/experiment.json` rejects candidates with a failed required gate, then minimizes response p95. It refuses mismatched benchmark contracts, overlapping split IDs and mixed synthetic/recorded data.
5. **Check the winner once on holdout.** A holdout failure rejects it. The selector does not search for a new winner using holdout results. If you redesign, retire that holdout and gather a fresh one.
6. **Compare to baseline before release.** Review every gate and raw trace, including false starts, interruptions and incorrect answers. This CLI proposes a configuration; it never deploys one.

`test_cases/tuning_example.json` is a synthetic demonstration: the fastest candidate fails task correctness, so a slower correct candidate wins. Its numbers are not measured provider performance.

An experiment contains `candidates`, each with `id`, `parameters`, `calibration` suite and `holdout` suite. Default `latency_metric` is `response_latency`. To optimize an application's named duration, set e.g. `"latency_metric": "measurement:decision_to_playback_ms"`; every measurement case must gate and provide that metric. Both splits must retain the same required sections, including at least one quality section.

Only case-ID overlap is automatically detected; the operator must prevent semantic duplicates across splits. Identical benchmark IDs establish matching declared cases, not identical traffic or statistical significance. No confidence interval or causal improvement is claimed.

| Knob | Intended effect | Tradeoff to test |
| --- | --- | --- |
| End-of-speech silence | Begin processing sooner | Premature cutoff and lost words |
| Streaming/model choice | Earlier useful output | Correctness, tool behavior and speech quality |
| RAG top-k/chunking | Supply relevant evidence | Retrieval overhead, prompt size and irrelevant context |
| Schema cache | Avoid repeated schema discovery | Revision invalidation and authorized scope |
| Semantic answer cache | Reuse eligible repeated answers | False matches, stale facts, tenant isolation and personalized context |

Cache hits and misses belong in separate measurements. RAG adds retrieval work; it is not inherently a latency optimization. Keep authorization and human confirmation independent of all tuning knobs.
