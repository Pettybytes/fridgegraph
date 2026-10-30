# Family Calendar — Task CAL

UI complete on explicit mocks; backend reads unavailable; live integration NOT DONE.
Authority: coordination-v2 Areas A/B/D, §3, §6 and §9.5. No schema, auth or database changes.

## Adapter boundary and source state

`web/src/features/calendar/types.ts` defines a client projection, not proposed wire SDL.
`CalendarAdapter` exposes scoped `listChildren`, `readCalendar({childId,from,to})` and
`readEvent(id)`. The mock adapter models an upstream permission boundary; browser filtering
is never a substitute for server authorization. Source state is explicitly mock/unavailable;
care bands and day segments are derived from recorded fixture facts.

Events carry category, proposed/confirmed/cancelled status and instant start/end. Missing and
hidden fields are separate states. Confirmer and confirmation time appear only when recorded
and readable; CONFIRMED alone never supplies a person or time. Linked pickup, consent and
school records open actual mock record details. Restricted linked records and their private
attention flags are excluded. Visible unresolved facts remain Needs coverage, Consent pending
or Unconfirmed. Locations and linked records are never inferred.

## Scope and guardians

| Persona | Mock calendars | Authority |
|---|---|---|
| Kendra / Andre | Nora | parent |
| Loretta | Nora | schedule.read |
| Priya | Nora, Malik | separate schedule.read grants |
| Dana / Ray | Jax | parent |
| Rosa Castellano | Emma only | guardian; no parent account |
| Dwayne Ferris | Malik | parent |

Parent/guardian projections may include their readable linked coordination/consent records.
Schedule grants do not confer those rights. Unknown and foreign event IDs return the same
scope failure. Persona replacement unmounts all private calendar selections before the next
session loads. Calendar results are guarded by both adapter identity and route identity.
Legacy Nora/Jax views cannot fall through to another family for Rosa or Dwayne.

## Dates, schedules and busy windows

Every displayed date/time uses America/Detroit, independent of browser/process timezone.
Events and busy windows use half-open instant intervals; civil day boundaries are calculated
in Detroit, never by adding 24 hours. The November 1, 2026 day contains 25 hours. Two recorded
01:15 events remain distinct (EDT and EST); an overnight source record is segmented across
calendar days without duplication within a day. Detail sheets retain full source start/end.

Bryan confirmed **inclusive Detroit calendar dates** for mock holiday dateStart/dateEnd:
November 25–27 includes all three days. Bentley must confirm live wire semantics separately.
Only approved holiday arrangements override weekly schedules. Proposed/declined arrangements
remain labeled and do not override. Conflicting approved schedules surface a review state.
Joint guardians in one household combine as “Scheduled with Rosa & Tomás”. Schedule wording
expresses responsibility, never physical whereabouts.

Adult projections contain only person, start/end and opaque record ID. Busy reasons, employer,
appointment descriptions and other-child links never reach the view, even for the owner.
Gaps do not establish availability. Every visible event, care band, arrangement and busy slot
opens source detail; category colors are accompanied by text labels, not decorative dots.

## Mock plan and verification

The fictional fixture spans October 26–November 27, 2026, with Nora, Jax, Emma and Malik.
It includes the grandparent-led Castellano household, proposed and cancelled commitments,
school closures, Thanksgiving, inclusive holiday precedence and Dwayne’s midnight/DST shifts.
These are frontend scenario records shaped around the contract seed plan, not claims about
rows in the shared database or a complete implementation of its seed.

Rosina’s implemented read-only `open-calendar` (day, childId) and `open-event` (id) validate
arguments and persona scope before building internal routes. Future v2 mutation wrappers remain
unimplemented. Calendar context cannot select another child’s care information implicitly.

## Queue alongside W4 — Bentley delivery

Live v2 event, weekly schedule, holiday arrangement and busy/free reads; field-level visibility
and guardian authority; linked-record and confirmation metadata with distinguishable missing
versus restricted states; holiday end-date semantics; scoped child/event discovery; error and
polling behavior. Replace the mock adapter only against delivered operations. Then repeat all
persona, midnight, DST, holiday, unresolved-state and detail tests against real reads, alongside
W4’s service exploration. Mock completion proves neither live authorization nor backend reads.
