import { loadEnv } from './env';
import { startSubgraph, type SubgraphDef } from './server';
import { startDemoLogin } from './demo/server';
import { startPgDiscoverySweeper } from './village/discoverySweeperPg';
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

// The 60 s discovery window needs an owner. Measured 2026-11-02: `close_discovery` had NO production
// caller, so a job whose window elapsed stayed `discovering` forever and no decision was ever written.
// Crash-isolated on purpose: a pool with an error listener (an idle drop must not kill 4008), deps that
// never throw, and a startup that only logs — the demo API must serve whether or not the database is up.
const sweeper = await startPgDiscoverySweeper({ intervalMs: 15_000, batchLimit: 25 });
if (sweeper.started) console.log('[fridgegraph] discovery sweeper started (interval 15s, batch 25)');
