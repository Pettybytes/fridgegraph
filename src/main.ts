import { loadEnv } from './env';
import { startSubgraph, type SubgraphDef } from './server';
import { startDemoLogin } from './demo/server';
import village from './subgraphs/village';
import access from './subgraphs/access';
import coordination from './subgraphs/coordination';
import schedule from './subgraphs/schedule';
import school from './subgraphs/school';
import transport from './subgraphs/transport';
import activities from './subgraphs/activities';

loadEnv();

/**
 * One Node process, seven subgraphs, one shared store. Starts the whole federation locally;
 * `rover dev` (see supergraph.yaml) composes them behind the router.
 */
const subgraphs: SubgraphDef[] = [
  { name: 'village', port: 4001, ...village },
  { name: 'access', port: 4002, ...access },
  { name: 'coordination', port: 4003, ...coordination },
  { name: 'schedule', port: 4004, ...schedule },
  { name: 'school', port: 4005, ...school },
  { name: 'transport', port: 4006, ...transport },
  { name: 'activities', port: 4007, ...activities },
];

await Promise.all(subgraphs.map((s) => startSubgraph(s)));
console.log('[fridgegraph] all 7 subgraphs listening on 4001-4007');

// Demo login is a separate, local-only listener. It stays off unless DEMO_LOGIN_ENABLED=1.
await startDemoLogin();

/**
 * The 60 s discovery window needs an owner. Measured 2026-11-02: `close_discovery` had NO production
 * caller, so a job whose window elapsed stayed `discovering` forever and no decision was ever written.
 * This loop asks the database which windows have expired, oldest first, bounded per tick; it keeps no
 * state of its own, so a restart simply resumes asking.
 *
 * DISCOVERY_SWEEPER=off disables it (tests, one-off scripts). No service-role key: the sweeper talks
 * to Postgres directly over SUPABASE_DB_URL, the same way the ops tooling does.
 */
if (process.env.DISCOVERY_SWEEPER !== 'off') {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.log('[fridgegraph] discovery sweeper NOT started — SUPABASE_DB_URL missing');
  } else {
    const { createDiscoverySweeper } = await import('./village/discoverySweeper');
    const { Client } = await import('pg');
    const client = new Client({ connectionString: dbUrl, application_name: 'fg-discovery-sweeper' });
    await client.connect();
    const sweeper = createDiscoverySweeper({
      listExpired: async (limit) => (await client.query(
        `select id from coordination_jobs
          where status = 'discovering'
            and now() >= created_at + make_interval(secs => discovery_timeout_seconds)
          order by created_at
          limit $1`, [limit])).rows.map((r) => String(r.id)),
      close: async (id) => { await client.query('select close_discovery($1)', [id]); },
      log: (m) => console.log(`[sweeper] ${m}`),
    });
    sweeper.start();
    console.log('[fridgegraph] discovery sweeper started (interval 15s, batch 25)');
  }
}
