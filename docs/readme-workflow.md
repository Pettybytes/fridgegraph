# README workflow illustration

The animated `docs/assets/readme/schedule-workflow.svg` explains the division of responsibility in FridgeGraph. It is not a captured network trace, a speed benchmark, or proof that all subgraphs are called for every action.

## The example and the two routes

The example moves an existing Nora violin rehearsal from 4 PM to 5 PM. Exact calendar requests are recognized by `src/rosina/calendarActions.ts`: the parser reads calendar write access and child events through the configured GraphQL endpoint, resolves the event, checks Detroit time, and produces a review card. This route deliberately avoids a model round trip.

Broader grounded model interactions use Muse Spark and authorized tools. The diagram includes that route to explain Rosina's role across the product; it does not claim Spark authored the deterministic calendar example. The two branches share caller identity and the federated graph.

The people at the top represent information sources and decisions. They are not literal HTTP services. School notices are supplied through the app; the diagram does not assert a live school webhook. Availability must be supplied or confirmed, not inferred from an empty calendar.

## Graph and storage

Apollo Federation composes the seven domain schemas. Apollo Router plans runtime requests against the resulting supergraph. Village, Access, Schedule, Coordination, School, Transport, and Activities are the domain services. A request uses the fields and services it needs; the illustration groups all seven to show system scope.

Per-resolver authorization and database policies enforce access. The domains use one Supabase Postgres database, not a separate database for every person or subgraph.

## Confirmation and visible result

`web/src/features/rosina/CalendarChangeCard.tsx` sends the confirmed create/update/delete mutation using Apollo Client. It only reports success after returned data confirms the save, then invalidates frontend resources and signals calendar change.

Migration `0104_calendar_confirmed_writes.sql` defines the actor/request-key receipt and atomic calendar write. Permission is checked, retries are serialized and validated, and the event, receipt, and existing village activity append commit together or roll back together.

Calendar and Activity show the result. Other authorized perspectives read the saved record on refresh. This is not an assertion of cross-device push delivery or external-calendar synchronization. Mission Control is named in the surrounding README for the separate pickup-job path, not as a promised calendar-event mirror.

## Models and avatar

Muse Voice Transcribe handles spoken input; Muse Image supports invitation art; Muse Wonder assists development and review. They are not depicted as extra runtime steps in a calendar mutation.

Rosina's avatar is the production ready tile from `web/src/assets/rosina/rosina-board.png`, displayed using the viewport proportions documented in `web/src/components/fg/RosinaAvatar.tsx` (original board coordinate frame: x854, y48, width320, height330 in 1536×1024). The embedded PNG is the same tile extracted from the repository's 768×512 board; no new avatar was generated. The blue halo is presentation styling and does not assert a live thinking state.

## Motion and maintenance

A 28-second CSS cycle highlights request, co-pilot, graph read, proposal, confirmation, write, and visible result. Moving dashed connectors show direction through the main flow. All content stays visible when motion is absent; `prefers-reduced-motion: reduce` disables the animations. The diagram is self-contained for GitHub image rendering, including the avatar.

Update this diagram when the calendar route or persistence contract changes. Keep conceptual architecture, test receipts, and live functionality claims distinct.

