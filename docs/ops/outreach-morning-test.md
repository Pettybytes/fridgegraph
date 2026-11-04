# Morning test — Rosina SMS pickup outreach (real texts)

For Bryan, 2026-11-05. This is the live run. Last night's proof sent nothing; this is the first
time real texts go out, to the three test responders only.

Nothing here needs a code change. If a step misbehaves, stop and tell Claude — do not hand-edit the
database or GHL.

## 0 · Before you start (Bentley confirms these once)

- Migration `0087_outreach_dispatch.sql` is applied to the live database.
- The deployed SHA is the merged SMS-path commit (Bentley gives it to you).
- Runtime env is set (values only in the environment, never in chat): `GHL_API_KEY`,
  `N8N_WEBHOOK_SECRET`, `OUTREACH_SUPPRESSION_KEY`.
- In GHL, exactly these three contacts carry the `fg-test-responder` tag, each with its real phone:
  **Loretta Brooks**, **Tasha Ellison**, **Bryan Brooks**. No one else carries that tag.
- The send kill switch is **OFF** (default).
- The clock is inside **08:00–20:00 America/Detroit**. Outside that, outreach is held by design.

Have all three phones in front of you.

## 1 · Send (what you do)

1. Open https://fridgegraph.loomz.stream as the **showcase parent**.
2. Walk the pickup journey: school notice → Rosina's proposal → **confirm the outreach**.
3. Rosina sends one SMS to each of the three test responders.

## 2 · What each phone should receive

- **One** text each on Loretta's, Tasha's, and Bryan's phones — no duplicates, no one else texted.
- The body is the pickup request naming the child, the time and the school, and asks for a YES/NO
  reply. (One SMS segment for the standard body.)
- If a phone gets **two** of the same request, stop — that is a duplicate-send defect, not expected.

## 3 · Reply (what you do), and what the app should show

Reply from each phone, then watch the app **without refreshing** — each change should appear within
about 5 seconds:

| Phone | Reply text | App shows for that caregiver |
| --- | --- | --- |
| Loretta | `Yes` | Available |
| Tasha | `yes I can` | Available |
| Bryan | `No, busy` | Declined (busy) |

- The reply updates the **caregiver's card**, the **Activity** feed, and **Mission Control** — all
  three, live.
- A caregiver YES is **availability only**. It is never an approval: you (the parent) still confirm
  the final plan in the app.
- Rosina then recommends from the recorded availability (the two who said yes, ranked).

## 4 · The three safety checks (do these too)

1. **Kill switch blocks a send.** Have Bentley flip the kill switch ON, then trigger the outreach
   again. No text should arrive on any phone; the app should show the send was blocked, not silently
   dropped. Flip it back OFF.
2. **A non-test number is refused.** Attempt outreach to any contact **without** the
   `fg-test-responder` tag. It must be refused — no text sent.
3. **Out-of-window is held.** If you test before 08:00 or after 20:00 Detroit, the send waits; it
   does not go out early. (No need to stay up for this — it is the same window the proof checked.)

## 5 · If something is off

- A text that should have arrived didn't → check the kill switch, the send window, and that the
  contact carries `fg-test-responder` with a correct phone.
- A reply didn't show in the app → note which surface (card / Activity / Mission Control) and tell
  Claude; the reply binding is keyed to the attempt, so a stuck one is diagnosable.
- Never reply `STOP` from a phone you want to keep testing with — `STOP` suppresses that number for
  real, and a reset will **not** clear it (that is deliberate).

## What last night's proof already established (no send)

The disposable-database rehearsal (`npm run rehearse:outreach-e2e`,
`docs/evidence/outreach-e2e.json`) proved, without sending anything:

- all three test responders produce the exact captured outbound (recipient, body, auth scheme);
- the kill switch, a non-test number, an out-of-window send and a `STOP`-suppressed number are each
  refused;
- replies parsed by the real deterministic parser, driven through the **real `/voice-turn` route**,
  record availability (yes/yes/no) in the same tables the card, Activity and Mission Control read;
- a wrong webhook secret and a stale timestamp are both rejected (401).

The one thing the proof could not measure is the browser-visible "within 5 s, no refresh" update on
the deployed build — that is exactly what step 3 above confirms.
