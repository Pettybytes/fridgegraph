import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import App from '@/App'
afterEach(()=>{cleanup();history.replaceState(null,'','#/today')})
for(const [hash,view] of [['#/fridge','overview'],['#/fridge/notes','notes'],['#/fridge/goals','goals']]){
 it(`mounts ${hash} inside the signed-in app and highlights The Fridge after Today`,async()=>{
  history.replaceState(null,'',hash)
  const {container}=render(<App/> )
  fireEvent.click(screen.getByRole('button',{name:'Explore as Kendra'}))
  await screen.findByRole('region',{name:'The Fridge'})
  expect(container.querySelector('.fridge-viewport')).toHaveAttribute('data-view',view)
  const nav=screen.getByRole('navigation',{name:'Main navigation'})
  const links=within(nav).getAllByRole('link')
  const today=links.findIndex(link=>link.textContent==='Today')
  expect(links[today+1]).toHaveTextContent('The Fridge')
  expect(links[today+1]).toHaveAttribute('href','#/fridge')
  expect(links[today+1]).toHaveAttribute('aria-current','page')
  expect(screen.getAllByRole('heading',{name:'The Fridge',level:1})).toHaveLength(1)
  // A signed-in mock session has no live reader: preserve a failure, never inject the visual fixture.
  expect(screen.queryByText('Bring a sketchbook')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Open goals door'}))
  await waitFor(()=>expect(location.hash).toBe('#/fridge/goals'))
  fireEvent.click(screen.getByRole('button',{name:'← Back to fridge'}))
  await waitFor(()=>expect(location.hash).toBe('#/fridge'))
  expect(container.querySelector('.fridge-viewport')).toHaveAttribute('data-view','overview')
  act(()=>{location.hash='#/fridge/not-a-door';window.dispatchEvent(new HashChangeEvent('hashchange'))})
  expect(await screen.findByText("This page isn't here.")).toBeInTheDocument()
 })
}
it('labels the mounted mock Demo guide perspective read-only',async()=>{
 history.replaceState(null,'','#/fridge')
 render(<App/> )
 fireEvent.click(screen.getByRole('button',{name:'Explore as the Demo guide'}))
 await waitFor(()=>expect(location.hash).toBe('#/village'))
 const link=await screen.findByRole('link',{name:'The Fridge'});fireEvent.click(link)
 expect(await screen.findByText(/Explore the family collage/)).toBeInTheDocument()
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
