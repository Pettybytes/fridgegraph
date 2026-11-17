# Source provenance

The reusable Python modules, generic fixtures and core tests are copied from Bryan Petty's existing [ai-voice-agent-eval-framework](https://github.com/Pettybytes/ai-voice-agent-eval-framework) at commit [`69ebe402e121db6cbf4066a8f7484ac78730c7e7`](https://github.com/Pettybytes/ai-voice-agent-eval-framework/commit/69ebe402e121db6cbf4066a8f7484ac78730c7e7).

They are intentionally checked in so the FridgeGraph evaluation path works without another checkout. This is an offline subset: the standalone repository's optional ElevenLabs network benchmark and its transport tests are excluded. No provider invocation is added here.

FridgeGraph additions: `fridgegraph_capture.py`, its fixture/tests, the real-handler contract test, runtime-knob grid, this README and operational handoff. Before updating the copied core, review the upstream diff, run both test suites and the real-handler contract test, and record the new revision here. Do not automatically fetch mutable source at test/runtime.
