/**
 * Readiness flag for the pin intake. DEFAULT OFF. The web calls GET /api/rosina/pin/readiness and
 * only offers the real intake when `ready` is true. Ready requires the operator to have explicitly
 * enabled it (PIN_INTAKE_READY=1, set only after verifying the path end to end in a window) AND every
 * dependency to be present. Reasons are generic labels — never config values — so the probe can stay
 * unauthenticated without leaking anything.
 */
export function pinIntakeReadiness(env: NodeJS.ProcessEnv = process.env): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (env.PIN_INTAKE_READY !== '1') reasons.push('intake not enabled');
  if (env.PIN_LIVE !== '1') reasons.push('extraction not live');
  if (!env.ROSINA_PROPOSAL_SIGNING_KEY) reasons.push('signing key unset');
  if (!(env.ROSINA_GRAPHQL_URL ?? '').trim()) reasons.push('router url unset');
  const hasProvider =
    Boolean(env.META_API_KEY && env.META_BASE_URL && env.META_MODEL_ID) ||
    Boolean(env.BASETEN_API_KEY && env.BASETEN_BASE_URL && env.BASETEN_MODEL_ID);
  if (!hasProvider) reasons.push('vision provider unconfigured');
  return { ready: reasons.length === 0, reasons };
}
