#!/usr/bin/env node
/** Read-only family coverage checkpoints. Login credentials remain in memory and are never emitted. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createSeed } from '../src/fixtures.ts';
import { createCastV2 } from '../src/fixtures-cast-v2.ts';
import { createDemoHistory } from '../src/fixtures-demo-history.ts';
import { createSimulatedCoordination, createSimulatedCalendar, createSimulatedCareFacts } from '../src/fixtures-simulated.ts';
import { DEMO_PERSONAS } from '../src/demo/personas.ts';

const families = [
  { family: 'Ellison', children: ['p_nora', 'p_leo', 'p_max'], personas: ['kendra', 'andre'] },
  { family: 'Coleman', children: ['p_jax'], personas: ['dana', 'jax-family'] },
  { family: 'Castellano', children: ['p_emma'], personas: ['rosa'] },
  { family: 'Reyes', children: ['p_taylor', 'p_skye'], personas: ['felicia'] },
  { family: 'Lee', children: ['p_micah', 'p_avery'], personas: ['simone'] },
  { family: 'Ferris', children: ['p_malik'], personas: ['dwayne'] },
];
const baseline = createSeed(), cast = createCastV2(), history = createDemoHistory();
const sim = createSimulatedCoordination(), calendar = createSimulatedCalendar(), care = createSimulatedCareFacts();
const source = {
  jobs: [...baseline.coordinationJobs.map(r => ({ ...r, child_id: r.childId })), ...sim.coordination_jobs, ...history.coordination_jobs],
  school: [...baseline.schoolReports.map(r => ({ ...r, child_id: r.childId })), ...cast.school_reports],
  events: [...baseline.events.map(r => ({ ...r, child_id: r.childId })), ...calendar.events, ...cast.events],
  consents: [...baseline.permissionSlips.map(r => ({ ...r, child_id: r.childId })), ...cast.permission_slips],
  care: [...care.care_facts, ...cast.care_facts],
  carePlan: [...baseline.carePlans.map(r => ({ ...r, child_id: r.childId })), ...cast.care_plans],
};
const sourceCounts = families.map(f => ({ ...f, contexts: Object.fromEntries(Object.entries(source).map(([name, rows]) => [name, new Set(rows.filter(r => f.children.includes(r.child_id)).map(r => r.id ?? r.child_id)).size])) }));

const queries = {
  jobs: 'coordinationJobs(childId:$childId){id type status child{id}}',
  school: 'schoolReports(childId:$childId){id kind text at reportedAt}',
  calendar: 'childEvents(childId:$childId,from:"2026-10-05",to:"2026-11-17",includeCancelled:true){id title start end status}',
  consents: 'permissionSlips(childId:$childId){id title signed history{decision at approver{id}}}',
  care: 'careFacts(childId:$childId){id key value source{kind ref} verifiedAt confidence}',
  carePlan: 'carePlan(childId:$childId){text}',
  village: 'householdMembers(childId:$childId){person{id} household{id} role}',
  orbit: 'orbitStatus(childId:$childId){alertId status closeOutcome latestResponses{person{id} respondedAt response}}',
};
const argv = process.argv.slice(2);
const live = argv.includes('--live');
const selectedPersona = argv.find(x => x.startsWith('--persona='))?.slice(10);
if (selectedPersona && !DEMO_PERSONAS.some(p => p.id === selectedPersona)) throw Error('Unknown persona filter');
const boundaries = argv.includes('--history-boundaries');
const origin = argv.find(x => x.startsWith('--origin='))?.slice(9) ?? 'http://127.0.0.1:5189';
if (new URL(origin).username || new URL(origin).password) throw Error('Credential-bearing origins are refused');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw Error('Loopback origin required');

async function query(bearer, document, variables = {}) {
  try {
    const response = await fetch(`${origin}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ query: document, variables }) });
    if (!response.ok) return { state: [401, 403].includes(response.status) ? 'refused' : 'failed', http: response.status };
    const body = await response.json();
    if (body.errors?.length) {
      const errors = body.errors.map(e => ({ code: e.extensions?.code ?? 'UNKNOWN', message: e.message }));
      return { state: errors.some(e => /UNAUTHORIZED|UNAUTHENTICATED|FORBIDDEN|AUTH_ERROR/i.test(`${e.code} ${e.message}`)) ? 'refused' : 'failed', http: response.status, errors };
    }
    return body.data && Object.keys(body.data).length ? { state: 'ready', http: response.status, data: body.data } : { state: 'failed', http: response.status };
  } catch { return { state: 'failed', reason: 'Transport or non-JSON response' }; }
}

const reads = [];
if (live) {
  for (const persona of DEMO_PERSONAS.filter(p => (p.parent || p.guardian) && (!selectedPersona || p.id === selectedPersona))) {
    const response = await fetch(`${origin}/api/demo/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: persona.id }) });
    const login = await response.json();
    if (login.status !== 'READY' || !login.session?.access_token) { reads.push({ persona: persona.id, login: login.status ?? 'FAILED', http: response.status }); continue; }
    const bearer = login.session.access_token;
    const childrenRead = await query(bearer, 'query McCoverageChildren {myChildren{child{id person{displayName}} scopes}}');
    const children = childrenRead.state === 'ready' ? childrenRead.data.myChildren : [];
    const own = families.find(f => f.personas.includes(persona.id));
    const childrenIds = children.map(r => r.child.id);
    const byChild = {};
    // Paced, read-only; no mutation, provider call, reset, seed or notification.
    for (const childId of childrenIds) {
      byChild[childId] = {};
      for (const [context, fields] of Object.entries(queries)) {
        byChild[childId][context] = await query(bearer, `query McCoverage($childId:ID!){${fields}}`, { childId });
      }
      if (boundaries && byChild[childId].jobs.state === 'ready') {
        const visible = new Set(byChild[childId].jobs.data.coordinationJobs.map(j => j.id));
        const expected = sim.coordination_jobs.filter(j => j.child_id === childId && j.id.startsWith('fx_job_history_v1_')).sort((a, b) => a.created_at.localeCompare(b.created_at));
        const chosen = [...new Map([expected[0], expected.find(j => j.as_of === '2026-11-01'), expected.at(-1)].filter(Boolean).map(j => [j.id, j])).values()];
        if (chosen.length && chosen.every(j => visible.has(j.id))) {
          const fields = chosen.map((j, i) => `b${i}:jobTimeline(jobId:${JSON.stringify(j.id)}){at kind}`).join(' ');
          byChild[childId].historyBoundaries = { ...await query(bearer, `query McHistoryBoundaries{${fields}}`), expected: chosen.map(j => ({ id: j.id, at: j.created_at, day: j.as_of })) };
        } else byChild[childId].historyBoundaries = { state: 'missing', reason: 'Expected fixture IDs are not in the authorized job read' };
      }
    }
    // Own-family status is never evidence for isolation. Probe an unrelated child's job read too.
    const otherChild = own.children.includes('p_nora') ? 'p_jax' : 'p_nora';
    const isolation = await query(bearer, `query McIsolation($childId:ID!){${queries.jobs}}`, { childId: otherChild });
    reads.push({ persona: persona.id, childrenRead, byChild, isolation: { childId: otherChild, ...isolation } });
  }
}
const report = { recordedAt: new Date().toISOString(), origin: live ? origin : null, window: { from: '2026-10-05', through: '2026-11-17', timezone: 'America/Detroit' }, sourceRows: sourceCounts, reads };
const dir = `.runs/mc-analytics/coverage-${Date.now()}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/coverage.json`, JSON.stringify(report, null, 2));
function summarize(context, result) {
  if (result.state !== 'ready') return result;
  if (context === 'orbit') return { state: 'ready', hasAlert: result.data.orbitStatus?.alertId != null, status: result.data.orbitStatus?.status ?? null };
  if (context === 'historyBoundaries') return { state: 'ready', samples: result.expected.map((expected, index) => {
    const created = result.data[`b${index}`]?.find(moment => moment.kind === 'JOB_CREATED');
    return { id: expected.id, expectedAt: expected.at, recordedAt: created?.at ?? null, matches: Boolean(created && Date.parse(created.at) === Date.parse(expected.at)) };
  }) };
  const value = Object.values(result.data)[0];
  return Array.isArray(value) ? { state: 'ready', count: value.length } : { state: 'ready', hasRecord: value != null };
}
console.log(JSON.stringify({ artifact: `${dir}/coverage.json`, sourceRows: sourceCounts, live: reads.map(r => ({
  persona: r.persona, login: r.login ?? r.childrenRead?.state ?? 'failed',
  children: r.childrenRead?.state === 'ready' ? r.childrenRead.data.myChildren.map(c => c.child.id) : r.childrenRead?.state,
  contexts: Object.fromEntries(Object.entries(r.byChild ?? {}).map(([id, contexts]) => [id, Object.fromEntries(Object.entries(contexts).map(([name, result]) => [name, summarize(name, result)]))])),
})) }, null, 2));
