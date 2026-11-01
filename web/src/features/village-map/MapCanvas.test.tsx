import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {MapCanvas} from './MapCanvas'
import {MapController} from './controller'
import {createMockMapAdapter} from './mockAdapter'
vi.mock('maplibre-gl',()=>({setWorkerUrl:vi.fn()}))
vi.mock('react-map-gl/maplibre',()=>({default:({onError}:{onError:()=>void})=><button onClick={onError}>Fail WebGL</button>,Marker:()=>null,Source:()=>null,Layer:()=>null}))
afterEach(cleanup)
it('WebGL or tile failure keeps an authorized, selectable places and timeline fallback',async()=>{const c=new MapController(createMockMapAdapter('priya'));await c.load();render(<MapCanvas controller={c} state={c.getSnapshot()} theme="light"/>);fireEvent.click(screen.getByRole('button',{name:'Fail WebGL'}));expect(screen.getByRole('region',{name:'Map list fallback'})).toBeVisible();expect(screen.queryByText("Kendra's home")).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Maplewood School'}));expect(c.getSnapshot().selection).toEqual({kind:'place',id:'school'});expect(screen.getByText(/School pickup · Maplewood/)).toBeVisible()})

it('withheld coordinates show restricted labels, never a map or substitute camera',async()=>{const c=new MapController(createMockMapAdapter('priya'));await c.load();const state=c.getSnapshot(),world={...state.world!,places:state.world!.places.map(p=>({...p,point:undefined})),people:state.world!.people.map(p=>({...p,position:{...p.position,point:undefined}}))};render(<MapCanvas controller={c} state={{...state,world}} theme="light"/>);expect(screen.getByText('Map restricted')).toBeVisible();expect(screen.getByRole('button',{name:'Maplewood School'})).toBeVisible();expect(screen.queryByRole('button',{name:'Fail WebGL'})).not.toBeInTheDocument()})
