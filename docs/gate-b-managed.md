# Isolated managed voice candidate

PR #280 remains draft. The public voice and typed judge path are not switched.

`GATE_B_MANAGED_ENABLED=1` enables two routes on the isolated bridge:

- `POST /gate-b/tool`: Retell custom functions `read_schedule` and `prepare_calendar`.
  Both require `x-gate-b-key` (the existing WS credential) and `x-gate-b-session`
  (the short-lived per-call bind). The existing keyed WS ingress stays unchanged.
  Tool arguments cannot select another child. A bind is pinned to its first call ID.
- `GET /gate-b/proposals`: verifies the parent's bearer against the graph, resolves
  identity server-side and returns only that person's unexpired, still-authorized proposals.

Read-only schedule facts are queried under the caller's bearer for the bound child.
The managed Retell model answers from those facts. Calendar creation goes to the
Meta Muse endpoint; the response must identify `muse-spark-1.3`, and its structured
arguments must pass the existing catalog validator. Provider failure, missing/wrong
model attribution and invalid arguments produce no proposal. There is no mutation
dependency. Updates/deletes and other action types are not implemented here.

Proposals are held in the bound session's memory for its lifetime. This is not durable
saved-record attribution. Concurrent retries with the same request ID share work;
changed payloads with the same ID are refused. Proposal UUIDs survive retrieval and
become the existing calendar mutation idempotency key on parent confirmation.

In a Vite development server only, `?gateB=1#/ask-rosina` polls the authenticated
endpoint into Kendra's existing Confirm card. A production build never enables this
poller. The same parent/child checks apply in the UI; switching perspective clears
private state. No confirmation is performed by the poller or voice tool.

Bentley runs `ops/gate-b-managed-agent.mjs` only in the authorized deployment runtime.
It requires explicit `GATE_B_MANAGED_APPLY=1`, the runtime API/WS credentials,
`GATE_B_PUBLIC_URL` and the exact short `BRIDGE_SHA`. It changes only test agent
`agent_717254a7dfe44b438f245f6d59`. Per-call dynamic variables must include
`gate_b_session`, `gate_b_child`, and `gate_b_child_name`; retain bind metadata too.
The setup enables speech during proposal execution. Configuration is not a measured
speech-latency result. The full live journey and durable attribution remain release gates.
