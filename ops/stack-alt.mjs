/**
 * Alternate-port subgraph stack, for running the evidence suite in a chosen DEMO_CLOCK mode
 * without restarting (or disturbing) the long-running stack on 4001-4007.
 *
 * Same seven subgraphs, same code path (src/server.ts), ports 4101-4107.
 * This script only starts the subgraphs. Use ops/alt-stack.sh for the whole stack:
 *   ops/alt-stack.sh --up | --check | --down
 * which generates the router (4012) and MCP (5051) configs from router.yaml,
 * supergraph.yaml and .apollo/mcp.local.yaml, and preflights the runtime files whose
 * absence fails silently (data/identity-map.json in particular).
 *
 *   DEMO_CLOCK=1 npx tsx ops/stack-alt.mjs
 */
import { loadEnv } from '../src/env.ts';
import { startSubgraph } from '../src/server.ts';
import village from '../src/subgraphs/village.ts';
import access from '../src/subgraphs/access.ts';
import coordination from '../src/subgraphs/coordination.ts';
import schedule from '../src/subgraphs/schedule.ts';
import school from '../src/subgraphs/school.ts';
import transport from '../src/subgraphs/transport.ts';
import activities from '../src/subgraphs/activities.ts';

loadEnv();

const base = Number(process.env.ALT_PORT_BASE ?? 4101);

const defs = [
  { name: 'village', ...village },
  { name: 'access', ...access },
  { name: 'coordination', ...coordination },
  { name: 'schedule', ...schedule },
  { name: 'school', ...school },
  { name: 'transport', ...transport },
  { name: 'activities', ...activities },
];

await Promise.all(defs.map((def, index) => startSubgraph({ ...def, port: base + index })));

console.log(`[alt-stack] 7 subgraphs on ${base}-${base + 6} DEMO_CLOCK=${process.env.DEMO_CLOCK ?? '0'}`);
