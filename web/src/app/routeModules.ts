import { lazy } from 'react'
import { loadFridgeRoute } from '@/features/fridge/routeLoader'
// Imports are shared by React.lazy and navigation intent preloads.
export const routeModules = {
  today: () => import('@/features/today/Today').then(m => ({ default: m.Today })),
  activity: () => import('@/features/activity/Activity').then(m => ({ default: m.Activity })),
  'mission-control': () => import('@/features/mission-control/LiveMissionControl').then(m => ({ default: m.LiveMissionControl })),
  calendar: () => import('@/features/calendar/LiveFamilyCalendar').then(m => ({ default: m.LiveFamilyCalendar })),
  'care-information': () => import('@/features/personas/careInformation').then(m => ({ default: m.CareInformation })),
  village: () => import('@/components/signature/SignatureVillageRoute').then(m => ({ default: m.SignatureVillageRoute })),
  fridge: loadFridgeRoute,
  orbit: () => import('@/features/orbit/Orbit').then(m => ({ default: m.Orbit })),
  map: () => import('@/features/village-map/VillageMap').then(m => ({ default: m.VillageMap })),
  invitations: () => import('@/features/invites/InvitesPanel').then(m => ({ default: m.InvitesPanel })),
}
export function preloadRoute(route: string) {
  if (route in routeModules) void routeModules[route as keyof typeof routeModules]().catch(() => { /* Navigation owns the visible error. */ })
}
export const Today = lazy(routeModules.today)
export const Activity = lazy(routeModules.activity)
export const LiveMissionControl = lazy(routeModules['mission-control'])
export const LiveFamilyCalendar = lazy(routeModules.calendar)
export const CareInformation = lazy(routeModules['care-information'])
export const SignatureVillageRoute = lazy(routeModules.village)
export const FridgeRoute = lazy(routeModules.fridge)
export const Orbit = lazy(routeModules.orbit)
export const VillageMap = lazy(routeModules.map)
export const InvitesPanel = lazy(routeModules.invitations)
