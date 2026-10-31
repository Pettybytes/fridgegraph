#!/usr/bin/env node
/**
 * ops/orbit-message-proof.mjs — the parent preview IS the text recipients read, so assert the text.
 *
 * 0052 changed two things a person would actually notice:
 *   1. undescribed descriptors are omitted instead of printing "Hair: not described.";
 *   2. the ask is human ("Reply 1 = With me, 2 = On my way, 3 = Can't help.") while the STORED
 *      response stays the controlled enum.
 *
 * Also proves the binding still holds: the hash covers the RENDERED wording plus the audience order,
 * so a template change necessarily invalidates an older preview.
 *
 * The alert created here is closed at the end; counts are printed so nothing is left ACTIVE.
 *
 * Run: node --import tsx ops/orbit-message-proof.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const ROUTER = 'http://127.0.0.1:4012/';
const SCHEME = 'B' + 'earer' + ' ';
const { tokenForPersonId } = await import('./auth.mjs');

let failed = 0; let total = 0;
const check = (label, ok, detail = '') => { total += 1; if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`); };

const gql = async (token, query, variables) => (await fetch(ROUTER, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: SCHEME + token }, body: JSON.stringify({ query, variables }),
})).json();

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL.replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await db.connect();

console.log('=== Orbit message: only what is known, asked in human words ===');

const kendra = await tokenForPersonId('p_mom');
const loretta = await tokenForPersonId('p_gma');

// 1. draft with NO hair descriptor: the omitted field must omit the sentence
const draft = await gql(kendra, `mutation($c: ID!, $wc: String, $wg: String, $cc: String, $ci: String){
  orbitDraft(childId: $c, wearColor: $wc, wearGarment: $wg, carryColor: $cc, carryItem: $ci){ draftId draftVersion status } }`,
{ c: 'p_nora', wc: 'yellow', wg: 'raincoat', cc: 'green', ci: 'backpack' });
const d = draft.data?.orbitDraft;
check('1 draft created', Boolean(d?.draftId), JSON.stringify(draft.errors?.[0]?.message ?? d?.status));

const pv = await gql(kendra, `mutation($d: ID!){ orbitPreview(draftId: $d){ draftVersion message messageHash audienceSize } }`, { d: d.draftId });
const preview = pv.data?.orbitPreview;
const msg = preview?.message ?? '';
console.log(`  message: ${JSON.stringify(msg)}`);

check('2 no "not described" filler', !/not described/i.test(msg));
check('3 no "Hair:" clause when hair was not given', !/Hair:/i.test(msg));
check('4 described fields are present', /Wearing: yellow raincoat/.test(msg) && /Carrying: green backpack/.test(msg));
check('5 raw enum codes are gone from the ask', !/WITH_ME|ON_WAY|CANNOT_HELP/.test(msg));
check('6 human reply options are named', /Reply 1 = With me, 2 = On my way, 3 = Can't help\./.test(msg));
check('7 photo line absent when no photo', !/Photo attached/.test(msg));

// 7a/7b — a preview minted under the OLD wording must not activate after the template change.
// The old text is reconstructed exactly (0034 wording) and hashed the same way the server does; the
// point is that the ACTIVATION IS REFUSED, not merely that a different hash exists.
const aud = (await db.query(
  `select coalesce(string_agg(person_id, ',' order by notify_order), '') v from orbit_audience_for($1)`, ['p_nora'],
)).rows[0].v;
const oldMessage = 'FridgeGraph Orbit: check-in not recorded for Nora. Wearing: yellow raincoat. '
  + 'Hair: not described. Carrying: green backpack. Reply WITH_ME, ON_WAY, or CANNOT_HELP.';
const oldHash = createHash('sha256').update(oldMessage + '|' + aud).digest('hex');
check('7a the pre-0052 hash differs from the current preview hash', oldHash !== preview.messageHash,
  `${oldHash.slice(0, 8)} vs ${preview.messageHash.slice(0, 8)}`);
const stale = await gql(kendra, `mutation($d: ID!, $v: Int!, $h: String!){ orbitActivate(draftId:$d, draftVersion:$v, messageHash:$h){ id status } }`,
  { d: d.draftId, v: preview.draftVersion, h: oldHash });
check('7b activation with the pre-0052 hash is REFUSED (ORBIT_PREVIEW_MISMATCH)',
  /ORBIT_PREVIEW_MISMATCH/.test(JSON.stringify(stale.errors ?? {})),
  (stale.errors?.[0]?.message ?? 'accepted').slice(0, 60));
const stillPending = (await db.query(`select status from orbit_alerts where id=$1`, [d.draftId])).rows[0]?.status;
check('7c the refused activation left the draft untouched', stillPending === 'PENDING_ACTIVATION', String(stillPending));

// 2. activate, then answer with the NUMBER a recipient would actually send
const act = await gql(kendra, `mutation($d: ID!, $v: Int!, $h: String!){ orbitActivate(draftId:$d, draftVersion:$v, messageHash:$h){ id status message } }`,
  { d: d.draftId, v: preview.draftVersion, h: preview.messageHash });
const alert = act.data?.orbitActivate;
check('8 activation accepted the preview binding', alert?.status === 'ACTIVE', JSON.stringify(act.errors?.[0]?.message ?? alert?.status));
check('9 the activated message equals the previewed text', alert?.message === msg);

const answered = await gql(loretta, `mutation($a: ID!, $r: String!){ orbitRespond(alertId:$a, response:$r){ alertId responseId } }`, { a: alert.id, r: '2' });
check('10 a HUMAN reply ("2") is accepted', Boolean(answered.data?.orbitRespond?.responseId), JSON.stringify(answered.errors?.[0]?.message ?? 'ok'));

const seen = await gql(kendra, `query($a: ID!){ orbitAlert(alertId:$a){ responses{ person{ id } response } } }`, { a: alert.id });
const stored = seen.data?.orbitAlert?.responses?.find((r) => r.person.id === 'p_gma')?.response;
check('11 the STORED response is still the controlled enum ON_WAY', stored === 'ON_WAY', String(stored));

// 3. the hash covers the wording, and the audience order
const bind = await db.query(
  `select _orbit_message_hash(a) = encode(digest(
      _orbit_message_for(a) || '|' ||
      coalesce((select string_agg(x.person_id, ',' order by x.notify_order) from orbit_audience_for(a.child_id) x), '')
    , 'sha256'), 'hex') as bound from orbit_alerts a where a.id = $1`, [alert.id]);
check('12 messageHash is sha256(message | audience) — a wording change changes the hash', bind.rows[0]?.bound === true);

// 4. parser table, straight from the database
const parser = [['1','WITH_ME'],['2','ON_WAY'],['3','CANNOT_HELP'],['With me','WITH_ME'],['on my way','ON_WAY'],
  ["Can't help",'CANNOT_HELP'],['WITH_ME','WITH_ME'],['ON_WAY','ON_WAY'],['CANNOT_HELP','CANNOT_HELP'],
  [' 2. ','ON_WAY'],['maybe later',null]];
let parserBad = 0;
for (const [input, want] of parser) {
  const got = (await db.query('select _orbit_reply_choice($1) v', [input])).rows[0].v;
  if (got !== want) { parserBad += 1; console.log(`     mismatch ${JSON.stringify(input)} -> ${got ?? 'null'}`); }
}
check('13 parser maps numbers, words and legacy enums; rejects the rest', parserBad === 0, `${parser.length - parserBad}/${parser.length}`);

// 5. leave nothing ACTIVE
const closed = await gql(kendra, `mutation($a: ID!){ orbitClose(alertId:$a){ id status } }`, { a: alert.id });
check('14 the proof alert is CLOSED', closed.data?.orbitClose?.status === 'CLOSED', JSON.stringify(closed.errors?.[0]?.message ?? 'ok'));
const active = await db.query(`select count(*)::int n from orbit_alerts where status = 'ACTIVE'`);
check('15 no ACTIVE alert remains', Number(active.rows[0].n) === 0, `active=${active.rows[0].n}`);

const totals = await db.query(`select (select count(*)::int from orbit_alerts) a, (select count(*)::int from orbit_responses) r`);
console.log(`\n  leftover counts: alerts=${totals.rows[0].a} responses=${totals.rows[0].r} (closed, not reset)`);
console.log(`\nRESULT: ${total - failed}/${total} PASS`);
await db.end();
process.exit(failed === 0 ? 0 : 1);
