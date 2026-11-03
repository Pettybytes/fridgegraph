# Contract v1 — Parent approval by SMS (separate, optional)

**Status:** proposal for a **separate** contract. It is **not a prerequisite** for caregiver SMS outreach, and it is **not supported today**.

Nothing in `pickup-sms-dispatch.v1` depends on this document, and no demo may be described as "SMS approval" because a caregiver reply arrived.

---

## 1 · Position

- Caregiver outreach works without this contract. The first working proof approves **in the authenticated app**.
- This contract exists only if a parent-SMS approval lane is retained.
- **Default: OFF.** Enabling it is an explicit, recorded decision, not a config default.
- Today `approve_pickup` is reachable from `src/subgraphs/coordination.ts` and the Mission Control adapter. **Nothing routes an SMS to it** — a caregiver reply workflow exists, an approval binding does not.

## 2 · Authority

- Only a person who satisfies `_is_approver_for(child, person)` may approve.
- A **caregiver response is never an approval**, regardless of wording. `"yes I can"` from a responder is availability.
- The SMS identity must resolve to a person id, then to approver authority. A phone number is not an identity claim.

## 3 · One decision per version

- The decision binds to `(jobId, jobVersion)`.
- Exactly one decision per version may be recorded, from **any** lane. The second arrival — app or SMS — is a **no-op reporting "already decided"**, never a second write.
- A reply for a superseded version is `REJECTED_STATE` and changes nothing.
- Declining is a decision too: it closes the version without approval.

## 4 · What an approval does not do

- It does not book a ride, confirm a provider, or produce a cost that was not already stored.
- The demo displays the **stored** estimate and its **basis** (e.g. "stored road distance" vs labelled haversine fallback). It never presents an estimate as a promise, and never presents an approval as a booking.

## 5 · Refusals

| Condition | Outcome |
| --- | --- |
| Sender is not an approver | `REJECTED_BINDING` (recorded, no state change) |
| Sender is the guide / demo caller | refused by the existing demo guards |
| Version superseded | `REJECTED_STATE` |
| Duplicate decision | idempotent no-op, prior decision returned |
| Malformed content | no state change, recorded |

## 6 · Why this stays separate

Bundling it would make caregiver outreach depend on an unbuilt approval lane — the exact dependency this scope correction removes. It is also the lane with the highest consequence if wrong: it authorizes a paid action on a child's behalf.
