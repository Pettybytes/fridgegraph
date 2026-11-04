import {FridgePreferencesContext} from './preferences'
import {mockPreferenceClient} from './fixtures/preferencesClient'
import {fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Fridge} from './Fridge'
import {authorInk,type FridgeReader,type Read,type Slot,type Goal} from './model'
afterEach(()=>{cleanup();localStorage.clear();location.hash=''})
const empty:FridgeReader={read:async()=>({status:'empty'})}
const props={personId:'parent',childId:'child-a',generation:1,reader:empty}
it('zooms first, then opens a photograph and closes with the accessible dialog control',async()=>{render(<Fridge {...props}/>);fireEvent.click(screen.getByRole('button',{name:'A quiet afternoon'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'A quiet afternoon'}));expect(screen.getByRole('dialog')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:/^Close$/}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument()})
it('preserves recorded horizons and statuses without completion controls, including guide',async()=>{render(<Fridge {...props} readOnly reader={{read:async source=>source==='goals'?{status:'ready',value:[{id:'g',title:'Practice together',horizon:'Whenever we can',status:'PROPOSED'}]}:{status:'empty'}}}/>);expect(await screen.findByText('Whenever we can')).toBeInTheDocument();expect(screen.getByText('PROPOSED')).toBeInTheDocument();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/complete|edit|add goal/i})).not.toBeInTheDocument()})
it('keeps independent refused and failed outcomes with manual retry',async()=>{const read=vi.fn<FridgeReader['read']>(async source=>({status:source==='care'?'refused':'failed'}));render(<Fridge {...props} reader={{read}}/>);expect(await screen.findByText('Not shared with this perspective.')).toBeInTheDocument();expect(screen.getByText("Couldn't load these notes")).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Open goals door'}));fireEvent.click(screen.getByRole('button',{name:'Retry goals'}));await waitFor(()=>expect(read).toHaveBeenCalledTimes(3))})
it('clears dialogs on a child or persona change and discards late results',async()=>{let finish!:(value:Read<Slot[]|Goal[]>)=>void;const old:FridgeReader={read:()=>new Promise(resolve=>{finish=resolve})};const view=render(<Fridge {...props} reader={old}/>);fireEvent.click(screen.getByRole('button',{name:'A quiet afternoon'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'A quiet afternoon'}));view.rerender(<Fridge {...props} personId="other" childId="child-b" generation={2}/>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();finish({status:'ready',value:[{id:'private',title:'Old private goal',horizon:null,status:'APPROVED'}]});await waitFor(()=>expect(screen.getAllByText('Nothing posted yet.')).toHaveLength(1));expect(screen.queryByText('Old private goal')).not.toBeInTheDocument()})
it('loads server geometry and tidies without storing family data in the browser',async()=>{
 const client=mockPreferenceClient();await client.write('child-a',{kind:'art',itemId:'sample-sofa',position:{x:.25,y:.2,width:.16,rotation:2}})
 render(<FridgePreferencesContext.Provider value={client}><Fridge {...props}/></FridgePreferencesContext.Provider>)
 await waitFor(()=>expect(screen.getByRole('button',{name:'A quiet afternoon'})).toHaveStyle({left:'25%'}))
 fireEvent.click(screen.getByRole('button',{name:'Tidy up'}))
 await waitFor(()=>expect(screen.getByText('Arrangement saved.')).toBeInTheDocument())
 expect((await client.read('child-a',new AbortController().signal))[0].position).toBeNull()
 expect(localStorage.length).toBe(0)
})
it('supports keyboard movement only in explicit Arrange mode',()=>{render(<Fridge {...props}/>);const photo=screen.getByRole('button',{name:'A quiet afternoon'});fireEvent.keyDown(photo,{key:'ArrowRight',altKey:true});expect(photo).toHaveStyle({left:'21.5%'});fireEvent.click(screen.getByRole('button',{name:'Open collage door'}));fireEvent.keyDown(photo,{key:'ArrowRight',altKey:true});expect(photo).toHaveStyle({left:'21.5%'});fireEvent.click(screen.getByRole('button',{name:'Arrange items'}));fireEvent.keyDown(photo,{key:'ArrowRight',altKey:true});expect(photo).toHaveStyle({left:'22%'})})
it('keeps author marker ink stable and unknown authors neutral',()=>{expect(authorInk(null)).toBe('#263a4a');expect(authorInk('recorded-author')).toBe(authorInk('recorded-author'));expect(authorInk('a')).not.toBe(authorInk('b'))})
it('saves captions explicitly through the server adapter, reloads its record, and never stores caption text in the browser',async()=>{
 const {within}=await import('@testing-library/react')
 const open=()=>{fireEvent.click(screen.getByRole('button',{name:'Open collage door'}));fireEvent.click(screen.getByRole('button',{name:'A quiet afternoon'}))}
 const saveCaption=vi.fn(async()=>true)
 render(<Fridge {...props} saveCaption={saveCaption}/>)
 open()
 fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox',{name:'Edit caption for A quiet afternoon'}),{target:{value:'Our trip to the lake'}})
 expect(saveCaption).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:/^Save$/}))
 expect(await screen.findByText('Saved.')).toBeInTheDocument()
 expect(saveCaption).toHaveBeenCalledWith(expect.objectContaining({id:'sample-sofa'}),'Our trip to the lake')
 expect(localStorage.getItem('fridge-captions:parent')).toBeNull()
 cleanup()
 const record={id:'caption-note',text:'Our trip to the lake',attachmentRef:'fridge-art:sample-sofa',author:{id:'parent',displayName:'Parent'},paperColor:'WHITE' as const,audience:'PARENTS_ONLY' as const,createdAt:'',updatedAt:'',revision:1}
 render(<Fridge {...props} captionNotes={[record]} saveCaption={saveCaption}/>)
 open()
 expect(within(screen.getByRole('dialog')).getByRole('textbox',{name:/Edit caption/})).toHaveValue('Our trip to the lake')
 cleanup()
 render(<Fridge {...props} captionNotes={[record]} readOnly/>)
 open()
 expect(within(screen.getByRole('dialog')).getByText('Our trip to the lake')).toBeInTheDocument()
 expect(screen.queryByRole('textbox',{name:/Edit caption/})).not.toBeInTheDocument()
})
it('lets a parent pick a per-goal marker colour + font that persists, and hides the picker for read-only',async()=>{
 const goalsReader:FridgeReader={read:async source=>source==='goals'?{status:'ready',value:[{id:'g1',title:'Practice together',horizon:null,status:'PROPOSED'}]}:{status:'empty'}}
 const client=mockPreferenceClient()
 render(<FridgePreferencesContext.Provider value={client}><Fridge {...props} boardReadOnly={false} reader={goalsReader}/></FridgePreferencesContext.Provider>)
 await screen.findByText('Practice together')
 // The whiteboard lives inside the zoomable scene; open (zoom into) the goals door so in-scene
 // controls receive clicks instead of the viewport's zoom handler.
 fireEvent.click(screen.getByRole('button',{name:'Open goals door'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'blue marker'})).toBeEnabled())
 const marker=async()=>(await client.read('child-a',new AbortController().signal)).find(item=>item.itemId==='g1')
 fireEvent.click(screen.getByRole('button',{name:'blue marker'}))
 await waitFor(async()=>expect((await marker())?.color).toBe('blue'))
 fireEvent.click(screen.getByRole('button',{name:'Caveat'}))
 await waitFor(async()=>expect(await marker()).toMatchObject({color:'blue',font:'caveat'}))
 cleanup()
 render(<FridgePreferencesContext.Provider value={client}><Fridge {...props} readOnly reader={goalsReader}/></FridgePreferencesContext.Provider>)
 await screen.findByText('Practice together')
 expect(screen.queryByRole('button',{name:'blue marker'})).not.toBeInTheDocument()
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Practice together'})).toHaveClass('fridge-marker-caveat'))
 expect(localStorage.length).toBe(0)
})
it('shows a not-connected state, not a load failure, when a source is unavailable offline',async()=>{render(<Fridge {...props} reader={{read:async()=>({status:'unavailable'})}}/>);expect(await screen.findByText('Not connected in this view.')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Open goals door'}));expect(screen.getByText('These notes aren’t connected in this view.')).toBeInTheDocument();expect(screen.queryByRole('button',{name:/Retry/})).not.toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument()})
it('fills an untouched caption when server notes arrive after opening, but preserves a typed draft',()=>{
 const saveCaption=vi.fn(async()=>true)
 const view=render(<Fridge {...props} saveCaption={saveCaption}/>)
 fireEvent.click(screen.getByRole('button',{name:'Open collage door'}))
 fireEvent.click(screen.getByRole('button',{name:'A quiet afternoon'}))
 const record={id:'late',text:'Server caption',attachmentRef:'fridge-art:sample-sofa',author:{id:'parent',displayName:'Parent'},paperColor:'WHITE' as const,audience:'PARENTS_ONLY' as const,createdAt:'',updatedAt:'',revision:1}
 view.rerender(<Fridge {...props} captionNotes={[record]} saveCaption={saveCaption}/>)
 expect(screen.getByRole('textbox',{name:/Edit caption/})).toHaveValue('Server caption')
 fireEvent.change(screen.getByRole('textbox',{name:/Edit caption/}),{target:{value:'My unfinished draft'}})
 view.rerender(<Fridge {...props} captionNotes={[{...record,text:'New server caption'}]} saveCaption={saveCaption}/>)
 expect(screen.getByRole('textbox',{name:/Edit caption/})).toHaveValue('My unfinished draft')
})
