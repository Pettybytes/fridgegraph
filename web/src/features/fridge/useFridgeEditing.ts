import { useEffect, useRef, useState } from 'react'
import type { FridgeEditingAdapter, FridgeNoteRecord, FridgeViewer, GoalFields, GoalRecord, NoteAudience, NoteFields } from './editingContract'
import {latestCaptions} from './captions'
import {useFridgePreferences} from './preferences'
import type {MarkerStyle} from './model'
import { isParent, writeError } from './editingContract'

export type ReadState<T> = { kind: 'loading' | 'failed' | 'refused' | 'authentication' | 'network' | 'database' } | { kind: 'ready'; items: T[] }
type Section = 'goals' | 'notes'
type Notice = { section: Section; kind: 'saved' | 'failed'; text: string } | null
const readFailure = (error: unknown): 'refused'|'authentication'|'network'|'database'|'failed' => {
 const message=error instanceof Error?error.message:String(error)
 if(message==='UNAUTHENTICATED')return 'authentication'
 if(message==='NETWORK_ERROR')return 'network'
 if(message==='DB_UNAVAILABLE')return 'database'
 return /UNAUTHORIZED|FORBIDDEN|NOT_SHARED/.test(message)?'refused':'failed'
}

export function useFridgeEditing(adapter: FridgeEditingAdapter, childId: string, viewer: FridgeViewer) {
  const scopeKey = `${viewer.sessionKey}:${viewer.personId}:${viewer.role}:${childId}`
  const currentScope = useRef(scopeKey)
  const alive = useRef(true)
  const busy = useRef<Section | null>(null)
  const [goals, setGoals] = useState<ReadState<GoalRecord>>(()=>{const items=adapter.peekGoals?.(childId);return items?{kind:'ready',items}:{kind:'loading'}})
  const [notes, setNotes] = useState<ReadState<FridgeNoteRecord>>(()=>{const items=adapter.peekNotes?.(childId);return items?{kind:'ready',items}:{kind:'loading'}})
  const [pending, setPending] = useState<Section | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const canWrite = isParent(viewer)
  const preferences=useFridgePreferences(childId)

  useEffect(()=>{
    if(pending)return
    if(goals.kind==='ready')adapter.rememberGoals?.(childId,goals.items)
    if(notes.kind==='ready')adapter.rememberNotes?.(childId,notes.items)
  },[adapter,childId,goals,notes,pending])
  useEffect(() => {
    const abort = new AbortController()
    currentScope.current = scopeKey
    alive.current = true
    const owns = () => alive.current && !abort.signal.aborted && currentScope.current === scopeKey
    void adapter.readGoals(childId, abort.signal).then(items => { if (owns()) setGoals({ kind: 'ready', items }) }, error => { if (owns()) setGoals({ kind: readFailure(error) }) })
    void adapter.readNotes(childId, abort.signal).then(items => { if (owns()) setNotes({ kind: 'ready', items }) }, error => { if (owns()) setNotes({ kind: readFailure(error) }) })
    return () => { alive.current = false; abort.abort() }
  }, [adapter, childId, viewer.personId, viewer.role, viewer.sessionKey, scopeKey, reloadKey])

  async function change<T>(section: Section, call: () => Promise<T>, accept: (result: T) => void, optimistic?: () => () => void): Promise<boolean> {
    if (!canWrite || !alive.current || busy.current) return false
    busy.current = section
    setPending(section)
    setNotice(null)
    const rollback=optimistic?.()
    try {
      const result = await call()
      if (!alive.current || currentScope.current !== scopeKey) return false
      accept(result)
      setNotice({ section, kind: 'saved', text: 'Saved.' })
      return true
    } catch (error) {
      if (alive.current && currentScope.current === scopeKey) {rollback?.();setNotice({ section, kind: 'failed', text: writeError(error) })}
      return false
    } finally {
      if (alive.current && currentScope.current === scopeKey) { busy.current = null; setPending(null) }
    }
  }
  const putGoal = (result: GoalRecord) => setGoals(state => state.kind === 'ready' ? { kind: 'ready', items: state.items.map(item => item.id === result.id ? result : item) } : state)
  const putNote = (result: FridgeNoteRecord) => setNotes(state => state.kind === 'ready' ? { kind: 'ready', items: state.items.map(item => item.id === result.id ? result : item) } : state)
  const checkId = <T extends { id: string }>(result: T, id: string) => { if (result?.id !== id) throw new Error('MISMATCHED_RECORD'); return result }
  function optimisticNote(fields:NoteFields & {attachmentRef?:string},id?:string){
    const previous=notes
    if(notes.kind==='ready'){
      const at=new Date().toISOString()
      const existing=id?notes.items.find(note=>note.id===id):undefined
      const item:FridgeNoteRecord=existing?{...existing,...fields,updatedAt:at}:{id:'pending-note',author:{id:viewer.personId,displayName:'Saving…'},...fields,audience:'PARENTS_ONLY',createdAt:at,updatedAt:at,revision:0}
      setNotes({kind:'ready',items:[...notes.items.filter(note=>note.id!==item.id),item]})
    }
    return ()=>setNotes(previous)
  }
  return {
    goals, notes, pending, notice, canWrite, preferences,
    saveCaption: (slotId:string,text:string) => change('notes',async()=>{
      // The dialog can outlive a delete/reset in another browser. Resolve the current
      // authorized record before writing, never retry a refused mutation as a new post.
      const current=await adapter.readNotes(childId,new AbortController().signal)
      if(!alive.current||currentScope.current!==scopeKey)throw Error('UNAUTHENTICATED')
      const attachmentRef=`fridge-art:${slotId}`
      const existing=latestCaptions(current).find(note=>note.attachmentRef===attachmentRef)
      const result=existing?checkId(await adapter.updateFridgeNote({id:existing.id,text,paperColor:existing.paperColor}),existing.id):await adapter.postFridgeNote({childId,text,paperColor:'WHITE',attachmentRef,audience:'PARENTS_ONLY'})
      if(!result?.id||result.attachmentRef!==attachmentRef||(!existing&&result.audience!=='PARENTS_ONLY'))throw Error('CAPTION_NOT_CONFIRMED')
      return [...current.filter(note=>note.id!==result.id),result]
    },items=>setNotes({kind:'ready',items}),()=>optimisticNote({text,paperColor:'WHITE',attachmentRef:`fridge-art:${slotId}`},notes.kind==='ready'?latestCaptions(notes.items).find(note=>note.attachmentRef===`fridge-art:${slotId}`)?.id:undefined)),
    saveGoal: async (fields: GoalFields, marker: MarkerStyle, id?: string) => {
      let savedId=id
      const saved=await change('goals',async()=>{
        if(!preferences.ready||preferences.pending)throw Error('GOAL_STYLE_UNAVAILABLE')
        const result=id?checkId(await adapter.updateGoal({id,...fields}),id):await adapter.createGoal({childId,...fields,status:'PROPOSED'})
        if(!result?.id)throw Error('MISSING_RECORD')
        savedId=result.id
        setGoals(state=>state.kind==='ready'?{kind:'ready',items:[...state.items.filter(item=>item.id!==result.id),result]}:state)
        if(!await preferences.change({kind:'goal',itemId:result.id,...marker}))throw Error('GOAL_STYLE_FAILED')
        return result
      },()=>{})
      return {saved,id:savedId}
    },
    retry: () => { setGoals({ kind: 'loading' }); setNotes({ kind: 'loading' }); setNotice(null); setReloadKey(value => value + 1) },
    createGoal: (fields: GoalFields) => change('goals', () => adapter.createGoal({ childId, ...fields, status: 'PROPOSED' }), result => { if (!result?.id) throw new Error('MISSING_RECORD'); setGoals(state => state.kind === 'ready' ? { kind: 'ready', items: [...state.items, result] } : state) }),
    updateGoal: (id: string, fields: GoalFields) => change('goals', () => adapter.updateGoal({ id, ...fields }), result => putGoal(checkId(result, id))),
    completeGoal: (id: string) => change('goals', () => adapter.completeGoal({ id }), result => { checkId(result, id); if (!result.completedAt) throw new Error('COMPLETION_NOT_RECORDED'); putGoal(result) }),
    uncompleteGoal: (id: string) => change('goals', () => adapter.uncompleteGoal({ id }), result => { checkId(result, id); if (result.completedAt !== null) throw new Error('COMPLETION_NOT_CLEARED'); putGoal(result) }),
    deleteGoal: (id: string) => change('goals', () => adapter.deleteGoal({ id }), result => { if (result !== true) throw new Error('DELETE_NOT_CONFIRMED'); setGoals(state => state.kind === 'ready' ? { kind: 'ready', items: state.items.filter(item => item.id !== id) } : state) }),
    postNote: (fields: NoteFields & {attachmentRef?:string}) => change('notes', () => adapter.postFridgeNote({ childId, ...fields, audience: 'PARENTS_ONLY' }), result => { if (!result?.id || result.audience !== 'PARENTS_ONLY') throw new Error('NOTE_NOT_PRIVATE'); setNotes(state => state.kind === 'ready' ? { kind: 'ready', items: [...state.items.filter(item=>item.id!=='pending-note'), result] } : state) },()=>optimisticNote(fields)),
    updateNote: (id: string, fields: NoteFields) => change('notes', () => adapter.updateFridgeNote({ id, ...fields }), result => putNote(checkId(result, id)),()=>optimisticNote(fields,id)),
    setAudience: (id: string, audience: NoteAudience) => change('notes', () => adapter.setFridgeNoteAudience({ id, audience }), result => { checkId(result, id); if (result.audience !== audience) throw new Error('AUDIENCE_NOT_RECORDED'); putNote(result) }),
    removeNote: (id: string) => change('notes', () => adapter.removeFridgeNote({ id }), result => { if (result !== true) throw new Error('DELETE_NOT_CONFIRMED'); setNotes(state => state.kind === 'ready' ? { kind: 'ready', items: state.items.filter(item => item.id !== id) } : state) }),
  }
}
