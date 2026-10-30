import {fireEvent,render,screen,within,waitFor} from '@testing-library/react'
import {it,expect,vi} from 'vitest'
import App from '@/App'
vi.mock('react-force-graph-2d',()=>({default:()=> <div aria-label="Connection map canvas"/>}))
async function enter(name:string) {
 window.location.hash='#/village';render(<App/>);fireEvent.click(screen.getByRole('button',{name:new RegExp(name)}))
 // Existing calendar personas intentionally keep their calendar landing page.
 const link=await screen.findByRole('link',{name:'Living Village'});fireEvent.click(link);fireEvent(window,new HashChangeEvent('hashchange'))
 return screen.findByRole('region',{name:'Authorized Living Village'})
}
it('Rosa opens only Emma and the shared teacher, and switching removes her private sheet',async()=>{
 const village=await enter('Rosa Castellano')
 expect(within(village).getByRole('combobox')).toHaveDisplayValue('Emma')
 expect(village).not.toHaveTextContent(/Nora|Malik|Jax|Taylor/)
 fireEvent.click(within(village).getByRole('button',{name:/Angela Price/}))
 expect(screen.getByRole('dialog')).toHaveTextContent('Emma')
 expect(screen.getByRole('dialog')).not.toHaveTextContent(/Nora|Jax|Micah/)
 fireEvent.click(screen.getByRole('button',{name:'Switch person',hidden:true}))
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 await waitFor(()=>expect(screen.getByRole('button',{name:/Dana/})).toBeEnabled()); fireEvent.click(screen.getByRole('button',{name:/Dana/}))
 expect(await screen.findByText('Signed in as Dana')).toBeVisible()
 expect(screen.queryByText('Rosa Castellano')).not.toBeInTheDocument()
})
it('Priya selects Malik without retaining Nora or her household in the view',async()=>{
 const village=await enter('Priya')
 fireEvent.change(within(village).getByRole('combobox'),{target:{value:'p_malik'}})
 expect(within(village).getByRole('combobox')).toHaveDisplayValue('Malik')
 expect(village.querySelector('.vv-clusters')).not.toHaveTextContent(/Nora|Kendra/)
 expect(within(village).queryByRole('button',{name:/can approve/})).not.toBeInTheDocument()
})
it('Felicia sees the recorded stepfather label without an approval badge or Skye household',async()=>{
 const village=await enter('Felicia Reyes')
 expect(within(village).getByRole('button',{name:/Marcus Vance/})).not.toHaveTextContent('can approve')
 fireEvent.click(within(village).getByRole('button',{name:/Skye/}))
 expect(screen.getByRole('dialog')).toHaveTextContent('Shared half-sibling relationship only')
 expect(village).not.toHaveTextContent('Imani')
})
it('Simone can select both children and both mothers have explicit authority',async()=>{
 const village=await enter('Simone Lee')
 expect(within(village).getAllByRole('option')).toHaveLength(2)
 fireEvent.change(within(village).getByRole('combobox'),{target:{value:'p_avery'}})
 expect(within(village).getByRole('button',{name:/Simone Lee/})).toHaveTextContent('can approve')
 expect(within(village).getByRole('button',{name:/Denise Lee/})).toHaveTextContent('can approve')
})
