import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { LayoutDashboard, Radar, MessageCircle, HeartPulse, Network, ArrowUpRight, CalendarDays, Home, Map, List, Mail, Refrigerator } from 'lucide-react'
import { FridgeMark } from '@/components/fg/FridgeMark'
import { cn } from '@/lib/utils'
import { useDataContext } from '@/lib/frontendData/provider'
export type Route = 'today' | 'mission-control' | 'ask-rosina' | 'village' | 'care-information' | 'calendar' | 'orbit' | 'map' | 'activity' | 'invitations' | 'fridge'
const routes = [
  { path: 'map', label: 'Village map', icon: Map },
  { path: 'today', label: 'Today', icon: Home },
  { path: 'fridge', label: 'The Fridge', icon: Refrigerator },
  { path: 'mission-control', label: 'Mission Control', icon: LayoutDashboard },
  { path: 'activity', label: 'Activity', icon: List },
  { path: 'orbit', label: 'Orbit', icon: Radar },
  { path: 'calendar', label: 'Family Calendar', icon: CalendarDays },
  { path: 'invitations', label: 'Invitations', icon: Mail },
  { path: 'ask-rosina', label: 'Ask Rosina', icon: MessageCircle },
  { path: 'care-information', label: 'Care information', icon: HeartPulse },
  { path: 'village', label: 'Living Village', icon: Network },
] as const
function readRoute(): string { const route = window.location.hash.slice(2).split('?')[0]; return ['fridge/notes', 'fridge/goals'].includes(route) ? 'fridge' : route === 'parent-chat' ? 'ask-rosina' : route || 'today' }
export function Shell({ slots = {} }: { slots?: Partial<Record<Route, ReactNode>> }) {
  const [route, setRoute] = useState(readRoute)
  const { scope, mode } = useDataContext()
  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const current = routes.find(item => item.path === route)
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <a href="#/today" className="brand"><FridgeMark size={26} aria-hidden="true" />FridgeGraph</a>
      <p className="village-caption">A little more village.</p>
      <nav aria-label="Main navigation">{routes.map(({ path, label, icon: Icon }) =>
        <a key={path} href={`#/${path}`} className={cn('nav-link', route === path && 'active')} aria-current={route === path ? 'page' : undefined}><Icon size={19} aria-hidden="true" />{label}</a>
      )}</nav>
      <div className="sidebar-footer"><span className="avatar">{scope.parentName[0]}</span><div><strong>{scope.parentName}</strong><small>{route === 'calendar' ? 'Your shared calendars' : route === 'village' ? 'Your shared villages' : `${scope.childName}'s village`}</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>{route === 'calendar' ? 'Your shared calendars' : route === 'village' ? 'Your shared villages' : `${scope.childName}'s village`}</span><span className="demo-badge">{mode === 'mock' ? 'Fictional demo' : 'Connected'}</span></header>
      <main id="main" tabIndex={-1}>
        {route !== 'fridge' && <div className={cn('page-heading', route === 'ask-rosina' && 'sr-only')}><div><h1>{current?.label ?? 'Page not found'}</h1></div></div>}
        {current ? slots[current.path] ?? <section className="route-slot" aria-label={`${current.label} workspace`}><div className="slot-symbol"><current.icon size={32} aria-hidden="true" /></div><h2>{current.label === 'Living Village' ? 'Room for your Living Village' : `Your ${current.label.toLowerCase()} workspace`}</h2><p>{current.path === 'village' ? `The people and relationships around ${scope.childName} will come together here.` : 'This workspace is ready for the next feature.'}</p><a href={current.path === 'village' ? '#/mission-control' : '#/village'}>{current.path === 'village' ? 'Back to Mission Control' : 'Explore Living Village'}<ArrowUpRight size={16} aria-hidden="true" /></a></section>
        : <section className="route-slot"><h2>This page isn't here.</h2><a href="#/mission-control">Go to Mission Control</a></section>}
      </main>
      <footer className="attribution">Planning and decisions powered by Meta's Muse Spark</footer>
    </div>
  </div>
}
