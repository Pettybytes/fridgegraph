import { startSubgraph, type SubgraphDef } from './server';
import village from './subgraphs/village';
import access from './subgraphs/access';
import coordination from './subgraphs/coordination';
import schedule from './subgraphs/schedule';
import school from './subgraphs/school';
import transport from './subgraphs/transport';
import activities from './subgraphs/activities';

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
