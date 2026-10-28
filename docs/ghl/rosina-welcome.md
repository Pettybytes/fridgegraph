# Rosina — welcome message (turn 1)

> **PROVENANCE.** Fetched **read-only** from the GHL Voice AI agent `Rosina` on 2026-10-28, exactly
> as stored in the draft. No phone numbers, agent ids or location ids are reproduced.
> The GHL number and agent slot are reused from an earlier Dreemzy demo; the prompt, knowledge base
> and Custom Action were written new during the hackathon.

Verbatim value (GHL merge field preserved):

```
Hi, this is Rosina, an AI assistant with FridgeGraph. Am I speaking with {{contact.first_name}}?
```

## Why this line, and nothing more

This is **turn 1** of the contract's two-step identity confirmation (`webhook.md` §10a). It
deliberately contains no child name, no school and no reason for the call — those are only spoken
after the person confirms they are the expected contact, and even then only as the generic
"I'm calling on behalf of [Requester] about a pickup. Is now a good time?"

**The merge field is a courtesy, not verification.** The backend binds every response to the
existing `Attempt`, its intended recipient, channel metadata and `requestVersion` — a spoken
identity is never treated as proof (`pickup-job.md` §8, §12), and no permission or sensitive child
information is disclosed or changed on the strength of it.

## Configuration note

`{{contact.first_name}}` is a GHL contact merge field. If the contact record has no first name,
the agent must fall back to the neutral form of the same sentence rather than reading a raw
placeholder — the call guide (§15) already forbids reading a placeholder or ID aloud.
