export {};

/**
 * `npm run reset` — restores the in-memory store to the fixtures without restarting or editing
 * anything. The store lives in the running process, so this calls that process' control endpoint.
 */
const url = process.env.FRIDGEGRAPH_RESET_URL ?? 'http://127.0.0.1:4001/__reset';

const res = await fetch(url, { method: 'POST' });
if (!res.ok) {
  console.error(`[reset] failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log('[reset] store restored to fixtures:', await res.text());
