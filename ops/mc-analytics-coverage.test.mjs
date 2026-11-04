import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const probe = new URL('./mc-analytics-coverage.mjs', import.meta.url).href;
function runMockLogin(response, onlyKendra = true) {
  const script = `
    process.argv = [process.execPath, 'coverage-test', '--live', '--origin=http://127.0.0.1:9'${onlyKendra ? ", '--persona=kendra'" : ''}];
    globalThis.fetch = async () => { ${response} };
    await import(${JSON.stringify(probe)});
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
}

for (const [name, response, expected] of [
  ['HTML 502', "return new Response('<html>Bad gateway</html>', {status:502});", 'failed'],
  ['JSON 401', 'return Response.json({error:"UNAUTHENTICATED"}, {status:401});', 'refused'],
  ['READY body on HTTP 403', 'return Response.json({status:"READY"}, {status:403});', 'refused'],
  ['transport failure', 'throw new Error("offline test transport");', 'failed'],
  ['malformed successful response', 'return new Response("not JSON", {status:200});', 'failed'],
  ['READY without a session', 'return Response.json({status:"READY"}, {status:200});', 'failed'],
]) {
  test(`preserves a sanitized ${expected} login result for ${name}`, () => {
    const report = runMockLogin(response);
    assert.equal(report.live[0].persona, 'kendra');
    assert.equal(report.live[0].login, expected);
    assert.equal(report.live[0].children, undefined);
    assert.deepEqual(report.live[0].contexts, {});
  });
}

test('a failed login does not omit the remaining parent and guardian tenants', () => {
  const report = runMockLogin('return new Response("Bad gateway", {status:502});', false);
  assert.equal(report.live.length, 8);
  assert.ok(report.live.every(row => row.login === 'failed'));
});
