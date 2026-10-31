/**
 * The per-request "known children" roster the model is told about — scoped to exactly the
 * signed-in caller, never global.
 *
 * TASK R-LEAK fix: the previous version hard-coded `KNOWN_CHILDREN = [Nora, Jax]` into EVERY
 * caller's system prompt, so Kendra (Nora's family) could be told Jax exists even though she has
 * no access to Jax's family. With Cast v2 (six families) that leak only grows.
 *
 * There is currently no MCP tool that answers "which children can I, the caller, see" — every
 * live read (`households(childId)`, `relationships(childId)`, `PickupCandidates(childId)`, …)
 * already requires a childId as INPUT, not output (checked against schema/village.graphql and
 * schema/access.graphql on 2026-10-30; see docs/handoff/HANDOFF.md "Rosina tools available").
 * So this falls back to the next-best source the task allows: the SERVER-SIDE demo persona table
 * (`src/demo/personas.ts`, not `src/fixtures.ts`, not a service-role read, not the identity map
 * of other people) resolved by the CALLER'S OWN verified personId. Record for Bentley: ship a
 * `MyChildren` (or `myVillages`) MCP read, scoped by RLS to the caller, to replace this.
 *
 * The Demo guide is the one documented exception: her role is "sees the whole fictional
 * ecosystem," verified via the token's own `app_metadata.demo_guide` claim (src/auth/verify.ts) —
 * never guessed from a personId string match. Her roster is every sandbox child on record.
 */
import { DEMO_PERSONAS, type DemoPersona } from '../demo/personas';

export type RosterChild = { id: string; name: string };

function childOf(persona: DemoPersona): RosterChild {
  return { id: persona.childId, name: persona.childName };
}

/** Every distinct sandbox child across the whole demo cast — the Demo guide's documented scope. */
function allSandboxChildren(): RosterChild[] {
  const seen = new Map<string, RosterChild>();
  for (const persona of DEMO_PERSONAS) {
    const child = childOf(persona);
    if (!seen.has(child.id)) seen.set(child.id, child);
  }
  return [...seen.values()];
}

/**
 * The roster for exactly one caller. `isGuide` must come from the verified token
 * (`verifyBearer(...).demoGuide`), never from a personId string comparison.
 *
 * A personId that matches no demo persona (any other seeded person — a teacher, a bus driver, a
 * grandparent with their own test login, etc.) gets an EMPTY roster: no child is ever included on
 * a guess. An empty roster forces the model to ask rather than name anyone.
 */
export function scopedRoster(personId: string, isGuide: boolean): RosterChild[] {
  if (isGuide) return allSandboxChildren();
  const persona = DEMO_PERSONAS.find((p) => p.personId === personId);
  return persona ? [childOf(persona)] : [];
}
