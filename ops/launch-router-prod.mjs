import { readFileSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';

const KEYS = ['SUPABASE_URL', 'SUPABASE_JWKS_URL'];
const env = { ...process.env };
delete env.APOLLO_KEY;
delete env.APOLLO_GRAPH_REF;
for (const line of readFileSync('/Users/user/Desktop/bentley/fridgegraph/.env', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i <= 0) continue;
  const k = line.slice(0, i);
  if (KEYS.includes(k)) env[k] = line.slice(i + 1).trim();
}
const [supergraph, config, logPath] = process.argv.slice(2);
const out = openSync(logPath, 'a');
const child = spawn('/Users/user/.rover/bin/router-v2.18.0', ['--supergraph', supergraph, '--config', config, '--log', 'error'], {
  env, detached: true, stdio: ['ignore', out, out],
});
child.unref();
console.log(JSON.stringify({ pid: child.pid, supergraph, config }));
