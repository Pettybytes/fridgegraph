// LOCAL ONLY. Run from the main checkout with node --import tsx <this file>.
// No credentials, bearer values, traces, videos, storage states or raw network logs are emitted.
import {createServer as httpServer} from 'node:http'
import {readFile,readdir,lstat} from 'node:fs/promises'
import {realpathSync} from 'node:fs'
import {dirname,resolve,join,relative} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer as viteServer} from 'vite'
const exec=promisify(execFile),webRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=dirname(webRoot),main=process.cwd()
const jwtPrefix=String.fromCharCode(101,121,74)
async function files(root){
 const result=[]
 async function walk(dir){for(const name of await readdir(dir)){
  if(['.git','node_modules','data','.demo-credentials'].includes(name)||name.startsWith('.env'))continue
  const path=join(dir,name),stat=await lstat(path)
  if(stat.isSymbolicLink())continue
  if(stat.isDirectory())await walk(path);else if(stat.isFile())result.push(path)
 }}
 await walk(root);return result
}
const roots=[repo,main],baseline=new Map()
for(const root of roots)for(const path of await files(root)){const bytes=await readFile(path);baseline.set(path,bytes.toString('utf8').split(jwtPrefix).length-1)}
let bearer,server,vite
try {
 const auth=await import(pathToFileURL(join(main,'ops/auth.mjs')).href)
 bearer=await auth.tokenForPersonId('p_mom')
 const {McpToolClient}=await import(pathToFileURL(join(main,'src/muse/mcp.ts')).href)
 const mcp=new McpToolClient('http://127.0.0.1:5051/mcp',bearer)
 await mcp.initialize()
 const result=await mcp.callTool('PickupCandidates',{childId:'p_nora',asOf:'2026-10-30'})
 if(result.isError||!Array.isArray(result.data?.pickupCandidates))throw new Error('Actual pickup read unavailable')
 const actual=result.data.pickupCandidates.map(c=>({id:c.person.id,name:c.person.displayName,authorization:c.authorization,availability:c.availability,vehicleCount:c.person.vehicles?.length??null,reason:c.reason}))
 vite=await viteServer({root:webRoot,configFile:join(webRoot,'vite.config.ts'),server:{host:'127.0.0.1',port:5184,strictPort:true,fs:{allow:[webRoot,realpathSync(join(webRoot,'node_modules'))]}},logLevel:'error'})
 await vite.listen()
 let proof
 server=httpServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5184')
  if(req.headers.origin!=='http://127.0.0.1:5184'){res.writeHead(403).end();return}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204).end();return}
  if(req.url==='/session'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({accessToken:bearer}));return}
  if(req.url==='/actual'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(actual));return}
  if(req.url==='/proof'&&req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const body=Buffer.concat(chunks).toString()
   if(body.includes(bearer.slice(0,12))||body.includes(jwtPrefix)){res.writeHead(400).end();return}
   proof=JSON.parse(body);res.end('ok');return
  }
  res.writeHead(404).end()
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const port=server.address().port
 const run=async args=>{const out=await exec('playwright-cli',['-s=rosina-live',...args],{cwd:repo,maxBuffer:2*1024*1024});if((out.stdout+out.stderr).includes(bearer.slice(0,12)))throw new Error('Sensitive browser output detected');return out.stdout}
 await run(['open',`http://127.0.0.1:5184/scripts/rosina-live-smoke.html?harnessPort=${port}`])
 await run(['run-code','--filename=web/scripts/rosina-live-browser.js'])
 await run(['close'])
 let currentHits=0,newPrefixHits=0,baselineHits=0,scanned=0
 for(const root of roots)for(const path of await files(root)){
  const text=(await readFile(path)).toString('utf8');scanned++
  if(text.includes(bearer.slice(0,12)))currentHits++
  const count=text.split(jwtPrefix).length-1,old=baseline.get(path)??0
  baselineHits+=old;newPrefixHits+=Math.max(0,count-old)
 }
 if(currentHits||newPrefixHits)throw new Error('No-token-on-disk gate failed')
 const receipt=JSON.stringify({passed:proof?.passed===true,actualCandidates:actual,proof,noTokenOnDisk:{currentPrefixHits:currentHits,newGenericPrefixHits:newPrefixHits,unchangedBaselineOccurrences:baselineHits,scannedFiles:scanned}},null,2)
 if(receipt.includes(bearer.slice(0,12))||receipt.includes(jwtPrefix))throw new Error('Unsafe receipt suppressed')
 console.log(receipt)
 if(!proof?.passed)process.exitCode=1
} catch(error) {
 const output=typeof error?.stdout==='string'?error.stdout:''
 const line=output.match(/### Error\n([^\n]*)/)?.[1]
 if(line && !line.includes(jwtPrefix) && (!bearer||!line.includes(bearer.slice(0,12))))console.error('Safe browser check failure: '+line.slice(0,300))
 console.error('Local live smoke did not pass. No credentials or raw network output were printed. Inspect the safe UI/evidence and service metadata; do not dump auth headers.')
 process.exitCode=1
} finally {
 bearer=undefined
 try{await exec('playwright-cli',['-s=rosina-live','close'],{cwd:repo,maxBuffer:1024*1024})}catch{}
 if(server)await new Promise(resolve=>server.close(resolve))
 if(vite)await vite.close()
}
