# Contract v1 — Pickup SMS dispatch and caregiver-response binding

**Status:** proposal. Nothing implemented, nothing sent. Design reference: `webhook_events` (0018/0020/0021) already models provider-event dedupe; this contract reuses that shape rather than inventing a second one.

**Scope:** one authorized pickup request → one SMS to one approved test responder → one recorded response. It does **not** define parent approval (separate contract, and not a prerequisite).

---

## 1 · Event order (corrected, normative)

```
authorized request
  → SMS dispatched to the approved responder
  → responder reply recorded            (CAREGIVER_RESPONDED)
  → deterministic ranking/recommendation (RANKED)
  → parent decision                    (APPROVED | DECLINED | NONE)
  → readers observe the settled state
```

**A caregiver `YES` is a recorded availability, never an approval.** No code path may turn `CAREGIVER_RESPONDED(available)` into `APPROVED`. Approval exists only as a parent decision on the recommendation.

## 2 · Dispatch identity

A dispatch is identified by a durable value that survives transport retries:

```
dispatchId = sha256(attemptId, candidateId, jobVersion)
```

- The **same** `dispatchId` is reused for every transport retry of that dispatch.
- A **new job version** is a genuinely revised request: new `dispatchId`, and it is the only thing that authorizes another send.
- `jobVersion` is therefore part of the identity, not a detail of the payload — a retry must never silently become a resend.

Stored alongside: `providerMessageId` (nullable until accepted), `sentAt`, `state`.

## 3 · States

| State | Meaning | May resend? |
| --- | --- | --- |
| `PENDING` | identity created, not yet handed to provider | yes, same dispatchId |
| `ACCEPTED` | provider returned a message id | **no** |
| `UNKNOWN` | provider call returned an uncertain outcome (timeout, 5xx, truncated response) | **no — reconcile** |
| `FAILED_FINAL` | provider refused (invalid number, suppressed, blocked) | no |
| `SUPPRESSED` | recipient on opt-out / STOP list | **no, ever** |

**`UNKNOWN` must not be retried blindly.** Provider acceptance with an uncertain response enters reconciliation: poll/read the provider by `dispatchId` or correlated message id until `ACCEPTED` or `FAILED_FINAL`. Resending on `UNKNOWN` is the duplicate-send bug this contract exists to prevent.

## 4 · Response binding

Inbound replies bind by evidence, in this order:

1. `providerMessageId` → `dispatchId` lookup (primary).
2. If absent, `fromAddress` + `attemptId` + `candidateId` + `jobVersion` must **all** match one open dispatch.

**`contact.fg_attempt_id` alone is not sufficient** and must not be trusted as a correlation key: it is a mutable contact field, it can be stale, it can be overwritten by a later attempt, and it is not a delivery proof. It may be used only as a *hint* that must be confirmed by the checks above.

Outcome vocabulary mirrors `webhook_events`:

| Outcome | When |
| --- | --- |
| `ACCEPTED` | binding confirmed, response recorded |
| `REJECTED_STATE` | dispatch exists but is no longer open (closed attempt, superseded version) — record, do not act |
| `REJECTED_BINDING` | cannot attribute the message to exactly one dispatch — record, do not act |

A rejected binding is a **recorded fact**, not an error to swallow: it is how we answer "why didn't the app update".

## 5 · Idempotency

- Primary key: provider event id (same as `webhook_events.id`). Duplicate delivery is a no-op that returns the prior outcome.
- Payload digest stored; identical payload with a different event id is a provider-side duplicate and is rejected as `REJECTED_STATE`.
- Exactly one response may move a dispatch out of `PENDING`/`ACCEPTED` into `RESPONDED`. Later responses are recorded as `REJECTED_STATE` with the prior outcome returned.

## 6 · Consent, suppression and kill switch

**None of this exists today.** No opt-out, STOP, suppression or quiet-hours table is present in `supabase/migrations/`. This contract requires them before any live send:

- `outreach_suppression` — address-level, append-only, with reason and source (`STOP`, manual, provider-level).
- **Honoring STOP is not satisfied by consent.** A consenting recipient who later sends STOP must be suppressed; consent is not a durable waiver.
- **Kill switch** — one flag that stops dispatch at the boundary, evaluated before the provider call, and recorded when it fires.
- **Provider-level behaviour must be verified**, not assumed: whether the provider itself suppresses, and whether it will re-send after a STOP. That is a test, not a reading of documentation.

## 7 · Spend limits

No spending-limit primitive exists in the schema. Dispatch must enforce a per-window cap (count of sends) that is checked and decremented atomically with the dispatch record, or the send does not proceed. Exceeding the cap is `FAILED_FINAL` with reason `LIMIT`, never a silent skip.

## 8 · Reset boundary

A demo reset must **not** erase:
- suppression / opt-out rows,
- spending-limit consumption,
- dispatch identity and dedupe records.

Those are safety records. `reset` may clear demo content only; anything on the list above must be explicitly excluded and proven excluded.
