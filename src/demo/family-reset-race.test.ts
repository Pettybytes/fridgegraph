import {test} from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import {activateCreatedFamily} from './family';
test('a reset-deleted pending marker prevents late family activation and commit',async()=>{
 const fake={query:async()=>({rowCount:0})}as unknown as pg.Client;
 await assert.rejects(activateCreatedFamily(fake,'family-test','test-only-sub'),{code:'FAMILY_RESET_IN_PROGRESS',status:409});
});
test('exactly one existing pending marker may activate',async()=>{
 const fake={query:async()=>({rowCount:1})}as unknown as pg.Client;
 await activateCreatedFamily(fake,'family-test','test-only-sub');
});
