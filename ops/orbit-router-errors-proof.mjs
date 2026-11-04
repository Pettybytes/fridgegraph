// Real Router, local stub only: typed codes survive, SQL details and stacks do not.
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const stub=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,errors:[{message:'private database detail',extensions:{code:'ORBIT_NO_AUDIENCE',stacktrace:['private stack'],details:'private row'}}]}));});
const upstream=await listen(stub),reservation=createServer(),port=await listen(reservation);await new Promise(r=>reservation.close(r));
const dir=mkdtempSync(join(tmpdir(),'orbit-router-')),schema=join(dir,'supergraph.graphql'),config=join(dir,'router.yaml');
let router;
try{
 execFileSync(process.execPath,['ops/compose-offline.mjs','--out',schema,'--base-port','45000'],{stdio:'pipe'});
 writeFileSync(schema,readFileSync(schema,'utf8').replace(/http:\/\/127\.0\.0\.1:4500[0-6]\//g,`http://127.0.0.1:${upstream}/`));
 writeFileSync(config,readFileSync('router.prod.yaml','utf8').replace('127.0.0.1:4010',`127.0.0.1:${port}`).replace('enabled: true','enabled: false'));
 const binary=process.env.ROUTER_BIN??join(homedir(),'.rover/bin/router-v2.18.0');
 router=spawn(binary,['--supergraph',schema,'--config',config,'--log','error'],{stdio:'ignore'});
 const post=async query=>{const r=await fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});return r.json()};
 let ready=false;for(let i=0;i<100;i++){try{await post('{__typename}');ready=true;break}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,'router ready');
 const result=await post('mutation OrbitCodeProbe { orbitActivate(draftId:"fixture",draftVersion:1,messageHash:"fixture"){id} }');
 assert.equal(result.errors[0].extensions.code,'ORBIT_NO_AUDIENCE');assert.ok(!JSON.stringify(result).includes('private'));
 const other=await post('query OtherErrorProbe {goals(childId:"fixture"){id}}');
 assert.ok(!JSON.stringify(other).includes('ORBIT_NO_AUDIENCE'));assert.ok(!JSON.stringify(other).includes('private'));
 console.log('PASS: production Router preserves coordination code only; messages, stacks, details and other subgraph codes stay redacted');
}finally{router?.kill();await new Promise(r=>stub.close(r));rmSync(dir,{recursive:true,force:true});}
