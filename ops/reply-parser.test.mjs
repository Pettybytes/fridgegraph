/**
 * Unit test for D3's deterministic parser, plus a parity check that the deployed n8n Code node
 * still contains the exact tested source.
 *
 * Run: node --test ops/reply-parser.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseReply, normalizeReplyText } from './reply-parser.mjs'

const cases = [
  // [input, decision, declineReason]
  ['Yes, I can!', 'ACCEPTED', null],
  ['yes', 'ACCEPTED', null],
  ['Yep', 'ACCEPTED', null],
  ['sure thing', 'ACCEPTED', null],
  ['ok', 'ACCEPTED', null],
  ['Okay!', 'ACCEPTED', null],
  ['I can do it', 'ACCEPTED', null],

  ['Sorry, I don\u2019t have a car', 'DECLINED', 'NO_TRANSPORT'],   // curly apostrophe
  ["I don't have a car today", 'DECLINED', 'NO_TRANSPORT'],
  ['no car', 'DECLINED', 'NO_TRANSPORT'],
  ['no ride tomorrow', 'DECLINED', 'NO_TRANSPORT'],
  ["I can't drive", 'DECLINED', 'NO_TRANSPORT'],
  ["I can help but I don't have a car", 'DECLINED', 'NO_TRANSPORT'],

  ['No', 'DECLINED', 'OTHER'],
  ['nope', 'DECLINED', 'OTHER'],
  ["I can't", 'DECLINED', 'OTHER'],
  ['cannot', 'DECLINED', 'OTHER'],
  ["I'm busy right now", 'DECLINED', 'BUSY'],

  // whole words only -- the two traps named in D3
  ['yesterday was rough', 'UNPARSED', null],
  ['nobody told me', 'UNPARSED', null],
  ['maybe later', 'UNPARSED', null],
  ['', 'UNPARSED', null],
  ['what time?', 'UNPARSED', null],
]

for (const [input, decision, reason] of cases) {
  test(`parse ${JSON.stringify(input)} -> ${decision}${reason ? '/' + reason : ''}`, () => {
    const r = parseReply(input)
    assert.equal(r.decision, decision)
    assert.equal(r.declineReason, reason)
  })
}

test('normalisation lowercases, straightens apostrophes, strips punctuation', () => {
  assert.equal(normalizeReplyText('  Sorry, I DON\u2019T  have a car! '), 'sorry i don t have a car')
})

test('transport beats acceptance when both appear', () => {
  const r = parseReply('yes but no car')
  assert.equal(r.decision, 'DECLINED')
  assert.equal(r.declineReason, 'NO_TRANSPORT')
})

test('deployed Code node contains the exact tested parser source', () => {
  const mod = readFileSync(new URL('./reply-parser.mjs', import.meta.url), 'utf8')
  const region = mod.match(/\/\/ #region parser\n([\s\S]*?)\/\/ #endregion parser/)[1].trimEnd()
  const wf = JSON.parse(readFileSync(
    new URL('../docs/n8n/fridgegraph-reply-timeout.workflow.json', import.meta.url), 'utf8'))
  const node = wf.nodes.find((n) => n.id === 'rt-decide-reply')
  const na = wf.nodes.find((n) => n.id === 'rt-decide-noanswer')
  assert.ok(node.parameters.jsCode.includes(region), 'reply Code node is out of sync with the parser')
  assert.ok(na.parameters.jsCode.includes(region), 'no-answer Code node is out of sync with the parser')
})
