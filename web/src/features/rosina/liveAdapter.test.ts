import {expect,it,vi} from 'vitest'
import {createLiveRosinaAdapter,LIVE_FALLBACK} from './liveAdapter'
const input={message:'Who can pick up Nora?',currentRoute:'#/mission-control',history:[]}
const ok=()=>new Response(JSON.stringify({reply:'Live result',actions:[]}),{status:200})
it('reads the current bearer per request, without probing readiness or adding session metadata',async()=>{
 let token='fictional-first',generation=1
 const request=vi.fn<typeof fetch>().mockImplementation(async()=>ok())
 const service=createLiveRosinaAdapter(()=>token,{request,getGeneration:()=>generation})
 expect(request).not.toHaveBeenCalled()
 await service.send(input);token='fictional-second';generation++
 await service.send(input)
 expect(request).toHaveBeenCalledTimes(2)
 expect(request.mock.calls.map(c=>(c[1]?.headers as Record<string,string>).Authorization)).toEqual(['Bearer fictional-first','Bearer fictional-second'])
 expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual(input)
})
it('discards a late success after a session generation changes even if fetch ignores cancellation',async()=>{
 let generation=1,resolve!:(response:Response)=>void
 const request=vi.fn<typeof fetch>(()=>new Promise(r=>{resolve=r}))
 const service=createLiveRosinaAdapter(()=> 'fictional-session',{request,getGeneration:()=>generation})
 const result=service.send(input);await Promise.resolve();generation++;resolve(ok())
 await expect(result).rejects.toMatchObject({name:'AbortError'})
})
it('external cancellation is silent cancellation, not the fallback, even if fetch never settles',async()=>{
 const controller=new AbortController()
 const service=createLiveRosinaAdapter(()=> 'fictional-session',{request:()=>new Promise(()=>{})})
 const result=service.send(input,controller.signal);controller.abort()
 await expect(result).rejects.toMatchObject({name:'AbortError'})
})
it.each([[401,'Please sign in again'],[429,'Give me a moment'],[500,LIVE_FALLBACK],[503,LIVE_FALLBACK]])('maps HTTP %s once with no retry',async(status,reply)=>{
 const request=vi.fn<typeof fetch>(async()=>new Response('raw backend error',{status:Number(status)}))
 const result=await createLiveRosinaAdapter(()=> 'fictional-session',{request}).send(input)
 expect(result.reply).toBe(reply);expect(result.actions).toEqual([]);expect(request).toHaveBeenCalledTimes(1)
})
it('handles network failure and malformed responses without raw errors or mock answers',async()=>{
 for(const request of [vi.fn<typeof fetch>(async()=>{throw new Error('private upstream stack')}),vi.fn<typeof fetch>(async()=>new Response('{bad json',{status:200}))]){
  expect(await createLiveRosinaAdapter(()=> 'fictional-session',{request}).send(input)).toEqual({reply:LIVE_FALLBACK,actions:[]})
 }
})
it('times out even if cancellation is ignored, while a server timeout reply passes through as text',async()=>{
 vi.useFakeTimers()
 const service=createLiveRosinaAdapter(()=> 'fictional-session',{timeoutMs:100,request:()=>new Promise(()=>{})})
 const result=service.send(input);await vi.advanceTimersByTimeAsync(100)
 expect(await result).toEqual({reply:LIVE_FALLBACK,actions:[]});vi.useRealTimers()
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({reply:"I couldn't check that just now.",actions:[]}),{status:200}))
 expect((await createLiveRosinaAdapter(()=> 'fictional-session',{request}).send(input)).reply).toBe("I couldn't check that just now.")
})
it('does not short-circuit care questions or let history exceed the service limit',async()=>{
 const request=vi.fn<typeof fetch>(async()=>ok())
 await createLiveRosinaAdapter(()=> 'fictional-session',{request}).send({...input,message:'Can Nora have a snack?',history:Array.from({length:42},(_,i)=>({role:'user' as const,content:String(i)}))})
 const body=JSON.parse(String(request.mock.calls[0][1]?.body));expect(body.message).toBe('Can Nora have a snack?');expect(body.history).toHaveLength(40);expect(body.history[0].content).toBe('2')
})
