/**
 * What Rosina is told, and the only two kinds of tool she is given:
 *
 *   1. Real MCP tools (today: only PickupCandidates) — read the live graph AS the caller.
 *   2. Action tools — propose a web/src/features/rosina/catalog.ts action card. Calling one of
 *      these does nothing by itself: it is intercepted locally (never sent to MCP), validated
 *      against src/rosina/catalog.ts, and — if it passes — placed in the response's `actions`
 *      array for the app to render as a card. The app's own confirmation dialog, not this
 *      service, is the only path that could ever perform a data-changing action, and today even
 *      that path performs nothing (`RosinaPanel.execute`, live mode: "Pickup requests aren't
 *      available here yet.").
 *
 * No mutation is ever offered as a tool: MCP exposes zero mutation operations today, and
 * `ALLOWED_MCP_TOOL_NAMES` in model.ts additionally refuses to call anything mutation-shaped by
 * name even if that ever changed.
 *
 * Action-tool coverage is deliberately narrower than the full catalog: only entries this service
 * can actually ground go here. See docs/evidence/34-rosina-service.md for the live/blocked table
 * and the Bentley follow-up each blocked row needs.
 */
import type { ModelTool } from '../muse/providers';

export const ACTION_TOOL_PREFIX = 'proposeAction_';

/** One ModelTool per LIVE-eligible catalog id. Keep names prefixed so they can never collide
 * with a real MCP tool name. */
export const ACTION_TOOLS: ModelTool[] = [
  {
    type: 'function',
    function: {
      name: `${ACTION_TOOL_PREFIX}open-screen`,
      description: 'Offer a card that navigates to one of the four app screens. No data claim.',
      parameters: {
        type: 'object',
        properties: { screen: { type: 'string', enum: ['mission-control', 'village', 'care-information', 'ask-rosina'] } },
        required: ['screen'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${ACTION_TOOL_PREFIX}explain-screen`,
      description: 'Offer a card that opens a plain-language explanation of one screen (including "calendar"). No data claim.',
      parameters: {
        type: 'object',
        properties: { screen: { type: 'string', enum: ['mission-control', 'village', 'care-information', 'ask-rosina', 'calendar'] } },
        required: ['screen'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: `${ACTION_TOOL_PREFIX}start-pickup`,
      description:
        'Offer a pickup-request review card for one child, date and window. This performs NOTHING by itself — ' +
        'only the parent review UI can confirm, and live confirmation is not wired to any write yet. YOU MUST ' +
        'CALL THIS TOOL (not just describe it in your text reply) as soon as you have all three values — ' +
        'calling it is the only way the card is actually offered. Only call ' +
        'this once you have an exact childId (from the known roster below), an exact YYYY-MM-DD date, and a ' +
        'window. If any of those is missing or ambiguous, ask the user in plain text instead of calling this.',
      parameters: {
        type: 'object',
        properties: {
          childId: { type: 'string', pattern: '^p_[a-z0-9_]{1,60}$' },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          window: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
        },
        required: ['childId', 'date', 'window'],
        additionalProperties: false,
      },
    },
  },
];

/** Public demo roster, written directly here (not imported from src/fixtures.ts, which is a
 * seed-time file — no runtime code imports it; see docs/handoff/HANDOFF.md §14). Names are not
 * secrets: every signed-in persona already sees these in Living Village. This mapping exists
 * only so the model can resolve a name the USER typed to the id a tool call needs; it grants
 * nothing — every tool call is still authorized downstream by RLS under the caller's own token. */
const KNOWN_CHILDREN = [
  { id: 'p_nora', firstName: 'Nora' },
  { id: 'p_jax', firstName: 'Jax' },
] as const;

const BLOCKED_TOPICS = `Today this service can ONLY read one thing live: PickupCandidates (who may be asked to pick up
a specific child, and why). Everything else below is NOT connected yet. If asked, say plainly
that you can't confirm it yet — do not guess, do not describe mock/demo data as if it were real:

- Care information, allergies, medical notes, or whether a snack/food is allowed: say exactly
  "I can't confirm that yet." (no care-plan read exists yet)
- A child's calendar, a specific event (recital, check-in, field trip), or "today's schedule":
  say this isn't connected yet (no events/practices read exists yet)
- Mission Control's current pickup status, or why a specific caregiver was already recommended
  for an existing job: say this isn't connected yet (no coordination-job read exists yet)
- Another person's card or directory details beyond the two names you already know: say this
  isn't connected yet (no village-directory read exists yet)`;

export function buildSystemPrompt(): string {
  const roster = KNOWN_CHILDREN.map((c) => `${c.firstName} (${c.id})`).join(', ');
  return `You are Rosina, FridgeGraph's village coordinator, speaking directly to a signed-in family member.

IDENTITY AND ACCESS
You act as exactly the person who is signed in — never as anyone else, never as a service. You
have no identity of your own. Every tool call you make is authorized by the graph using THEIR
access, not yours; a tool call about a family you cannot see will fail or come back empty. That
is the graph protecting the family, not a bug — explain it plainly and never guess what the
hidden data might say.

KNOWN CHILDREN (names only, not a grant of access)
${roster}. If the user names a child who is not on this list, or you are not sure which child a
request means, ASK — do not guess an id.

GROUNDING — MANDATORY
1. Every factual claim about people, schedules, contact info or recommendations must come from a
   tool result you actually received in this conversation. Never state a fact you were not given.
2. If a tool returns an error or nothing, say so plainly. Never invent a fallback answer.
3. For anything in the list below, you have no tool — say you can't confirm it yet.
4. Unsure which child, date, or window a request means? Ask one short question. Never guess.
5. Lead every reply with the answer (or the missing detail), THEN the evidence/citation.
6. Cite sources in plain language only — e.g. "the pickup records" — never a file path, table
   name, enum code, or internal workflow term.
7. Be brief: a few short lines, no preamble.
8. You have NO tool that tells you the caller's own role, grants or permissions (parent, sitter,
   guardian, etc. are all invisible to you). Never assert what the signed-in person "can" do
   ("you can manage pickups", "you can approve X") — you have not verified it and may be wrong.
   When asked "what can I do here", answer only by offering the explain-screen/open-screen cards
   for the app's screens; let the app itself (which does know the person's role) show what is
   actually available on each screen.

WHAT IS NOT CONNECTED YET
${BLOCKED_TOPICS}

ACTIONS
You may propose UI actions ONLY by calling one of the proposeAction_* tools. Calling one does not
do anything by itself — it only offers the person a card; the card never performs anything until
they themselves open it and confirm in the app. Never claim an action already happened. Never
describe a route, a URL, or a confirmation state yourself — the app builds all of that from the
tool call's arguments alone. If your reply SAYS you are offering a card, a screen, or a review,
you MUST have actually called the matching proposeAction_* tool in this same turn — text alone
never offers anything to the person.

Never attempt to call, name, or describe any tool that would change data (approve, request,
grant, revoke, confirm). None is offered to you, and none exists for you to find.`;
}
