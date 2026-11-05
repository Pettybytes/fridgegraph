# README workflow illustration

The animated `docs/assets/readme/schedule-workflow.svg` explains the division of responsibility in FridgeGraph. It is not a captured network trace, a speed benchmark, or proof that all subgraphs are called for every action.

## The example and the two routes

The example moves an existing Nora violin rehearsal from 4 PM to 5 PM. Exact calendar requests are recognized by `src/rosina/calendarActions.ts`: the parser reads calendar write access and child events through the configured GraphQL endpoint, resolves the event, checks Detroit time, and produces a review card. This route deliberately avoids a model round trip.

Broader grounded model interactions use Muse Spark and authorized tools. The diagram includes that route to explain Rosina's role across the product; it does not claim Spark authored the deterministic calendar example. The two branches share caller identity and the federated graph.

The people at the top represent information sources and decisions. They are not literal HTTP services. School notices are supplied through the app; the diagram does not assert a live school webhook. Availability must be supplied or confirmed, not inferred from an empty calendar.

## Graph and storage

Apollo GraphQL is the infrastructure family. Apollo Federation composes the seven domain schemas. Apollo GraphOS is the graph platform used in the [connected-router evidence](evidence/15-graphos-jwt-router.md); Rover also supports local composition. GraphOS is not represented as a database or as a mandatory network hop for every read. Apollo Router plans runtime requests against the resulting supergraph. Village, Access, Schedule, Coordination, School, Transport, and Activities are the domain services. A request uses the fields and services it needs; the illustration groups all seven to show system scope.

Per-resolver authorization and database policies enforce access. The domains use one Supabase Postgres database, not a separate database for every person or subgraph.

## Confirmation and visible result

`web/src/features/rosina/CalendarChangeCard.tsx` sends the confirmed create/update/delete mutation using Apollo Client. It only reports success after returned data confirms the save, then invalidates frontend resources and signals calendar change.

Migration `0104_calendar_confirmed_writes.sql` defines the actor/request-key receipt and atomic calendar write. Permission is checked, retries are serialized and validated, and the event, receipt, and existing village activity append commit together or roll back together.

Calendar and Activity show the result. Other authorized perspectives read the saved record on refresh. This is not an assertion of cross-device push delivery or external-calendar synchronization. Mission Control is named in the surrounding README for the separate pickup-job path, not as a promised calendar-event mirror.

## Models and avatar

Muse Voice Transcribe supports the original sequential speech path; the Retell v3 web-call transport merged in [PR #293](https://github.com/Pettybytes/fridgegraph/pull/293) is a separate voice path. The calendar-update example above is a typed request; it does not assert voice support for updates or deletes. Muse Image supports invitation art; Muse Wonder assists development and review. They are not depicted as extra runtime steps in a calendar mutation.

Rosina's avatar is the production ready tile from `web/src/assets/rosina/rosina-board.png`, displayed using the viewport proportions documented in `web/src/components/fg/RosinaAvatar.tsx` (original board coordinate frame: x854, y48, width320, height330 in 1536×1024). The embedded PNG is the same tile extracted from the repository's 768×512 board; no new avatar was generated. The blue halo is presentation styling and does not assert a live thinking state.

## Motion and maintenance

A 28-second CSS cycle highlights request, co-pilot, graph read, proposal, confirmation, write, and visible result. Moving dashed connectors show direction through the main flow. All content stays visible when motion is absent; `prefers-reduced-motion: reduce` disables the animations. The diagram is self-contained for GitHub image rendering, including the avatar.

Update this diagram when the calendar route or persistence contract changes. Keep conceptual architecture, test receipts, and live functionality claims distinct.

## Outreach and human responses

The illustration’s lower panel is a separate communication branch, not an automatic side effect of every calendar edit. A parent confirmation of a calendar change is not blanket consent to call or text someone.

- The newer [`makeGhlTransport`](../src/outreach/ghlTransport.ts) sends SMS directly to GoHighLevel (GHL); n8n is off that send path.
- The earlier [n8n/GHL workflow contract](contracts/webhook.md) describes dispatch, SMS replies, and call/no-answer callbacks. [GHL workflow evidence](ghl/ghl-workflows.md) records published workflow metadata, payload checks, and the limits of that proof. Historical receipts are not rewritten as fresh tests.
- n8n forwards workflow events to the FridgeGraph backend for validation and state handling. A reply is a contribution by a person; it is not a new permission grant or proof that a child was collected.
- Bryan confirmed on November 5 that SMS and call options work with his integrated contacts. Live outreach is deliberately suppressed during testing to protect those contacts. This documentation change makes no new provider calls and publishes no contact data.

## People as resource-driven endpoints

A person is represented through identity, relationships, explicit capabilities, grants, and the records they contribute. The actual API endpoints are domain services, not people’s phones or separate databases per caregiver. A parent, grandparent, sitter or teacher can contribute a fact or decision through an authorized interface; the graph makes that contribution available only to entitled callers.

That is the enterprise-to-family translation: resource identity becomes a person or event ID; domain ownership becomes a subgraph; routing becomes a federated query plan; access control becomes child- and role-scoped permissions; an event log becomes an accountable history of family coordination. On-demand fetches return current stored information. They cannot know an unreported change or infer that someone is available just because a calendar is empty.

## Original build and future vision

FridgeGraph’s application began from scratch on October 26 for this hackathon, as Bryan confirms in the README and provenance statement. The enterprise patterns came from his professional experience; the external platforms and open-source dependencies remain credited to their creators.

Longer-term relationship memory and learning from consented, confirmed outcomes are a future research direction. They are not part of this illustrated calendar transaction and are not represented as already-shipped model self-training.
