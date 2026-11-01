import {fireEvent,render,screen} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import type {Alert} from '@/features/orbit/adapter'
import {ActivityLedger} from './activityLedger'
import {OrbitRollCall} from './OrbitRollCall'
const record:Alert={id:'alert',status:'ACTIVE',child:{id:'child'},message:'Exact message',share:{photoId:null},activatedAt:'2026-10-31T20:00:00Z',closedAt:null,guidance:'Emergency guidance',audience:[{person:{id:'one',displayName:'One recipient'},eligible:true},{person:{id:'two',displayName:'Other recipient'},eligible:true}],responses:[],latestResponses:[{person:{id:'one',displayName:'One recipient'},response:'WITH_ME',respondedAt:'2026-10-31T20:01:00Z'}]}
it('recipient presentation defensively contains only their own audience row and response',()=>{const portraits=vi.fn();render(<OrbitRollCall alert={record} parent={false} personId="one" ledger={new ActivityLedger()} portraitFor={portraits}/>);expect(screen.getByText('One recipient')).toBeInTheDocument();expect(screen.queryByText('Other recipient')).not.toBeInTheDocument();expect(portraits).not.toHaveBeenCalledWith('two');expect(screen.getByText('Reported “With me”')).toBeInTheDocument();expect(screen.getByText('“With me” is a report from a village member. Only the parent closes Orbit.')).toBeInTheDocument();expect(screen.queryByRole('button',{name:/Close/})).not.toBeInTheDocument()})
it('parent sees the frozen returned audience, never delivery language or a successful-contact assumption',()=>{render(<OrbitRollCall alert={record} parent personId="parent" ledger={new ActivityLedger()}/>);expect(screen.getByText('Other recipient')).toBeInTheDocument();expect(screen.getByText('No response yet')).toBeInTheDocument();expect(screen.getByText('Simulated notification')).toBeInTheDocument();expect(screen.queryByText(/delivered|received it|safe/i)).not.toBeInTheDocument()})
it('unknown/unshared names never resolve a portrait just because an id is mapped',()=>{const portraits=vi.fn();render(<OrbitRollCall alert={{...record,audience:[{person:{id:'unknown'},eligible:true}],latestResponses:[]}} parent personId="parent" ledger={new ActivityLedger()} portraitFor={portraits}/>);expect(screen.getByText('Name not shared')).toBeInTheDocument();expect(portraits).not.toHaveBeenCalled()})
it.each([['ON_WAY','On my way'],['CANNOT_HELP',"Can't help"],['WITH_ME','Reported “With me”']])('a persisted %s response has an explicit portrait state and text', (response,label)=>{
 const {container}=render(<OrbitRollCall alert={{...record,latestResponses:[{person:{id:'one',displayName:'One recipient'},response,respondedAt:'2026-10-31T20:01:00Z'}]}} parent={false} personId="one" ledger={new ActivityLedger()}/>);expect(screen.getByText(label)).toBeInTheDocument();expect(container.querySelector(`[data-response="${response}"]`)).not.toBeNull();expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-31T20:01:00Z')
})

it('places the real child at the center and the frozen audience on one ring',()=>{
 const {container}=render(<OrbitRollCall alert={record} child={{id:'child',name:'Authorized child'}} parent personId="parent" ledger={new ActivityLedger()}/>);
 expect(container.querySelector('.sg-child')).toHaveTextContent('Authorized child');expect(container.querySelectorAll('.sg-orbits ellipse')).toHaveLength(1)
 expect(container.querySelectorAll('.sg-person')).toHaveLength(2);expect(container.querySelector('.sg-rollcall')).toHaveAttribute('data-active','true')
 expect(screen.getByText('Reported “With me”')).toBeInTheDocument()
})

it('the accessible list exposes persisted response state without enlarging recipient scope',()=>{
 const {container}=render(<OrbitRollCall alert={record} child={{id:'child',name:'Authorized child'}} parent personId="parent" ledger={new ActivityLedger()}/>);
 fireEvent.click(container.querySelector<HTMLButtonElement>('.sg-view-toggle')!)
 expect(screen.getByRole('list',{name:'People shared with you'})).toHaveTextContent('Reported “With me”')
})
