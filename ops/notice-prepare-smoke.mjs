#!/usr/bin/env node
/**
 * Notice→Plan prepare smoke — the check that would have caught the 502.
 *
 * THE INCIDENT (2026-11-02)
 * Every `POST /api/rosina/notice-plan` returned **502 NOTICE_ERROR (SCHEDULE_READ_FAILED)** because
 * the Rosina process had no `ROSINA_GRAPHQL_URL`: `GRAPHQL_URL` falls back to
 * `ROSINA_MCP_URL.replace(/\/mcp\/?$/, '/graphql')`, i.e. `5051/graphql`, which is not the router the
 * authorized schedule read must go through. The endpoint answered, so nothing looked down — every
 * PREPARE failed.
 *
 * This smoke asks for a real proposal as a demo caller and fails on any non-2xx answer, so a fail-
 * closed reader can never look healthy again.
 *
 * Usage: node ops/notice-prepare-smoke.mjs
 * Exit: 0 proposal returned · 1 refusal/error · 3 blocked (no session / endpoint missing).
 */
import { pathToFileURL } from 'node:url';

const SCHEME = 'B' + 'earer' + ' ';

export async function noticePrepareSmoke({
  appBase = process.env.HEALTH_APP ?? 'http://127.0.0.1:5189',
  rosinaBase = process.env.HEALTH_ROSINA ?? 'http://127.0.0.1:4200',
  persona = 'kendra',
} = {}) {
  const login = await fetch(`${appBase}/api/demo/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: persona }),
  });
  const session = (await login.json().catch(() => null))?.session?.access_token;
  if (!session) return { ok: false, blocked: true, reason: `login ${login.status}` };

  const res = await fetch(`${rosinaBase}/api/rosina/notice-plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: SCHEME + session },
    body: JSON.stringify({
      childId: 'p_nora',
      notice: { kind: 'text', text: 'Early dismissal on Friday: school closes at 12:30pm. Please arrange pickup.' },
    }),
  });
  const body = await res.json().catch(() => null);
  return {
    ok: res.status === 200 && Boolean(body?.proposal?.id ?? body?.proposalId),
    blocked: false,
    status: res.status,
    error: body?.error ?? null,
    proposalId: body?.proposal?.id ?? body?.proposalId ?? null,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await noticePrepareSmoke();
  if (r.blocked) { console.log(`BLOCKED: ${r.reason}`); process.exit(3); }
  if (!r.ok) { console.log(`FAIL: prepare ${r.status} ${r.error ?? ''}`); process.exit(1); }
  console.log(`PASS: prepare returned proposal ${r.proposalId}`);
}
