// Local-only Reset acceptance. The bridge holds bearer/photo handles in process memory only.
import {createServer as httpServer} from 'node:http'
import {readFile,readdir,lstat,mkdir,writeFile} from 'node:fs/promises'
import {realpathSync} from 'node:fs'
import {resolve,dirname,join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer as viteServer} from 'vite'
import {resetWindowOpen} from './live-window.mjs'
const exec=promisify(execFile),web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=dirname(web)
if(!resetWindowOpen(await readFile(resolve(repo,'../fridgegraph/docs/handoff/HANDOFF.md'),'utf8'),{runtime:process.env.RESET_WINDOW_RUNTIME,until:process.env.RESET_WINDOW_UNTIL})){console.error('Deferred: shared stack has an active reservation. No live requests.');process.exit(2)}
const marker=String.fromCharCode(101,121,74),secrets=new Set(),handles=new Set(),baseline=new Map()
async function files(root){const out=[];async function walk(dir){for(const name of await readdir(dir)){if(['.git','node_modules','data','.demo-credentials'].includes(name)||name.startsWith('.env'))continue;const path=join(dir,name),stat=await lstat(path);if(stat.isSymbolicLink())continue;if(stat.isDirectory())await walk(path);else if(stat.isFile())out.push(path)}}await walk(root);return out}
for(const path of await files(repo))baseline.set(path,(await readFile(path)).toString('utf8').split(marker).length-1)
const runName=process.env.RESET_RECEIPT_NAME??'live-results'
if(!/^[a-z0-9-]+$/.test(runName))throw Error('Invalid receipt name')
let vite,bridge,proof,lastStage='Not started',browserOutput=''
function unsafe(raw){return [...secrets].some(s=>raw.includes(s)||raw.includes(s.slice(0,12)))||[...handles].some(s=>raw.includes(s))}
try{
 await mkdir(join(web,'evidence/reset-demo',runName),{recursive:true})
 vite=await viteServer({root:web,configFile:join(web,'vite.config.ts'),logLevel:'silent',server:{host:'127.0.0.1',port:5187,strictPort:true,proxy:{'/graphql':{target:'http://127.0.0.1:4012',changeOrigin:true,rewrite:()=> '/',headers:{'x-demo-date':'2026-10-31','x-demo-now':'2026-10-31T20:05:00Z'}},'/api/rosina':{target:'http://127.0.0.1:4200',changeOrigin:true,headers:{'x-demo-date':'2026-10-31','x-demo-now':'2026-10-31T20:05:00Z'}}},fs:{allow:[web,realpathSync(join(web,'node_modules'))]}}});await vite.listen()
 bridge=httpServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5187')
  if(req.headers.origin!=='http://127.0.0.1:5187'){res.writeHead(403).end();return}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.writeHead(204).end();return}
  if(req.method!=='POST'){res.writeHead(404).end();return}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString(),body=JSON.parse(raw)
  if(req.url==='/hold'){if(typeof body.token==='string')secrets.add(body.token);if(Array.isArray(body.handles))for(const h of body.handles)if(typeof h==='string'&&h.length>12)handles.add(h);res.end('ok');return}
  if(req.url==='/progress'){lastStage=String(body.stage).slice(0,90);console.log('Stage: '+lastStage);res.end('ok');return}
  if(req.url==='/proof'&&!unsafe(raw)&&!raw.includes(marker)){proof=body;res.end('ok');return}
  res.writeHead(400).end()
 });await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve))
 const run=async args=>{const r=await exec('playwright-cli',['-s=reset-live',...args],{cwd:repo,maxBuffer:2*1024*1024});browserOutput+=r.stdout+r.stderr;if(unsafe(browserOutput))throw Error('Private output detected');return r.stdout}
 // The CLI-owned page stays anonymous. Actual sessions live in an independent, unrecorded context.
 await run(['open','http://127.0.0.1:5187/?harnessPort='+bridge.address().port+'&run='+runName])
 const out=await run(['run-code','--filename=web/scripts/'+'reset-live.js'])
 if(out.includes('### Error'))throw Error('Browser assertion failed')
}catch{process.exitCode=1;console.error('Reset smoke incomplete. Raw errors, headers and media handles suppressed.')}
finally{
 try{await exec('playwright-cli',['-s=reset-live','close'],{cwd:repo,maxBuffer:1024*1024})}catch{}
 const results=[]
 for(const path of await files(repo)){const text=(await readFile(path)).toString('utf8'),count=text.split(marker).length-1;const bad=unsafe(text)||count>(baseline.get(path)??0);if(bad||count)results.push({file:relative(repo,path),pass:!bad})}
 const scan={pass:results.every(x=>x.pass)&&!unsafe(browserOutput)&&(!proof?.passed||(secrets.size>=2&&handles.size>0)),files:results}
 const receipt={proof:proof??null,lastStage,scan},safe=JSON.stringify(receipt,null,2)
 if(!scan.pass||!proof?.passed)process.exitCode=1
 if(!unsafe(safe)&&!safe.includes(marker)){await writeFile(join(web,'evidence/reset-demo/'+runName+'.json'),safe+'\n');console.log(safe)}
 secrets.clear();handles.clear();if(bridge)await new Promise(resolve=>bridge.close(resolve));if(vite)await vite.close()
}
