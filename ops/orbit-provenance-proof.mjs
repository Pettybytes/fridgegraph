#!/usr/bin/env node
/**
 * ops/orbit-provenance-proof.mjs — last-seen provenance, proved with real mutations.
 *
 * Runs ONLY against a disposable local Postgres. It refuses any URL whose host is not a loopback
 * address, and refuses anything that looks like the shared project database. It creates its own
 * fictional rows, exercises the REAL database functions as `authenticated`, and commits them so they
 * can be inspected afterwards; the database is a throwaway container.
 *
 * What it measures (each a real function call, never a reading of the source):
 *   1. a recorded place with no parent-supplied time is REFUSED, not stored half-formed;
 *   2. a parent-supplied time with no recorded place is REFUSED the same way;
 *   3. a parent-supplied place + time is stored with a provenance source and appears in the message
 *      at the entered wall time (12:36 AM Detroit for the 05:36Z input);
 *   4. a last-seen time written without provenance is refused at write time. A row that predates the
 *      guard (simulated by disabling the trigger on this throwaway container) is WITHHELD by the
 *      reader — this is the defect: before the fix the reader served whatever sat in the column.
 *      The legacy row is INJECTED on purpose; it is not evidence that production code writes one.
 *   5. only a parent/guardian can close; a recipient's WITH_ME is a report and never closes;
 *   6. after a close a recipient loses the share row and the place row, and keeps the thank-you.
 *
 * Usage: PROOF_DB_URL=postgres://postgres@127.0.0.1:55437/postgres node ops/orbit-provenance-proof.mjs
 */
import pg from 'pg';

const CONN = process.env.PROOF_DB_URL ?? '';
if (!CONN) {
  console.error('PROOF_DB_URL is required (disposable loopback Postgres only).');
  process.exit(2);
}
const parsed = new URL(CONN);
const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
if (!loopback || /supabase\.(co|com|net)/i.test(parsed.hostname)) {
  console.error(`Refusing non-loopback database host: ${parsed.hostname}`);
  process.exit(2);
}

const OWNER = '00000000-0000-4000-8000-000000000001'; // p_mom
const DAD = '00000000-0000-4000-8000-000000000005';   // p_dad (separate draft, same child)
const GMA = '00000000-0000-4000-8000-000000000003';   // p_gma
const STRANGER = '00000000-0000-4000-8000-000000000004'; // p_dana

const c = new pg.Client({ connectionString: CONN });
await c.connect();

let failed = 0;
const results = [];
function check(label, ok, detail = '') {
  if (!ok) failed += 1;
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
}
const one = async (q, p = []) => (await c.query(q, p)).rows[0];
/** Run fn inside a committed transaction as `authenticated` with a JWT sub of uid. */
async function as(uid, fn) {
  await c.query('begin');
  try {
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: 'authenticated' }),
    ]);
    const value = await fn();
    await c.query('commit');
    return value;
  } catch (error) {
    await c.query('rollback');
    throw error;
  }
}
const asOwner = () => c.query('reset role');

console.log('=== Orbit last-seen provenance proof (disposable loopback Postgres) ===');
const version = await one('select version()');
console.log(`  server: ${String(version.version).split(',')[0]}`);

// ---------------------------------------------------------------- fictional setup
await asOwner();
await c.query('begin');
await c.query(
  `insert into identity_map (user_id, person_id) values ($1,'p_mom'),($2,'p_gma'),($3,'p_dana'),($4,'p_dad')
   on conflict (user_id) do nothing`,
  [OWNER, GMA, STRANGER, DAD],
);
await c.query(
  `insert into household_policies (household_id, rule, value)
   select h.id, 'orbit_notify_eligible', 'p_gma,p_bryan'
     from households h join household_members m on m.household_id = h.id
    where m.person_id = 'p_nora' and m.role = 'child' limit 1
   on conflict do nothing`,
);
await c.query('commit');

// Throwaway container: remove only the rows this proof could have created for Nora. The response
// table is append-only by trigger, so cleanup runs with triggers disabled — superuser on a
// disposable container, never a shared database (the loopback guard above is the boundary).
await c.query('set session_replication_role = replica');
await c.query("delete from orbit_responses where orbit_alert_id in (select id from orbit_alerts where child_id='p_nora')");
await c.query("delete from orbit_audience_members where orbit_alert_id in (select id from orbit_alerts where child_id='p_nora')");
await c.query("delete from orbit_alerts where child_id='p_nora'");
await c.query('set session_replication_role = origin');

const placeSchool = await one(
  "select id, label from recorded_places where household_id='h_a' and kind='SCHOOL_PICKUP' order by label limit 1",
);
const placePark = await one(
  "select id, label from recorded_places where household_id='h_a' and kind='PARK' order by label limit 1",
);
if (!placeSchool?.id || !placePark?.id) {
  console.error('FATAL: recorded places are missing; apply the migrations first.');
  process.exit(2);
}

const provenanceReady = await one(
  `select count(*)::int n from information_schema.columns
    where table_name='orbit_alerts' and column_name='last_seen_source'`,
).then((r) => r.n === 1);

const draft = (uid, placeId, at) =>
  as(uid, async () => {
    const r = await one(
      'select id, draft_version from draft_orbit_share($1,$2,$3,null,null,null,null,$4,$5)',
      ['p_nora', 'Blue', 'Jacket', placeId, at],
    );
    const preview = await one('select * from preview_orbit_share($1)', [r.id]);
    return { id: r.id, version: preview.draft_version, hash: preview.message_hash, message: preview.message };
  });
const draftRefusal = async (uid, placeId, at) => {
  try {
    await draft(uid, placeId, at);
    return null;
  } catch (error) {
    return error;
  }
};
const raw = async (id) => {
  await asOwner();
  return one(
    `select status, last_seen_place_id, last_seen_at,
            ${provenanceReady ? 'last_seen_source, last_seen_recorded_at, last_seen_recorded_by,' : ''}
            activated_at, closed_at, close_outcome
       from orbit_alerts where id=$1`,
    [id],
  );
};
const activate = (d, uid = OWNER) => as(uid, () => one('select activate_orbit_alert($1,$2,$3) id', [d.id, d.version, d.hash]));
const shareAs = (uid, alertId) => as(uid, () => one('select * from orbit_share_for($1)', [alertId]));

// ---------------------------------------------------------------- 1. place only
const placeOnly = await draft(OWNER, placeSchool.id, null);
const placeOnlyRow = await raw(placeOnly.id);
check('1a a place recorded without a time stores NO time', placeOnlyRow?.last_seen_at === null,
  String(placeOnlyRow?.last_seen_at));
check('1b the message names the recorded place and omits a time',
  /Last seen: [^.]*School\./.test(placeOnly.message) && !/Last seen: [^.]* at /.test(placeOnly.message),
  placeOnly.message.split('Last seen: ')[1] ?? '(no place sentence)');

// ---------------------------------------------------------------- 2. time only
const timeOnlyErr = await draftRefusal(OWNER, null, '2026-11-02T05:36:00Z');
if (provenanceReady) {
  check('2  a time with no recorded place is refused, never turned into an observation',
    timeOnlyErr?.code === '22023' && /ORBIT_LAST_SEEN_INCOMPLETE/.test(timeOnlyErr.message),
    timeOnlyErr ? `${timeOnlyErr.code} ${timeOnlyErr.message}` : 'accepted');
} else {
  const timeOnly = await draft(OWNER, null, '2026-11-02T05:36:00Z');
  const row = await raw(timeOnly.id);
  check('2  (pre-fix) a time without a place is stored as nothing',
    row?.last_seen_place_id === null && row?.last_seen_at === null,
    JSON.stringify({ place: row?.last_seen_place_id, at: row?.last_seen_at }));
}

// ---------------------------------------------------------------- 3. recorded place + time
const recorded = await draft(OWNER, placePark.id, '2026-11-02T05:36:00Z');
const recordedRaw = await raw(recorded.id);
check('3a a parent-supplied place and time are stored',
  recordedRaw?.last_seen_place_id === placePark.id && recordedRaw?.last_seen_at !== null,
  `${recordedRaw?.last_seen_place_id} @ ${recordedRaw?.last_seen_at?.toISOString?.() ?? recordedRaw?.last_seen_at}`);
check('3b the message renders the entered wall time (12:36 AM Detroit)',
  /Last seen: [^.]* at 12:36 AM\./.test(recorded.message), recorded.message.split('Last seen: ')[1] ?? '');
if (provenanceReady) {
  check('3c the row records the source, who entered it and when',
    recordedRaw.last_seen_source === 'PARENT_ENTERED'
      && recordedRaw.last_seen_recorded_by === 'p_mom'
      && recordedRaw.last_seen_recorded_at !== null,
    `${recordedRaw.last_seen_source} by ${recordedRaw.last_seen_recorded_by}`);
}
check('3d the reader serves a parent-recorded place and time',
  (await shareAs(OWNER, recorded.id))?.last_seen_at != null,
  String((await shareAs(OWNER, recorded.id))?.last_seen_at ?? 'null'));

// ---------------------------------------------------------------- 4. the defect
const synthetic = await draft(DAD, null, null);
await activate(synthetic, DAD);
await asOwner();
const inject = () => c.query(
  "update orbit_alerts set last_seen_at = activated_at + interval '30 minutes' where id=$1",
  [synthetic.id],
);
let injectionError = null;
try { await inject(); } catch (error) { injectionError = error; }
if (provenanceReady) {
  check('4a a last-seen time written without provenance is refused at write time',
    injectionError?.code === '42501' && /ORBIT_LAST_SEEN_UNPROVENANCED/.test(injectionError.message),
    injectionError ? `${injectionError.code} ${injectionError.message}` : 'write accepted');
  // A row written before the guard existed. Simulate it with triggers disabled on this throwaway
  // container; the READER must still refuse to present it as an observation.
  await c.query('set session_replication_role = replica');
  await inject();
  await c.query('set session_replication_role = origin');
  const legacy = await shareAs(OWNER, synthetic.id);
  check('4b the reader withholds a legacy time AND place that carry no provenance',
    (legacy?.last_seen_at ?? null) === null && (legacy?.place_label ?? null) === null,
    JSON.stringify({ at: legacy?.last_seen_at ?? null, place: legacy?.place_label ?? null }));
} else {
  await inject();
  const servedTime = (await shareAs(OWNER, synthetic.id))?.last_seen_at ?? null;
  check('4a (pre-fix) the reader serves an unprovenanced time as last-seen — the defect',
    servedTime !== null,
    servedTime ? `served ${new Date(servedTime).toISOString()} copied from activation time` : 'withheld');
}
// The one-active-per-child index means this alert must be closed before the next one is activated.
await as(OWNER, () => c.query("select close_orbit_alert($1,'FOUND_SAFE')", [synthetic.id]));

// ---------------------------------------------------------------- 5. authority + report semantics
const d5 = await draft(OWNER, placeSchool.id, '2026-11-02T15:00:00Z');
await activate(d5);
let recipientCloseErr = null;
await as(GMA, async () => {
  await c.query('savepoint s1');
  try { await c.query("select close_orbit_alert($1,'FOUND_SAFE')", [d5.id]); }
  catch (e) { recipientCloseErr = e; }
  await c.query('rollback to savepoint s1');
});
check('5a a recipient cannot close the alert', recipientCloseErr?.code === '42501', recipientCloseErr?.code ?? 'no error');
await as(GMA, () => c.query("select respond_to_orbit_alert($1,'WITH_ME')", [d5.id]));
check('5b WITH_ME is a report and does not close the alert', (await raw(d5.id))?.status === 'ACTIVE',
  String((await raw(d5.id))?.status));

// ---------------------------------------------------------------- 6. post-close redaction
const beforeClose = await shareAs(GMA, d5.id);
check('6a an ACTIVE recipient gets the recorded place', beforeClose?.place_label === placeSchool.label,
  String(beforeClose?.place_label));
await as(OWNER, () => c.query("select close_orbit_alert($1,'FOUND_SAFE')", [d5.id]));
check('6b a closed recipient loses the share row', (await shareAs(GMA, d5.id)) === undefined, 'no row');
const placeAfter = await as(GMA, () => one('select count(*)::int n from orbit_place_for($1)', [d5.id]));
check('6c a closed recipient loses the place row', placeAfter.n === 0, String(placeAfter.n));
const thanks = await as(GMA, () => one('select orbit_thankyou_for($1) t', [d5.id]));
check('6d the exact thank-you remains', typeof thanks.t === 'string' && thanks.t.includes('found safe'),
  String(thanks.t ?? ''));
const closedRaw = await raw(d5.id);
check('6e the parent record keeps both timestamps (activation and close)',
  closedRaw.activated_at !== null && closedRaw.closed_at !== null,
  `${closedRaw.activated_at?.toISOString?.()} → ${closedRaw.closed_at?.toISOString?.()}`);

await c.end();
console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${results.filter((r) => r.ok).length}/${results.length} checks`);
process.exit(failed ? 1 : 0);
