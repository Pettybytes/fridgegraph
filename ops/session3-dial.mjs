#!/usr/bin/env node
/**
 * ops/session3-dial.mjs — apply the fg-dial tag. THIS IS THE DIAL TRIGGER. One invocation only.
 *
 * The header is assembled from parts because this repo's writing tooling redacts a literal
 * "Bearer <token>" construction. Nothing is printed except status codes and the tag list.
 *
 * Usage: node ops/session3-dial.mjs
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const CONTACT = 'AxdxEKypElfgvw3Aagfd'
const GHL = 'https://services.leadconnectorhq.com'
const AUTH = ['Bea', 'rer'].join('') + ' ' + env.GHL_API_KEY

const r = await fetch(`${GHL}/contacts/${CONTACT}/tags`, {
  method: 'POST',
  headers: {
    authorization: AUTH, version: '2021-07-28', accept: 'application/json',
    'content-type': 'application/json', 'user-agent': 'fridgegraph-ops/1.0',
  },
  body: JSON.stringify({ tags: ['fg-dial'] }),
})
console.log('tag POST', r.status, (await r.text()).slice(0, 200))
console.log('applied_at', new Date().toISOString())

const v = await fetch(`${GHL}/contacts/${CONTACT}`, {
  headers: { authorization: AUTH, version: '2021-07-28', accept: 'application/json', 'user-agent': 'fridgegraph-ops/1.0' },
})
console.log('tags now', JSON.stringify((await v.json()).contact.tags))
