/**
 * requireGraphqlUrl: the notice-plan GraphQL router URL has NO default and NEVER derives from the
 * MCP URL. Regression guard for the deploy incident where an unset ROSINA_GRAPHQL_URL silently fell
 * back to the MCP port (5051/graphql → 404) and every notice request failed closed with 502.
 * Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireGraphqlUrl } from './noticeDeps';

test('returns ROSINA_GRAPHQL_URL when set', () => {
  assert.equal(requireGraphqlUrl({ ROSINA_GRAPHQL_URL: 'http://127.0.0.1:4012/' }), 'http://127.0.0.1:4012/');
});

test('throws when ROSINA_GRAPHQL_URL is unset — no default', () => {
  assert.throws(() => requireGraphqlUrl({}), /ROSINA_GRAPHQL_URL is required/);
});

test('throws on whitespace-only', () => {
  assert.throws(() => requireGraphqlUrl({ ROSINA_GRAPHQL_URL: '   ' }), /ROSINA_GRAPHQL_URL is required/);
});

test('the default is NOT derived from the MCP URL (the old bug)', () => {
  // With only the MCP URL present, it must still throw — never return an MCP-derived /graphql URL.
  const env = { ROSINA_MCP_URL: 'http://127.0.0.1:5051/mcp' };
  assert.throws(() => requireGraphqlUrl(env), /NOT the MCP URL/);
  let resolved = '';
  try { resolved = requireGraphqlUrl(env); } catch { /* expected */ }
  assert.equal(resolved, '', 'must not resolve to any value from ROSINA_MCP_URL');
  assert.notEqual(resolved, 'http://127.0.0.1:5051/graphql');
});
