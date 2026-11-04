import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoProxyAllowed,resetStatusMethodAllowed} from './demo-proxy-routes.mjs';
const path='/api/demo/reset/dc880956-a6db-413e-85dc-d912b3ebd76b';
test('the exact UUID status read reaches demo upstream while other API paths stay closed',()=>{
 assert.equal(demoProxyAllowed(path),true);
 for(const p of ['/api/demo/reset/not-a-run',path+'/extra',path+'%2fextra','/api/demo/other','/api/demo/reset/'])assert.equal(demoProxyAllowed(p),false);
 for(const p of ['/api/demo/login','/api/demo/health','/api/demo/reset'])assert.equal(demoProxyAllowed(p),true);
});
test('the new status path permits only GET and never forwards a mutation method',()=>{
 assert.equal(resetStatusMethodAllowed(path,'GET'),true);
 for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])assert.equal(resetStatusMethodAllowed(path,method),false);
 assert.equal(resetStatusMethodAllowed('/api/demo/reset','POST'),true);
});
