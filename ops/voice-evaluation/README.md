# FridgeGraph voice evaluation and tuning

An offline evaluation harness inside FridgeGraph, with an adapter for Rosina's real `actions` and `VoiceTimings` shapes. Run it from this checkout; no second repository, API key or gateway is required.

```bash
cd ops/voice-evaluation
python3 -m unittest discover -s tests -v
python3 fridgegraph_capture.py --capture test_cases/fridgegraph_capture.json \
  --report reports/fridgegraph.json --suite-output reports/fridgegraph-suite.json
python3 eval_runner.py --test-set test_cases/sample_eval_set.json --report reports/synthetic.json
python3 tune.py --experiments test_cases/tuning_example.json --report reports/tuning.json
python3 tune.py --grid configs/fridgegraph_grid.json --report reports/plan.json
```

Python 3.10+, standard library only. From the repository root, exercise the **actual FridgeGraph handler and action catalog** against the adapter with stubbed providers:

```bash
node --import tsx --test ops/voice-evaluation/fridgegraph-contract.test.mjs
```

All checked-in observations are **synthetic**. Tests prove evaluator/handler compatibility and failure detection, not deployed latency, model quality or acoustic interruption handling.

## The issues this addresses

| Issue | Check or existing design choice | What it establishes |
| --- | --- | --- |
| Sequential ASR → Rosina → TTS adds up before playback | Preserve each server stage and the separate browser decision-to-playback metric | Which stage is slow, without calling server completion audible speech |
| A first HTTP chunk can be buffered or contain no audio | Keep byte timing separate from playback events | Transport latency does not substitute for caller experience |
| Repeated MCP discovery creates work before generation | Rosina already caches tool lists and caller-scoped context | Existing `streaming.test.ts` verifies repeated tool-list calls are avoided |
| Shared words can disguise wrong answers or forgotten corrections | Exact action arguments and assistant-probe contracts | Wrong child/day, missing actions and negated outcomes fail |
| Fast cancellation can leave audio playing | Separate cancellation acknowledgement, playback stop and next-turn recovery in raw traces | Barge-in must be measured at playback, not inferred from an abort |
| A faster configuration can damage task success | Required quality gates, calibration ranking, separate holdout | A fast but incorrect candidate cannot win |

## How this connects to current FridgeGraph

- `fridgegraph_capture.py` reads an explicitly supplied capture; it does not invoke Rosina or change the running app. Shape: `test_cases/fridgegraph_capture.json`.
- `observation.actions` comes from the selected Rosina response. `expected_actions` is independently labelled. An action proposal is not proof of a completed write or authorized access.
- `observation.timings` contains the browser hook's exposed timings, or a `/voice/turn` response for server-only checks. Omitted client timings stay missing.
- `speechEndToAudioMs` maps to **`decision_to_playback_ms`**. In `useRosinaVoice.ts`, its clock begins when VAD/manual stop decides the speech ended. It excludes the preceding silence wait and uses the hook's clock. It is not physical speech-end latency or acoustic output timing.
- The present hook defaults to `silenceMs: 350`. Older voice-conversation evidence described 1200 ms; that historical record is preserved. Do not add the configured wait and call it a measured end-to-end number.
- Current `VoiceTimings` contains no interruption stop/recovery events. The adapter reports those as **not evaluated**. The raw event evaluator supports them when an instrumented playback capture exists; it never invents them from server totals.
- The grid uses existing runtime variable names (`ELEVENLABS_TTS_MODEL`, `ROSINA_LENS_TTL_MS`), but only emits experiment plans. A runtime operator applies them and captures calibration/holdout data. No live sweep or configuration change occurs here.

Use `--suite-output` to normalize captures into the input accepted by `eval_runner.py` and `tune.py`. For these captures, select `"latency_metric": "measurement:decision_to_playback_ms"` in the tuning experiment. Every candidate must provide that metric and pass its action checks in both splits. Use genuinely distinct scenarios for holdout; the included example only demonstrates the selection logic.

## RAG and cache boundaries

FridgeGraph's caller-authorized graph/tool reads are its current grounding mechanism. **Kong RAG Injector and AI Semantic Cache are optional future integrations**, not installed components in this change. RAG can add relevant documents but also adds retrieval work; semantic caching can reduce eligible repeated-answer latency but needs freshness and scope checks. [Integration rationale](docs/kong-rag-and-caching.md).

The included Python `schema_cache.py` is an offline reference helper; it does not replace `src/rosina/turnCache.ts` or the existing tool-list cache. Schema caching avoids repeated metadata discovery; semantic caching reuses answers. Neither is authorization.

## Contracts and results

- [Capture contract](docs/capture-contract.md): raw events, named durations, required coverage, task/context/WER/retrieval checks.
- [Tuning workflow](docs/tuning.md): frozen cases, gates and holdout handling.
- [Component rationale](docs/latency-and-components.md): concise problem → technique → measurement.
- [Source provenance](UPSTREAM.md): copied reusable core and its exact revision.

Exit codes: 0 passes all required checks, 1 gate failure, 2 malformed input. `test_cases/failing_eval_set.json` must exit 1. Empty suites, non-finite durations and malformed event traces are rejected. p50/p95 use nearest rank and always include sample count; small synthetic datasets are not performance evidence.

Store private captures/reports under the ignored folders here or `.runs/`; do not commit tokens, raw audio or personal conversations. The adapter exports selected action/timing fields only. This path does not start servers, touch the database, send messages, change auth or make paid provider calls.
