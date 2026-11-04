import type {Request,Response} from 'express';
import {verifyBearer} from '../auth/verify';
import {dbFor} from '../db';
import {detroitToday} from './localTime';

type Rpc=(bearer:string,name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>;
export function createPinPreferencesHandler(deps={
 verify:verifyBearer,
 rpc:((bearer,name,args)=>dbFor({today:detroitToday(),token:bearer}).rpc(name,args)) as Rpc,
}){
 return async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','no-store');
  const identity=await deps.verify(req.header('authorization'));
  if(!identity.ok){res.status(401).json({error:'UNAUTHENTICATED'});return}
  if(identity.demoGuide){res.status(403).json({error:'UNAUTHORIZED'});return}
  const write=req.method==='POST',body=write?req.body:req.query;
  if(!body||typeof body.childId!=='string'||!body.childId||body.childId.length>120){res.status(400).json({error:'INVALID_REQUEST'});return}
  const bearer=(req.header('authorization')??'').replace(/^Bearer\s+/i,'');
  const args:Record<string,unknown>={p_child:body.childId};
  if(write){
   if(body.tidy!==true&&(!['art','note','goal'].includes(body.kind)||typeof body.itemId!=='string'||!body.itemId||body.itemId.length>120)){
    res.status(400).json({error:'INVALID_REQUEST'});return
   }
   Object.assign(args,{p_kind:body.kind??null,p_item:body.itemId??null,p_position:body.position??null,p_color:body.color??null,p_font:body.font??null,p_tidy:body.tidy===true});
  }
  try{
   const result=await deps.rpc(bearer,write?'save_fridge_preference':'read_fridge_preferences',args);
   if(result.error){const code=result.error.code;res.status(code==='42501'?403:code?.startsWith('22')||code==='23514'?400:503).json({error:code==='42501'?'UNAUTHORIZED':'PREFERENCES_UNAVAILABLE'});return}
   if(!Array.isArray(result.data)){res.status(503).json({error:'PREFERENCES_UNAVAILABLE'});return}
   res.json({items:result.data});
  }catch{res.status(503).json({error:'PREFERENCES_UNAVAILABLE'})}
 };
}
