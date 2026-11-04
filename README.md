<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/hero-dark.svg">
  <img src="docs/assets/readme/hero-light.svg" alt="FridgeGraph — Rosina prepares; parents decide. The village around a child, connected." width="1280">
</picture>

# FridgeGraph

**Families run on information that has no API. FridgeGraph gives the people caring for a child one connected, permissioned village. Rosina helps turn a change in plans into a proposal; a parent decides what happens next.**

[Try the hosted demo](https://fridgegraph.loomz.stream) · [Follow the six-step judge guide](https://fridgegraph.loomz.stream) · [How the graph works](docs/schema-plan.md) · [Provenance](PROVENANCE.md)

## The text that started it

On August 11, my friend Tori, a single mom, sent me a message: **“You know what would be marketable af? An assistant built specifically for single moms.”** I initially thought about the usual assistant app. The deeper problem was all the coordination a parent has to carry: a school notice in one place, a calendar in another, a caregiver who can help but lacks the right information, and a decision that still belongs to the parent.

<a href="docs/assets/origin/tori-message-original.jpg"><img src="docs/assets/origin/tori-message-original.jpg" alt="Full, unaltered screenshot of Tori's August 11 text proposing an assistant for single moms, followed by Bryan's response" width="540"></a>

*The original screenshot is shown in full, without cropping or retouching. It includes my reply. The app's families and children are fictional.*

A family is already a distributed system. The parent becomes its human router: remembering what changed, who is allowed to know, who is available, and who must approve. Enterprise software has patterns for connecting separate owners of information. I brought those patterns into the modern family, where people are on different phones, at work, at school, in different homes, and often exhausted. **The shared fridge is the metaphor; the living village is the system.**

This begins with single mothers, but it is not limited to one family shape. A child may have co-parents in separate homes, a grandparent raising a grandchild, a sitter with narrow access, a teacher reporting a change, or several trusted adults sharing care. FridgeGraph models the relationships and permissions around the child instead of assuming every household has the same structure.

## One change, visible across the village

| Before | With FridgeGraph | What the judge can check |
| --- | --- | --- |
| A school notice conflicts with pickup; the parent must notice and coordinate it manually. | Rosina reads the sample notice, identifies the conflict against the recorded schedule, and prepares a pickup request. The parent reviews and confirms. | The same recorded job ID appears in Rosina, Today, and Mission Control. A created request is **not** a completed pickup. [Notice path](https://github.com/Pettybytes/fridgegraph/pull/282). |
| A calendar change lives in one conversation or one person's head. | A confirmed Rosina calendar action is stored and audited. | Reload Calendar; check Activity for the add or cancellation. [Cancel repair](https://github.com/Pettybytes/fridgegraph/pull/285). |
| Different caregivers see too much, too little, or conflicting information. | Apollo joins seven domains for the signed-in person while server and database policies limit access. | Switch perspective: a parent, caregiver, and Demo guide do not get the same actions or facts. [Cross-family repair](https://github.com/Pettybytes/fridgegraph/pull/269). |
| When a child cannot be found, a parent must individually contact their trusted people. | **Orbit Alert** offers one parent-controlled door to the child's permitted village: description, audience, responses, and an explicit Found safe closure. | Preview the audience and refusal of an incomplete Send. A full live alert and SMS delivery are **not** part of the verified judge path. [Orbit states](docs/evidence/60-orbit-redesign.md). |

Rosina is a co-pilot, not an unchecked dispatcher. A caregiver's “I'm on my way” reports intent; it does not prove a child has been collected. A parent confirmation creates a record; it does not turn a request into a completed outcome. Activity retains the provenance of what changed, who acted, and when.

## Try the demo

Open [fridgegraph.loomz.stream](https://fridgegraph.loomz.stream) in a browser. **No local install is required to judge the hosted app.** Choose the Demo guide or Kendra, then follow the six steps on Today:

1. Review the school notice, confirm a pickup request, and follow its job ID to Mission Control.
2. Ask Rosina by **text** to add a calendar event; confirm, reload Calendar, and inspect Activity.
3. Ask a grounded family question; switch to another perspective to see access boundaries.
4. Review Orbit's audience and the Prepare screen. Do not send a real alert as a casual smoke test.
5. Explore the Village map and route estimates through different permitted perspectives.
6. Inspect Living Village from a caregiver or read-only Demo guide perspective.

The guide is a fictional showcase. Its [six-step checklist](https://github.com/Pettybytes/fridgegraph/pull/286) focuses on journeys checked on the public site; it is not a claim that every prototype or outbound provider is live. [Judge-path smoke instructions](web/e2e/judge-path.README.md) are available for maintainers.

## What Muse does

| Model or system | Role and evidence boundary |
| --- | --- |
| **Meta Muse Spark 1.3** | Rosina's grounded text conversation and action preparation, including reading a school notice against authorized family facts. The parent still confirms consequential actions. [Notice evidence](docs/evidence/67-rosina-notice-briefing-live.md). |
| **Meta Muse Voice Transcribe 1.0** | Transcribes spoken input in the current voice path. [Corrected backend round trip](docs/evidence/61b-voice-backend-corrected.md). |
| **Meta Muse Image 1.0** | Generates invitation art and supports reference-image edits and revisions. [Creative workflow](https://github.com/Pettybytes/fridgegraph/pull/199) is merged; [polished card and provider receipt](https://github.com/Pettybytes/fridgegraph/pull/289) require their own served-build check before being promoted as a judge step. Event details are rendered as readable card text rather than trusting an image model to spell names and dates. |
| **Meta Muse Wonder** | Assisted development: diagnosis, code review, and verification of map, transport, authorization, and demo repairs. It is a development collaborator, not a runtime decision-maker or a substitute for a public-site receipt. See [map repair](https://github.com/Pettybytes/fridgegraph/pull/273) and [handoff trail](https://github.com/Pettybytes/fridgegraph/pull/78). |
| **Apollo Federation + MCP + Supabase** | The authorized data and action path. Seven domain subgraphs compose through Apollo Router; caller identity flows through MCP to resolvers; Supabase stores records and applies row-level permissions. Model text does not override database policy. |

**An honest voice gap:** the current sequential speech → transcript → Muse response → ElevenLabs audio path was measured at about **6.9 seconds median and 11.2 seconds p95** from end of speech to useful audio in an 18-turn public-site diagnosis. That's too slow for effortless conversation. A faster Retell voice leg with Muse-authored proposals is under test in [draft #280](https://github.com/Pettybytes/fridgegraph/pull/280); local speed and CI do not prove a public voice-to-saved-action journey. Text with explicit confirmation is the reliable judge path until that gate passes. The lesson is a practical one: streaming and turn-taking matter, and the model should not get credit for a result the backend has not saved.

## Architecture and guardrails

| Layer | Responsibility |
| --- | --- |
| **Village** | People, households, relationships, care plans, and groups. |
| **Access** | Grants, policies, approvers, and parenting schedules. |
| **Coordination** | Pickup jobs, attempts, confirmations, and Orbit state. |
| **Schedule** | Calendar events and care schedule. |
| **School** | Reports and permission slips. |
| **Transport** | Vehicles, bus context, and route-related data. |
| **Activities** | Practices and group events. |

Apollo Router composes those seven owners into one graph. Rosina operates as the signed-in person through authorized tools; mutations and database functions also enforce their own boundaries. The web app uses React, TypeScript, Vite and Apollo Client. Supabase Postgres holds the fictional demo records. ElevenLabs gives Rosina speech; n8n and GHL are outreach plumbing, with live outbound SMS disabled on the judge path. Map travel estimates are labeled estimates, not ride bookings or real-time Uber/Lyft quotes.

Orbit is a **private coordination tool for a trusted village**, not an official emergency alert or replacement for emergency services. Only a parent can activate it; recipients see only information their role permits, and sensitive details are redacted after closure. The app does not track a child's location.

## Run the code yourself

The hosted demo above is the quickest evaluation path. For a source review, start with a clean clone and use the checked-in lockfiles:

```bash
git clone https://github.com/Pettybytes/fridgegraph.git
cd fridgegraph
npm ci
npm --prefix web ci
npm run typecheck
npm run check
npm --prefix web run build
```

These are **source and build checks**, not a one-command public deployment. Running the full graph locally also requires your own Supabase project, the runtime variables named in `.env.example` and `web/.env.example`, Apollo Router/Rover and the project's setup/migrations. Never commit credential values. The [local topology](docs/apollo-notes.md), [schema ownership](docs/schema-plan.md), and [judge smoke test](web/e2e/judge-path.README.md) are the next references. Do not run `db:reset` against a shared or production database.

## Evidence, limits, and provenance

- [Hackathon provenance and model roles](PROVENANCE.md)
- [Recorded checks](docs/evidence/) and [browser evidence](web/evidence/)
- [The school notice mouse-confirm repair and same-ID assertion](https://github.com/Pettybytes/fridgegraph/pull/282)
- [Six-step perspective checklist](https://github.com/Pettybytes/fridgegraph/pull/286)
- [Calendar cancel source fix](https://github.com/Pettybytes/fridgegraph/pull/285)
- [Orbit parent activation and post-close redaction](docs/evidence/60-orbit-redesign.md)

This repository records implementation and tests, but a merge does not prove deployment and a green CI check does not prove a live provider response. The source proofs, public-site checks, and outstanding gates are deliberately kept distinct. FridgeGraph was built for this hackathon with fictional demo families; Tori's text is the real origin of the idea.

**The aim:** less invisible project management for parents, more time to be present with their families.
