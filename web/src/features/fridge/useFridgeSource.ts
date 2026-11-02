import {useCallback,useEffect,useRef,useState} from 'react'
import type {FridgeReader,Goal,Read,Slot,Source} from './model'

/** Each authorized source owns its request generation and explicit retry. */
export function useFridgeSource(reader:FridgeReader,childId:string,source:Source){
 const [state,setState]=useState<Read<Slot[]|Goal[]>>({status:'loading'})
 const request=useRef<AbortController|null>(null)
 const sequence=useRef(0)
 const refresh=useCallback(()=>{
  request.current?.abort()
  const controller=new AbortController(),version=++sequence.current
  request.current=controller
  setState({status:'loading'})
  void reader.read(source,childId,controller.signal).then(
   next=>{if(!controller.signal.aborted&&version===sequence.current)setState(next)},
   ()=>{if(!controller.signal.aborted&&version===sequence.current)setState({status:'failed'})},
  )
 },[reader,childId,source])
 useEffect(()=>{
  refresh()
  return()=>{sequence.current++;request.current?.abort()}
 },[reader,source,refresh])
 return {state,refresh}
}
