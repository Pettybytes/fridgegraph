// Local only: endpoint sessions in process memory. Never prints response/header/error bodies.
import {createServer as httpServer} from 'node:http'
import {readFile,readdir,lstat,mkdir,writeFile} from 'node:fs/promises'
import {realpathSync} from 'node:fs'
import {resolve,dirname,join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer as viteServer} from 'vite'
const exec=promisify(execFile),web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=dirname(web)
const visual=process.env.DEMO_SMOKE_VISUAL_ONLY==='1',jobBoundary=process.env.DEMO_SMOKE_JOB_BOUNDARY_ONLY==='1'
const prefix=String.fromCharCode(101,121,74),tokens=new Set(),baseline=new Map()
async function files(root){const result=[];async function walk(dir){for(const name of await readdir(dir)){
 if(['.git','node_modules','data','.demo-credentials'].includes(name)||name.startsWith('.env'))continue
 const path=join(dir,name),stat=await lstat(path);if(stat.isSymbolicLink())continue
 if(stat.isDirectory())await walk(path);else if(stat.isFile())result.push(path)
 }}await walk(root);return result}
for(const path of await files(repo)){const bytes=await readFile(path);baseline.set(path,bytes.toString('utf8').split(prefix).length-1)}
let vite,server,proof,lastStage
try{
 await mkdir(join(web,'evidence/demo-login'),{recursive:true})
 vite=await viteServer({root:web,configFile:join(web,'vite.config.ts'),logLevel:'silent',server:{host:'127.0.0.1',port:5185,strictPort:true,fs:{allow:[web,realpathSync(join(web,'node_modules'))]}}});await vite.listen()
 server=httpServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5185')
  if(req.headers.origin!=='http://127.0.0.1:5185'){res.writeHead(403).end();return}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.writeHead(204).end();return}
  if(req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString()
   if(req.url==='/progress'){lastStage=JSON.parse(raw).stage;console.log('Stage: '+String(lastStage).slice(0,80));res.end('ok');return}
   if(req.url==='/hold'){const body=JSON.parse(raw);if(typeof body.value==='string')tokens.add(body.value);res.end('ok');return}
   if(req.url==='/proof'){if([...tokens].some(t=>raw.includes(t.slice(0,12)))||raw.includes(prefix)){res.writeHead(400).end();return}proof=JSON.parse(raw);res.end('ok');return}
  }res.writeHead(404).end()
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const port=server.address().port
 const run=async args=>{const result=await exec('playwright-cli',['-s=demo-login',...args],{cwd:repo,maxBuffer:2*1024*1024});if([...tokens].some(t=>(result.stdout+result.stderr).includes(t.slice(0,12))))throw Error('Unsafe CLI output');return result.stdout}
 await run(['open',`http://127.0.0.1:5185/?harnessPort=${port}`])
 const output=await run(['run-code','--filename=web/scripts/'+(visual?'demo-login-visual.js':jobBoundary?'demo-login-job-boundary.js':'demo-login-browser.js')])
 if(output.includes('### Error')){const line=output.match(/### Error\n([^\n]*)/)?.[1]??'Browser assertion failed';if(!line.includes(prefix)&&![...tokens].some(t=>line.includes(t.slice(0,12))))console.error(line.slice(0,240));throw Error('Browser assertion failed')}
 await run(['close'])
}catch(error){const output=typeof error?.stdout==='string'?error.stdout:'';const line=output.match(/### Error\n([^\n]*)/)?.[1];if(line&&!line.includes(prefix)&&![...tokens].some(t=>line.includes(t.slice(0,12))))console.error('Safe check failure: '+line.slice(0,260));process.exitCode=1;console.error('Local browser smoke incomplete. Raw errors and network output suppressed.')}
finally{
 try{await exec('playwright-cli',['-s=demo-login','close'],{cwd:repo,maxBuffer:1024*1024})}catch{}
 const findings=[],generic=[],newGeneric=[];let scanned=0
 for(const path of await files(repo)){
  const text=(await readFile(path)).toString('utf8');scanned++
  if([...tokens].some(t=>text.includes(t)||text.includes(t.slice(0,12))))findings.push(relative(repo,path))
  const count=text.split(prefix).length-1;if(count)generic.push(relative(repo,path));if(count>(baseline.get(path)??0))newGeneric.push(relative(repo,path))
 }
 const scan={pass:findings.length===0&&newGeneric.length===0,scanned,heldSessions:tokens.size,tokenFindings:findings,genericFilesToInspect:generic,newGenericFiles:newGeneric,coverage:'working tree including web/evidence, test-results and .playwright-cli; skips protected credentials, data, dependencies, symlinks and .git'}
 const receipt={proof:proof??null,lastStage,scan};const safe=JSON.stringify(receipt,null,2)
 if(!scan.pass||!proof?.passed)process.exitCode=1
 if(![...tokens].some(t=>safe.includes(t.slice(0,12)))&&!safe.includes(prefix)){
  await writeFile(join(web,'evidence/demo-login/'+(visual?'visual-results.json':jobBoundary?'job-boundary-results.json':'results.json')),safe+'\n');console.log(safe)
 }
 tokens.clear();if(server)await new Promise(resolve=>server.close(resolve));if(vite)await vite.close()
}
