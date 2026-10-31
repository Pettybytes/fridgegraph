import {test} from 'node:test'
import assert from 'node:assert/strict'
import {hasActiveTestWindow} from './live-window.mjs'
const table='| when | what | checkout | ports | restored |\n|---|---|---|---|---|\n'
test('an active reservation defers live work, even after earlier restored rows',()=>{
 assert.equal(hasActiveTestWindow(table+'| earlier | reset | main | 4012 | **restored, 55 values** |\n| now | **Group 4 window reserved** | group4 | 4012 | in progress |'),true)
})
test('only explicit restoration releases a reserved operations row',()=>{
 for(const status of ['pending','not restored','unknown',''])assert.equal(hasActiveTestWindow(table+`| now | reset | main | 4012 | ${status} |`),true)
 for(const status of ['**restored**','yes — back on checkout','complete','released'])assert.equal(hasActiveTestWindow(table+`| now | reset | main | 4012 | ${status} |`),false)
})
test('historical prose and other task tables do not become active windows',()=>{
 assert.equal(hasActiveTestWindow('A reset was restored.\n| task | state |\n| group4 | in progress |'),false)
})
import {orbitWindowOpen} from './live-window.mjs'
const now=Date.parse('2026-10-31T05:21:00Z'),own={runtime:'8504f4d',until:'2026-10-31T06:05:00Z',now}
const open='## Stack reservations\n'+table+'| 05:20 | **W-ORBIT window OPEN** | composed `8504f4d` | 4200 | **OPEN to W-ORBIT until 02:05 EDT** |'
test('Orbit may use its explicitly open named-runtime window; generic callers still defer',()=>{assert.equal(hasActiveTestWindow(open),true);assert.equal(orbitWindowOpen(open,own),true);assert.equal(orbitWindowOpen(open.replaceAll('OPEN','REOPENED'),own),true)})
test('Orbit cannot use a reserved/unrestored, foreign, superseded or mismatched runtime window',()=>{
 for(const text of [open.replace('window OPEN','window RESERVED'),open.replaceAll('W-ORBIT','Group 5'),open+'\n| later | Group 5 reserved | main | 4200 | in progress |',open.replace('8504f4d','abcdef1')])assert.equal(orbitWindowOpen(text,own),false)
})
test('Orbit cannot run after expiry, with an invalid deadline or beyond the confirmed 45-minute budget',()=>{
 for(const until of ['2026-10-31T05:20:00Z','invalid','2026-10-31T07:00:00Z'])assert.equal(orbitWindowOpen(open,{...own,until}),false)
})
