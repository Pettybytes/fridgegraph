import {fireEvent,render,screen} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import {VillageRings} from './VillageRings'
const child={id:'child',name:'A very long authorized child name'}
const people=[{id:'one',name:'First authorized person',relationship:'grandmother',group:'Family'},{id:'two',name:'Second authorized person',relationship:'parent',group:'Family'},{id:'school',name:'Teacher',relationship:'teacher',group:'School & activities'}]
it('keeps every identity readable in the list alternative and opens real person detail',()=>{
 render(<VillageRings child={child} people={people}/>);fireEvent.click(screen.getByRole('button',{name:'List view'}));expect(screen.getByRole('list',{name:'People shared with you'})).toHaveTextContent('Teacher');fireEvent.click(screen.getByRole('button',{name:/First authorized person grandmother/}));expect(screen.getByRole('complementary',{name:'Selected person details'})).toHaveTextContent('Approval authority is not shown in this record.');expect(screen.queryByText('can approve')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Close person details'}));expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})
it('supports arrow-key movement between real portrait controls without changing selection',()=>{
 render(<VillageRings child={child} people={people}/>);const first=screen.getByRole('button',{name:/First authorized person grandmother/}),second=screen.getByRole('button',{name:/Second authorized person parent/});first.focus();fireEvent.keyDown(first,{key:'ArrowRight'});expect(second).toHaveFocus();expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})
it('compact preview links to the real village without a placeholder person',()=>{const open=vi.fn();render(<VillageRings child={child} people={[]} variant="compact" onOpenVillage={open}/>);expect(screen.getByText('No records are available to this view.')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Explore the village'}));expect(open).toHaveBeenCalledTimes(1);expect(screen.queryByRole('img')).not.toBeInTheDocument()})
