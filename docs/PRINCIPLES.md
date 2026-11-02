# FridgeGraph principles

These are product rules for a fictional demo village. Each present-tense rule has an implementation and a recorded check. Future work is labeled.

## People keep authority

Rosina can prepare a plan, report or access proposal. The person with authority reviews the exact action and confirms through a separate authenticated path. A caregiver's willingness does not approve a pickup. See the [notice proposal](../src/rosina/noticeProposal.ts), [Add a Villager confirm](../src/subgraphs/access.ts), [notice browser proof](../web/evidence/notice-plan/live-2026-11-02/RECEIPT.md) and [evidence 72](evidence/72-add-villager-live.md).

## Access follows the caller

MCP forwards the signed-in person's token. Subgraphs and database policies enforce scopes, household policies and grant windows. A relationship does not itself grant care, schedule or pickup access. See the [access resolver](../src/subgraphs/access.ts), [briefing tool](../src/rosina/briefingTool.ts) and [evidence 67](evidence/67-rosina-notice-briefing-live.md).

## Answers stay grounded in evidence

Rosina uses authorized reads and cites what was recorded. A notice's verified text passage differs from an image or PDF transcription. A school report is someone's report, not a diagnosis or a pickup confirmation. See the [notice extractor](../src/rosina/noticeExtractor.ts), [Activity view](../web/src/features/activity/Activity.tsx), [evidence 67](evidence/67-rosina-notice-briefing-live.md) and [evidence 66](evidence/66-teacher-report-live-chat.md).

## Availability is explicit

Free time recorded on a calendar is not a caregiver's answer. A candidate's acceptance records willingness; parent approval and a completed pickup are later, distinct events. See [candidate logic](../src/derive.ts) and [evidence 70](evidence/70-grandma-accepts-in-app.md).

## Actions remain observable

The family sees proposed, pending, reported, approved and confirmed states with their own meanings. A discovery window can end without a reply, and an over-cap ride estimate waits for parent approval. See the [coordination resolver](../src/subgraphs/coordination.ts), [Activity](../web/src/features/activity/Activity.tsx) and [evidence 69](evidence/69-pricing-sweeper-over-policy.md).

## Privacy is part of the workflow

Orbit shows recipients only their authorized view. After a parent closes an alert as **FOUND_SAFE**, recipients see the outcome and thank-you, not the photo, place or descriptors. See the [Orbit resolver](../src/subgraphs/coordination.ts) and [evidence 62](evidence/62-orbit-redaction.md).

## Failures and simulations say what happened

An unavailable read remains unavailable. A simulated notification is not delivered outreach. The one real call in [evidence 33](evidence/33-session-3-real-call.md) was placed and interrupted without a recorded decision. The [notice browser receipt](../web/evidence/notice-plan/live-2026-11-02/RECEIPT.md) preserves an earlier 502 alongside the later successful run.

**Planned:** a week-ahead review cadence. There is no implemented ranking of families or caregivers by worth. A future review should help people notice commitments, never score the people in the village.
