// Local-only signature Village/Orbit acceptance. The bridge holds bearer/photo handles in process memory only.
import {createServer as httpServer} from 'node:http'
import {readFile,readdir,lstat,mkdir,writeFile,access} from 'node:fs/promises'
import {realpathSync} from 'node:fs'
import {resolve,dirname,join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer as viteServer} from 'vite'
import {signatureWindowOpen} from './live-window.mjs'
const exec=promisify(execFile),web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=dirname(web)
if(!signatureWindowOpen(await readFile(resolve(repo,'../fridgegraph/docs/handoff/HANDOFF.md'),'utf8'),{runtime:process.env.SIGNATURE_WINDOW_RUNTIME,until:process.env.SIGNATURE_WINDOW_UNTIL})){console.error('Deferred: shared stack has an active reservation. No live requests.');process.exit(2)}
const marker=String.fromCharCode(101,121,74),secrets=new Set(),handles=new Set(),baseline=new Map()
async function files(root){const out=[];async function walk(dir){for(const name of await readdir(dir)){if(['.git','node_modules','data','.demo-credentials'].includes(name)||name.startsWith('.env'))continue;const path=join(dir,name),stat=await lstat(path);if(stat.isSymbolicLink())continue;if(stat.isDirectory())await walk(path);else if(stat.isFile())out.push(path)}}await walk(root);return out}
for(const path of await files(repo))baseline.set(path,(await readFile(path)).toString('utf8').split(marker).length-1)
const runName=process.env.SIGNATURE_RECEIPT_NAME??'live-results'
if(!/^[a-z0-9-]+$/.test(runName))throw Error('Invalid receipt name')
let vite,bridge,proof,lastStage='Not started',browserOutput=''
function unsafe(raw){return [...secrets].some(s=>raw.includes(s)||raw.includes(s.slice(0,12)))||[...handles].some(s=>raw.includes(s))}
try{
 await mkdir(join(web,'evidence/signature'),{recursive:true});await mkdir(join(web,'evidence/signature',runName))

 bridge=httpServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5189')
  if(req.headers.origin!=='http://127.0.0.1:5189'){res.writeHead(403).end();return}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.writeHead(204).end();return}
  if(req.method!=='POST'){res.writeHead(404).end();return}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString(),body=JSON.parse(raw)
  if(req.url==='/hold'){if(typeof body.token==='string')secrets.add(body.token);if(Array.isArray(body.handles))for(const h of body.handles)if(typeof h==='string'&&h.length>12)handles.add(h);res.end('ok');return}
  if(req.url==='/progress'){lastStage=String(body.stage).slice(0,90);console.log('Stage: '+lastStage);res.end('ok');return}
  if(req.url==='/proof'&&!unsafe(raw)&&!raw.includes(marker)){proof=body;res.end('ok');return}
  res.writeHead(400).end()
 });await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve))
 const run=async args=>{const r=await exec('playwright-cli',['-s=signature-live',...args],{cwd:repo,maxBuffer:2*1024*1024});browserOutput+=r.stdout+r.stderr;if(unsafe(browserOutput))throw Error('Private output detected');return r.stdout}
 // The CLI-owned page stays anonymous. Only the independent viewport is recorded by explicit request.
 await run(['open','http://127.0.0.1:5189/?harnessPort='+bridge.address().port+'&run='+runName])
 const browserScript='signature-window-orbit.js'
 const out=await run(['run-code','--filename=web/scripts/'+browserScript])
 if(out.includes('### Error'))throw Error('Browser assertion failed')
 if(Array.isArray(proof?.captures)){
  for(const capture of proof.captures){
   const source=capture.file,dest=join(web,'evidence/signature',runName,capture.name+'.mp4')
   if(typeof source!=='string'||!source.startsWith('/tmp/fridgegraph-signature-')||!Number.isFinite(capture.from)||!Number.isFinite(capture.to)||capture.to<=capture.from||!/^[a-z-]+$/.test(capture.name))throw Error('Invalid capture range')
   await exec('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(capture.from),'-i',source,'-t',String(capture.to-capture.from),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-preset','fast','-crf','20','-an','-movflags','+faststart',dest],{maxBuffer:1024*1024})
   await access(dest);capture.file=relative(repo,dest);delete capture.page
  }
 }

}catch{process.exitCode=1;console.error('Signature smoke incomplete. Raw errors, headers and media handles suppressed.')}
finally{
 try{await exec('playwright-cli',['-s=signature-live','close'],{cwd:repo,maxBuffer:1024*1024})}catch{}
 const results=[]
 for(const path of await files(repo)){const text=(await readFile(path)).toString('utf8'),count=text.split(marker).length-1;const binary=/\.(png|jpe?g|webm|mp4)$/i.test(path),newMarker=count>(baseline.get(path)??0),structured=/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}/.test(text);const bad=unsafe(text)||(newMarker&&(!binary||structured));if(bad||count)results.push({file:relative(repo,path),pass:!bad,...(newMarker&&binary&&!structured?{inspection:'Incidental compressed-media marker; no JWT structure. Actual observed token/media values still checked.'}:{})})}
 const scan={pass:results.every(x=>x.pass)&&!unsafe(browserOutput)&&(!proof?.passed||(secrets.size>=2)),files:results,privateMediaObserved:handles.size>0}
 const receipt={proof:proof??null,lastStage,scan},safe=JSON.stringify(receipt,null,2)
 if(!scan.pass||!proof?.passed)process.exitCode=1
 if(!unsafe(safe)&&!safe.includes(marker)){await writeFile(join(web,'evidence/signature/'+runName+'.json'),safe+'\n');console.log(safe)}
 secrets.clear();handles.clear();if(bridge)await new Promise(resolve=>bridge.close(resolve));if(vite)await vite.close()
}
