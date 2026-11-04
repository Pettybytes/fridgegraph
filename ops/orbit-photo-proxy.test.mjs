import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s.address().port)));
test('served upload endpoint reaches Orbit and keeps unlisted API paths closed',async()=>{
 const received=[];
 const upstream=createServer((req,res)=>{received.push({method:req.method,url:req.url});res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"UNAUTHENTICATED"}');});
 const upstreamPort=await listen(upstream);
 const reservation=createServer();const port=await listen(reservation);await new Promise(r=>reservation.close(r));
 const root=mkdtempSync(join(tmpdir(),'orbit-proxy-'));writeFileSync(join(root,'index.html'),'fixture');
 const server=spawn(process.execPath,['ops/serve-web.mjs'],{env:{...process.env,PORT:String(port),ORBIT_API_PORT:String(upstreamPort),WEB_ROOT:root},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('proxy start timeout')),5000);server.stdout.on('data',d=>{if(String(d).includes('listening on 127.0.0.1')){clearTimeout(timer);resolve();}});server.on('exit',()=>reject(Error('proxy exited')));});
  const base=`http://127.0.0.1:${port}`;
  const upload=await fetch(base+'/api/orbit/photo?childId=p_malik',{method:'POST',body:new Uint8Array([1]),headers:{'Content-Type':'image/jpeg'}});
  assert.equal(upload.status,401);assert.deepEqual(await upload.json(),{error:'UNAUTHENTICATED'});
  assert.deepEqual(received,[{method:'POST',url:'/api/orbit/photo?childId=p_malik'}]);
  for(const path of ['/api/orbit','/api/orbit/photos','/api/orbit/photo-admin'])assert.equal((await fetch(base+path)).status,404);
 }finally{server.kill();await new Promise(r=>upstream.close(r));rmSync(root,{recursive:true,force:true});}
});
