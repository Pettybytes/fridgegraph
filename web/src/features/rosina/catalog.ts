import { validDay } from '@/features/calendar/time'
export type Screen = 'mission-control' | 'village' | 'care-information' | 'ask-rosina'
export type ExplainableScreen = Screen | 'calendar'
export type CalendarChangeArgs = { operation: 'create' | 'update' | 'delete'; childId: string; childName: string; eventId: string; title: string; start: string; end: string; location: string; notes: string; color: string; status: string }
export type ActionArgs = {
  'calendar-change': CalendarChangeArgs;
  'open-calendar': { day: string; childId: string }
  'open-event': { id: string }
  'open-screen': { screen: Screen }
  'open-person': { personId: string }
  'start-pickup': { childId: string; date: string; window: 'morning' | 'afternoon' | 'evening' }
  'explain-screen': { screen: ExplainableScreen }
  'explain-recommendation': Record<string, never>
  'prepareOrbitAlert': { childId: string; wearColor?: string; wearGarment?: string; hair?: string; carryColor?: string; carryItem?: string }
}
export type ActionId = keyof ActionArgs
export type CatalogAction = { [Id in ActionId]: { id: Id; args: ActionArgs[Id] } }[ActionId]
type ArgsSchema<T> = { parse(value: unknown): T | null }
type CatalogEntry<Id extends ActionId> = { id: Id; label: string; argsSchema: ArgsSchema<ActionArgs[Id]>; routeOrHandler: 'route' | 'person-card' | 'pickup' | 'explain' | 'orbit' | 'calendar-write'; changesData: boolean; implemented: boolean }
function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function screenArgs(value: unknown): { screen: Screen } | null {
  return record(value, ['screen']) && (value.screen === 'mission-control' || value.screen === 'village' || value.screen === 'care-information' || value.screen === 'ask-rosina') ? { screen: value.screen } : null
}
const personId = (value: unknown): value is string => typeof value === 'string' && /^p_[a-z0-9_]{1,60}$/.test(value)
function pickupArgs(value: unknown): ActionArgs['start-pickup'] | null {
  if (!record(value, ['childId', 'date', 'window']) || !personId(value.childId) || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return null
  const date = new Date(`${value.date}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.date || !['morning', 'afternoon', 'evening'].includes(String(value.window))) return null
  return { childId: value.childId, date: value.date, window: value.window as ActionArgs['start-pickup']['window'] }
}
// Vocabulary membership (the actual safety guarantee) is checked server-side against the live,
// versioned OrbitVocabulary list — this static schema only enforces shape: a real childId, no
// unknown keys, and short non-empty strings for whichever descriptors were actually supplied.
// Never add a location-shaped field here (coordination-v2 Area F / the Orbit contract: no
// location of any kind anywhere in this slice).
const ORBIT_DESCRIPTOR_KEYS = ['wearColor', 'wearGarment', 'hair', 'carryColor', 'carryItem'] as const
function orbitAlertArgs(value: unknown): ActionArgs['prepareOrbitAlert'] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  if (!personId(obj.childId)) return null
  const allowed = new Set<string>(['childId', ...ORBIT_DESCRIPTOR_KEYS])
  if (!Object.keys(obj).every(key => allowed.has(key))) return null
  const out: ActionArgs['prepareOrbitAlert'] = { childId: obj.childId }
  for (const key of ORBIT_DESCRIPTOR_KEYS) {
    if (!(key in obj)) continue
    const v = obj[key]
    if (typeof v !== 'string' || v.length < 1 || v.length > 40) return null
    out[key] = v
  }
  return out
}
// This is the authority. Responses can supply only an id and args, never a route or confirm policy.
function calendarArgs(value: unknown): CalendarChangeArgs | null {
  const keys=['operation','childId','childName','eventId','title','start','end','location','notes','color','status'];
  if(!record(value,keys) || !keys.every(k=>typeof value[k]==='string')) return null;
  const a=value as unknown as CalendarChangeArgs;
  const wall=(v:string)=>/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(v)&&validDay(v.slice(0,10));
  if(!['create','update','delete'].includes(a.operation)||!personId(a.childId)||!a.childName.trim()||a.childName.length>120||!a.title.trim()||a.title.length>300||!wall(a.start)||!wall(a.end)||a.end<=a.start||a.location.length>500||a.notes.length>4000||a.color.length>40||!['confirmed','proposed','cancelled'].includes(a.status))return null;
  if(a.operation==='create'?a.eventId!=='':!/^[-a-zA-Z0-9_]{1,128}$/.test(a.eventId))return null;
  return {...a};
}

export const catalog: { [Id in ActionId]: CatalogEntry<Id> } = {
  'calendar-change': {id:'calendar-change',label:'Review calendar change',argsSchema:{parse:calendarArgs},routeOrHandler:'calendar-write',changesData:true,implemented:true},
  'open-calendar': { id: 'open-calendar', label: 'Open calendar', argsSchema: { parse: value => record(value, ['day', 'childId']) && validDay(value.day) && personId(value.childId) ? { day: value.day, childId: value.childId } : null }, routeOrHandler: 'route', changesData: false, implemented: true },
  'open-event': { id: 'open-event', label: 'Open event', argsSchema: { parse: value => record(value, ['id']) && typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.id) ? { id: value.id } : null }, routeOrHandler: 'route', changesData: false, implemented: true },
  'open-screen': { id: 'open-screen', label: 'Open screen', argsSchema: { parse: screenArgs }, routeOrHandler: 'route', changesData: false, implemented: true },
  'open-person': { id: 'open-person', label: 'Open person card', argsSchema: { parse: value => record(value, ['personId']) && personId(value.personId) ? { personId: value.personId } : null }, routeOrHandler: 'person-card', changesData: false, implemented: true },
  'start-pickup': { id: 'start-pickup', label: 'Review pickup request', argsSchema: { parse: pickupArgs }, routeOrHandler: 'pickup', changesData: true, implemented: true },
  'explain-screen': { id: 'explain-screen', label: 'Explain this screen', argsSchema: { parse: value => screenArgs(value) ?? (record(value, ['screen']) && value.screen === 'calendar' ? { screen: 'calendar' } : null) }, routeOrHandler: 'explain', changesData: false, implemented: true },
  'explain-recommendation': { id: 'explain-recommendation', label: 'Explain the recommendation', argsSchema: { parse: value => record(value, []) ? {} : null }, routeOrHandler: 'explain', changesData: false, implemented: true },
  // Explicit card click prepares a preview; activation always needs the parent's separate confirm.
  // Permission also requires the live controller's verified parent read (actionAllowed below).
  'prepareOrbitAlert': { id: 'prepareOrbitAlert', label: 'Prepare Orbit alert', argsSchema: { parse: orbitAlertArgs }, routeOrHandler: 'orbit', changesData: true, implemented: true },
}
export function validateActions(input: unknown): CatalogAction[] {
  if (!Array.isArray(input)) return []
  return input.slice(0, 12).flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !Object.hasOwn(catalog, item.id)) return []
    const id = item.id as ActionId, entry = catalog[id]
    if (!entry.implemented) return []
    const args = entry.argsSchema.parse(item.args)
    return args ? [{ id, args } as CatalogAction] : []
  })
}
export function actionRoute(action: CatalogAction): string | null {
  if (action.id === 'open-calendar') return `#/calendar?day=${encodeURIComponent(action.args.day)}&childId=${encodeURIComponent(action.args.childId)}&view=day`
  if (action.id === 'open-event') return `#/calendar?event=${encodeURIComponent(action.args.id)}`
  if (action.id === 'open-screen') return `#/${action.args.screen}`
  if (action.id === 'open-person') return `#/village?person=${encodeURIComponent(action.args.personId)}`
  return null
}
export function actionAllowed(action: CatalogAction, context: { childId: string | null; parent: boolean; visiblePeople: ReadonlySet<string>; readOnly?: boolean; canReadCare?: boolean; canPrepareOrbit?:boolean; calendarChildIds?: ReadonlySet<string>; calendarEventIds?: ReadonlySet<string> }): boolean {
  if(action.id==='calendar-change') return context.calendarChildIds?.has(action.args.childId)===true
  if(context.readOnly && catalog[action.id].changesData)return false
  if (action.id === 'open-calendar') return context.calendarChildIds?.has(action.args.childId) === true
  if (action.id === 'open-event') return context.calendarEventIds?.has(action.args.id) === true
  if (action.id === 'open-screen' && action.args.screen === 'care-information') return context.canReadCare === true
  if (action.id === 'prepareOrbitAlert') return context.canPrepareOrbit===true && action.args.childId===context.childId
  if (action.id === 'start-pickup') return context.parent && action.args.childId === context.childId
  if (action.id === 'open-person') return context.visiblePeople.has(action.args.personId)
  return true
}

export function actionLabel(action: CatalogAction): string {
  const screens: Record<Screen, string> = { 'mission-control': 'Mission Control', village: 'Living Village', 'care-information': 'care information', 'ask-rosina': 'Ask Rosina' }
  if (action.id === 'open-screen') return `Open ${screens[action.args.screen]}`
  if (action.id === 'open-calendar') return 'Open calendar'
  if (action.id === 'start-pickup') return `${catalog[action.id].label} · ${action.args.date} ${action.args.window}`
  return catalog[action.id].label
}
