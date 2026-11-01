import {test} from 'node:test'
import assert from 'node:assert/strict'
import {signatureWindowOpen} from './live-window.mjs'
test('signature refuses another owner, unconfirmed restoration, expired deadlines and a later reservation',()=>{
 const now=Date.parse('2026-10-31T23:00:00Z'),until='2026-10-31T23:40:00Z',runtime='abcdef0'
 const row=(owner='W-UI',status='OPEN')=>`## Stack reservations\n| Time | Work | Runtime | Ports | Restored |\n| now | ${owner} window ${status} — RESTORED | \`${runtime}\` | 4008 | ${status} to ${owner} until ${until} |`
 assert.equal(signatureWindowOpen(row(),{runtime,until,now}),true)
 for(const text of [row('W-RESET'),row('W-UI','RESERVED'),row().replace('RESTORED','NOT listening; BLOCKED'),row().replace('RESTORED','awaiting restoration'),row()+'\n| later | Something else | `fffffff` | 4008 | reserved |'])assert.equal(signatureWindowOpen(text,{runtime,until,now}),false)
 assert.equal(signatureWindowOpen(row(),{runtime,until,now:now+3600000}),false)
 assert.equal(signatureWindowOpen(row(),{runtime:'fffffff',until,now}),false)
})
