import {fireEvent,render,screen} from '@testing-library/react'
import {describe,expect,it} from 'vitest'
import {VillageRings} from './VillageRings'
import {SHOWCASE_PROFILES} from './profiles'

/** Village rosters as seeded (fixtures + 0002_seed): every member of every showcase
 * child's village must carry a full fictional profile and a note to that child. */
const ROSTERS:Record<string,string[]>={
 p_nora:['p_mom','p_dad','p_leo','p_max','p_gma','p_walter','p_gloria','p_bryan','p_tasha','p_monique','p_chris','p_priya','p_price','p_okafor','p_jennings','p_holt','p_marcus','p_dana'],
 p_jax:['p_dana','p_ray','p_evelyn','p_price','p_okafor','p_marcus'],
 p_leo:['p_mom','p_max','p_nora'],
 p_max:['p_mom','p_leo','p_nora'],
 p_avery:['p_denise','p_micah','p_simone'],
 p_micah:['p_avery','p_denise','p_simone'],
 p_emma:['p_rosa','p_tomas'],
 p_malik:['p_cassandra','p_dwayne','p_oscar','p_priya'],
 p_skye:['p_felicia','p_marcus','p_taylor'],
 p_taylor:['p_felicia','p_marcus','p_skye'],
}

describe('showcase profiles cover both villages',()=>{
 it('gives every member a complete profile and a message to each child they surround',()=>{
  for(const [childId,members] of Object.entries(ROSTERS))for(const id of members){
   const profile=SHOWCASE_PROFILES[id]
   expect(profile,`profile for ${id}`).toBeDefined()
   expect(profile.age).toBeGreaterThan(0)
   expect(profile.job.length).toBeGreaterThan(3)
   expect(profile.hobbies.length).toBeGreaterThanOrEqual(2)
   expect(profile.hobbies.length).toBeLessThanOrEqual(3)
   expect(profile.goals.length).toBeGreaterThanOrEqual(1)
   expect(profile.goals.length).toBeLessThanOrEqual(2)
   expect(profile.messages[childId],`message ${id} -> ${childId}`).toMatch(/\S/)
  }
 })
 it('keeps the showcase copy inside the release-gate language rules',()=>{
  const text=JSON.stringify(SHOWCASE_PROFILES)
  expect(text).not.toMatch(/—/)
  expect(text).not.toMatch(/mock|purple|unavailable/i)
 })
})

describe('profile card',()=>{
 const child={id:'p_jax',name:'Jax Coleman'}
 const evelyn={id:'p_evelyn',name:'Evelyn Carter',relationship:'grandmother',group:'Family'}
 it('opens a full profile with job, hobbies, goals and the warm note to the center child',async()=>{
  render(<VillageRings child={child} people={[evelyn]}/>)
  fireEvent.click(screen.getByRole('button',{name:/Evelyn Carter grandmother/}))
  expect(await screen.findByText(/Cookies are waiting/)).toBeInTheDocument()
  const card=screen.getByRole('complementary',{name:'Selected person details'})
  expect(card).toHaveTextContent('Retired church administrator')
  expect(card).toHaveTextContent('66')
  expect(card).toHaveTextContent('Baking')
  expect(card).toHaveTextContent('snickerdoodle')
  expect(card).toHaveTextContent('To Jax')
  expect(card).toHaveTextContent('Only information shared with this perspective appears here.')
 })
 it('dismisses on outside press and on Escape from anywhere, restoring focus for Escape',async()=>{
  render(<VillageRings child={child} people={[evelyn]}/>)
  const portraitButton=screen.getByRole('button',{name:/Evelyn Carter grandmother/})
  fireEvent.click(portraitButton)
  await screen.findByText(/Cookies are waiting/)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  fireEvent.click(portraitButton)
  await screen.findByText(/Cookies are waiting/)
  fireEvent.keyDown(document.body,{key:'Escape'})
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(portraitButton).toHaveFocus()
 })
 it('renders no invented facts for a person outside the showcase seed',async()=>{
  const {rerender}=render(<VillageRings child={child} people={[evelyn]}/>)
  fireEvent.click(screen.getByRole('button',{name:/Evelyn Carter grandmother/}))
  await screen.findByText(/Cookies are waiting/)
  rerender(<VillageRings child={child} people={[{id:'p_someone_new',name:'Newly Added Villager',relationship:'sitter',group:'Care'}]}/>)
  fireEvent.click(screen.getByRole('button',{name:/Newly Added Villager sitter/}))
  expect(screen.getByRole('complementary',{name:'Selected person details'})).toBeInTheDocument()
  expect(screen.queryByTestId('profile-facts')).not.toBeInTheDocument()
  expect(screen.queryByText('Showcase profile')).not.toBeInTheDocument()
 })
})
