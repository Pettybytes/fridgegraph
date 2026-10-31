import {test} from 'node:test'
import assert from 'node:assert/strict'
import {resetWindowOpen} from './live-window.mjs'
const now=Date.parse('2026-10-31T09:00:00Z'),until='2026-10-31T09:30:00Z',runtime='dd84886'
const row=(owner='W-RESET',state='OPEN')=>`## Stack reservations\n| Time | Work | Runtime | Ports | Restored |\n| -- | -- | -- | -- | -- |\n| now | ${owner} window ${state} | \`${runtime}\` | 4008 | ${state} to ${owner} until 09:30 |`
test('reset requires its restored open reservation and a current bounded deadline',()=>{
 assert.equal(resetWindowOpen(row(),{runtime,until,now}),true)
 for(const text of [row('W-ORBIT'),row('W-RESET','RESERVED'),row()+'\n| later | Other window | `fffffff` | 4008 | reserved |'])assert.equal(resetWindowOpen(text,{runtime,until,now}),false)
 for(const args of [{runtime:'aaaaaaa',until,now},{runtime,until,now:now+3600000},{runtime,until:'2026-10-31T10:30:00Z',now}])assert.equal(resetWindowOpen(row(),args),false)
})
