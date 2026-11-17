# Capture contract (v2)

All CLI suite inputs require `schema_version: 2`, `source: "synthetic" | "recorded"`, a nonempty `required` section list and globally unique case IDs. The source label describes the submitted data; the evaluator cannot authenticate its provenance. Preserve raw receipts, runtime commit, configuration, device/browser and timestamps separately when publishing results.

Supported sections: `tasks`, `context`, `traces`, `asr`, `retrieval`, `measurements`. See `test_cases/sample_eval_set.json` for the complete shape. Omitted optional sections are `not_evaluated`, not passing evidence.

## Task and context observations

A task has `actual` and `expected` JSON objects. Each expected top-level value must equal the actual value, recursively and with the same JSON type. Extra top-level diagnostics are allowed; extra tool arguments within an expected object are not. An expected `tool_calls` list checks the complete list and order.

A context case names a `probe_index` in a role-labelled dialogue. Only that assistant turn's `output` is scored. Prior user/assistant messages never contribute credit. Corrected facts should appear in the expected output. Store the source response beside any manually reviewed annotation; do not derive an "actual" fact from the ground truth. Free-text correctness and unsupported claims need a separate human rubric or calibrated semantic judge.

## Voice event traces

Each event: `{ "type": "user_speech_ended", "turn_id": "turn-1", "at_ms": 1000 }`.

One monotonic clock, elapsed milliseconds, one playback interval per turn:

| Event | Required | Instrumentation boundary |
| --- | --- | --- |
| `user_speech_started` | yes | Actual input speech onset |
| `user_speech_ended` | yes | Actual last speech sample, not silence timeout expiry |
| `assistant_audio_started` | yes | Playback sink starts rendering response audio |
| `assistant_audio_stopped` | yes | Playback sink is silent; queued output is flushed |
| `stt_final`, `llm_request`, `llm_first_token`, `tts_request`, `tts_first_byte` | no | Observed stage transitions on the same clock |
| `agent_cancelled` | no | Cancellation acknowledgement; distinct from playback stop |

An interruption links `speaking_turn_id` and `interrupting_turn_id`. It must begin while the prior assistant is playing. Set `require_interruption: true` for mandatory barge-in scenarios. `limits.response_ms` and `limits.barge_in_ms` are maximum inclusive budgets, not claimed achievements.

`trace_capture.TraceRecorder` can record callback events. Use it on the process that observes the event. Never subtract unsynchronized server and browser clocks. An HTTP completion, TTS byte, or audio-ready flag cannot substitute for a playback event. This contract does not model duplex pre-response speech, multiple playback segments or automatic acoustic echo detection; split/extend those captures explicitly rather than silently dropping extra events.

## Named measurements

When an application exposes durations instead of raw events:

```json
{
  "id": "voice-turn-1",
  "input": {"scenario": "fictional demo greeting", "basis": "end-of-speech decision to playback"},
  "metrics_ms": {"decision_to_playback_ms": 1200},
  "limits_ms": {"decision_to_playback_ms": 3000}
}
```

Only `limits_ms` names are gates. Missing gated observations fail; negative, non-finite or boolean timings are invalid. Separate names preserve different clock/measurement boundaries. These cases do not imply barge-in, semantic correctness or user-perceived latency.

## Retrieval

Supply unique `relevant_ids`, ranked `retrieved_ids`, `citation_ids`, positive integer `k`, `min_recall` and optional `require_citations` (default true). Precision uses `k` as denominator even if fewer documents were returned. Citation validity means every cited ID was in the relevant retrieved top-k; it is not textual entailment. Expected-empty retrieval/abstention is better expressed as an explicit task outcome; empty relevance labels are rejected here.

## Publishing evidence

Use fictional scenarios. Keep raw captures in an ignored folder; exclude tokens, account identifiers and private conversations from public commits. Commit selected evidence only after reviewing the source, with source label and runtime/config provenance. Never rename a synthetic fixture to present it as a provider measurement.
