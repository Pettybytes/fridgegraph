import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {MapCanvas} from './MapCanvas'
import {MapController} from './controller'
import {createMockMapAdapter} from './mockAdapter'
vi.mock('maplibre-gl',()=>({setWorkerUrl:vi.fn()}))
vi.mock('react-map-gl/maplibre',()=>({default:({onError}:{onError:()=>void})=><button onClick={onError}>Fail WebGL</button>,Marker:()=>null,Source:()=>null,Layer:()=>null}))
afterEach(cleanup)
it('WebGL or tile failure keeps an authorized, selectable places and timeline fallback',async()=>{const c=new MapController(createMockMapAdapter('priya'));await c.load();render(<MapCanvas controller={c} state={c.getSnapshot()} theme="light"/>);fireEvent.click(screen.getByRole('button',{name:'Fail WebGL'}));expect(screen.getByRole('region',{name:'Map list fallback'})).toBeVisible();expect(screen.queryByText("Kendra's home")).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Maplewood School'}));expect(c.getSnapshot().selection).toEqual({kind:'place',id:'school'});expect(screen.getByText(/School pickup · Maplewood/)).toBeVisible()})
