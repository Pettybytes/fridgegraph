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
