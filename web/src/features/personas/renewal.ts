export function isReadAuthenticationFailure(error:unknown):boolean{
 const value=error as {statusCode?:number;status?:number;message?:string;errors?:{extensions?:{code?:string}}[]}
 return value?.statusCode===401||value?.status===401||!!value?.errors?.some(e=>['UNAUTHENTICATED','AUTH_ERROR'].includes(e.extensions?.code??''))||/UNAUTHENTICATED|AUTH_ERROR/.test(value?.message??'')
}
export async function retryReadOnce<T>(kind:'query'|'mutation'|'message',read:()=>Promise<T>,renew:()=>Promise<unknown>,current:()=>boolean):Promise<T>{
 try{const value=await read();if(!current())throw new Error('SESSION_CHANGED');return value}
 catch(error){
  if(kind!=='query'||!current()||!isReadAuthenticationFailure(error))throw error
  const renewed=await renew();if(!renewed||!current())throw error
  const value=await read();if(!current())throw new Error('SESSION_CHANGED');return value
 }
}
