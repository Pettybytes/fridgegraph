/**
 * One real call to the live Rosina service, as a named demo person.
 *
 *   node ops/rosina-probe.mjs --person p_mom --message "Who should I ask to pick up Nora today?"
 *     [--route '#/mission-control'] [--history '[{"role":"user","content":"..."}]']
 *     [--url http://127.0.0.1:4200/api/rosina] [--no-token]
 *
 * Never prints the token. Used for docs/evidence/34-rosina-service.md transcripts.
 */
import { redactBearer, tokenForPersonId } from './auth.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const person = arg('person', 'p_mom');
const message = arg('message', 'What can I do here?');
const route = arg('route', '#/mission-control');
const history = JSON.parse(arg('history', '[]'));
const url = arg('url', 'http://127.0.0.1:4200/api/rosina');
const noToken = process.argv.includes('--no-token');

const bearer = noToken ? null : await tokenForPersonId(person);
console.log(`person: ${person}  identity: ${noToken ? '(none sent)' : redactBearer(bearer)}`);
console.log(`message: ${message}`);

const started = Date.now();
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify({ message, currentRoute: route, history }),
});
const text = await res.text();
console.log(`status: ${res.status}  latencyMs: ${Date.now() - started}`);
console.log(text);
