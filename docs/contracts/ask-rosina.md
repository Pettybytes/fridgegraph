# Ask Rosina — Task W v1 frontend/service contract

Status: frontend contract; Bentley owns the service. Live service and execution integration are
unavailable. Scripted mock replies are explicit, not evidence of model performance.

## Transport

`POST /api/rosina` via Vite proxy to the Rosina service. Service address/port is not delivered;
there is deliberately no guessed proxy target. Add it when Bentley supplies it.

Authorization: `Bearer <signed-in Supabase user access token>`. The browser never holds demo
passwords or server credentials. Missing session sends no request. Backend enforces the user's
actual rights; persona display names are never authorization.

Request:

```json
{
  "message": "What can I do here?",
  "currentRoute": "#/mission-control",
  "history": [{ "role": "user", "content": "Earlier message" }, { "role": "assistant", "content": "Earlier reply" }]
}
```

History contains previous messages, excluding `message`. The app reuses the existing ChatMessage
thread model internally; wire history contains only role/content. History stays in memory,
scoped to the signed-in persona and sent with each call. The server MUST NOT persist history.
Do not log history, access tokens or private content. No localStorage or server conversation IDs.
A failed reply remains a client message; no action is inferred from it.

Response:

```json
{ "reply": "Plain text", "actions": [{ "id": "open-screen", "args": { "screen": "village" } }] }
```

`reply` is rendered as plain text. No model-written HTML or clickable links. Actions are only
catalog IDs and args. Ignore any response-provided route, URL, label, implemented or confirm flag.
The UI rebuilds routes from validated args. Unknown IDs, invalid args and unimplemented actions
are dropped. Model assertions never establish a fact or a permission.

## Catalog authority

`web/src/features/rosina/catalog.ts` is the sole authority. Every entry declares id, label, an
args schema, route/handler, changesData and implemented. Today's entries:

| ID | Args | Handler | Changes data | Implemented state |
|---|---|---|---|---|
| open-screen | screen: mission-control, village, care-information or ask-rosina | internally constructed hash route | no | yes |
| open-person | personId | card in authorized village projection | no | yes |
| start-pickup | childId, YYYY-MM-DD date, morning/afternoon/evening window | app-owned confirm, then mock handler | yes | mock only; live execution unavailable |
| open-calendar | day: YYYY-MM-DD, childId | scoped calendar day route | no | mock UI; live reads unavailable |
| open-event | id | scoped event detail route | no | mock UI; live reads unavailable |
| explain-screen | screen (including calendar) | factual UI explanation | no | yes |
| explain-recommendation | empty object | recorded recommendation status; no invented ranking reasons | no | mock; live service unavailable |

Args reject extra keys, invalid dates, arbitrary routes and URLs. Person cards are available only
for people in the adapter's authorized village projection. Pickup child must equal the session
child; current conservative mock allows parent entry only. Real action rights remain server-side.

Every data-changing entry ALWAYS requires the app's confirmation dialog, even if the response
claims `requiresConfirmation: false`. Cancel performs no action. Confirm consumes that card once.
W3's mock confirm creates no live job and contacts nobody. Existing `requestPickup(childId, asOf,
window)` can support live pickup later, as a separately integrated action after confirmation; W1
remains read-only. Do not fabricate a successful job until a backend write/read proves it.

## Isolation

Switching personas synchronously removes the old private workspace. The conversation registers
with W2's private-cleanup registry: abort pending reply, clear thread/draft/pending confirm/person
lookup, then load the new session. Late responses cannot populate another persona's conversation.
Apollo clearStore and selected record/person-card cleanup are part of the same boundary.

## Acceptance examples (scripted mock)

1. “What can I do here?” → explain capabilities and offer current screens.
2. “Show me Nora's afternoon.” → current recorded pickup status for an authorized parent, sourced
   from Mission Control demo data; explicitly not a complete calendar. Other views explain unavailable data.
3. “Why was this caregiver recommended?” → show recorded reasonCode; detailed ranking remains
   unavailable rather than invented. Acceptance is distinct from parent approval.
4. “I'm new to this village.” → own-village orientation, no cross-family information.
5. “Arrange a pickup.” → ask date/window, then a catalog confirm card. No write before app confirmation.
6. “Show me another family's child.” → explain scope boundary, leak no child records.
7. As Priya: “Can Nora have a peanut-butter snack?” → quote “Peanut allergy. Epi-pen in right backpack
   pocket.” with source Nora's care plan; reject the conflicting snack.
   This is a mock retrieval of recorded care information, not a model medical judgement. Until v2's
   approved care-rule integration lands, live version says **“I can't confirm that yet”**, without guessing.

Task CAL provides a mock Family Calendar and scoped calendar/event catalog actions. Live integration awaits the actual events migration and adult-schedules minimum slice specified by coordination-v2 §11. See `family-calendar.md`. Calendar actions validate IDs against the current persona’s projected children/events; the service must enforce actual rights.

## Reserved for coordination-v2 — owned by Claude/Bryan, NOT defined here

`docs/contracts/coordination-v2.md` is now on main (PR #18, docs only). Its future action
entries remain unavailable until their backing queries/mutations ship; they are not implemented or guessed in this PR. Once approved, add entries with explicit args,
permissions, handlers and implemented flags; unavailable entries never render usable buttons.
This section reserves the integration point, not IDs, schemas or behaviors for those entries.

## Bentley delivery needed

Rosina service URL/port and Vite proxy target; authenticated endpoint and error responses;
server assurance of no history persistence; current catalog allowlist in the model's tool/prompt
contract; real demo login/scopes; live action handler integration. W4 must test all personas,
unscripted questions/follow-ups, scope boundaries, ambiguity, created-family visibility and reset,
and report the model's errors verbatim. Scripted acceptance tests cannot substitute for those runs.

## Human copy and sharing boundaries (pre-merge correction)

Lead every scripted reply with the answer or the missing detail, then the recorded evidence.
Care example: “No, Nora has a peanut allergy. Her care plan says: 'Peanut allergy. Epi-pen in right
backpack pocket.' Source: Nora's care plan.” Sources never expose paths, table names, enum codes
or adapter names. Add “, added by <name>” only when the source actually records that author.
Today's care-plan record has no author metadata: do not infer Kendra from her role or grants.

A denied pickup view explains the sharing policy and the person's available information. Priya:
“Pickup plans are shared with Nora's parents. You can see Nora's schedule and care information.”
The cards use the same catalog validation and implemented checks as chat actions: open care
information or Ask Rosina. The mock schedule card opens the persona’s shared Family Calendar. Live calendar reads remain unavailable. The care screen rechecks the persona's
recorded mock permission, including direct-link requests. No authorization/schema changes.

## W4a — live browser adapter (incremental integration)

Task R's service is delivered on main 298f0ee. The browser now selects `createLiveRosinaAdapter`
when the current in-memory AuthSession has an accessToken; otherwise it selects scripted mocks.
Visible source labels are **Live** and **Sample answers**. Selection performs no readiness/model
call. Live failures remain live and never substitute a mock reply. The older unused service
adapter remains solely for compatibility; the wired live path sends care questions to the
service, whose unsupported-read answer is authoritative for availability of that read.

Each request captures the current session generation, reads the current bearer at send time,
and validates its generation again after the response. The panel independently checks generation,
request identity, cancellation and mount ownership before rendering. Session switch, panel close
(including Escape/navigation) and unmount abort requests. Late results/errors remain silent even
when a transport ignores abort. Panel state is internally keyed by persona generation, so old
messages, actions and confirm cards cannot survive a session switch.

History stays in memory, at most 40 messages, with each content bounded to the service's limit.
A live client timeout is 35 seconds, outside the service's graceful 30-second timeout. HTTP 401
says “Please sign in again” and prevents further sends until a fresh session; HTTP 429 says
“Give me a moment”. Neither retries automatically. Network/non-success/malformed/timeout failures
produce friendly live text. No raw response errors or credential details are surfaced. Service
HTTP-200 graceful fallback text is rendered unchanged. Replies remain plain React text; actions
still pass validateActions/actionAllowed and app-owned mutation confirmation. No mutation handler
has been enabled by this slice.

AuthSession.accessToken is optional, memory-only. Default mock login leaves it undefined.
App's auth dependency can be injected by tests and a local-only smoke entry; no browser global,
storage, URL parameter or product credential-setting endpoint exists. E2a public login is pending.
The dev harness obtains its bearer only through unmodified ops/auth.mjs in a Node process, passes
it through a short-lived no-store loopback response to the page session, and never includes it
in code, command arguments, evidence, logs, storage state, traces or screenshots. The dev entry is
not imported by the product entry and is absent from the production build.

W4a's live boundary gate is currently **FAILED**, not DONE: the service introduced an unrequested
foreign child name in a generic-family refusal. Exact output, source-tool comparison and token
scan receipt are in web/evidence/rosina-live/README.md. This frontend slice does not modify the
service prompt, catalog, tools, schema or backend authorization to hide or fix that regression.
