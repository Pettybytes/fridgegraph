import { createMockCalendarAdapter } from '@/features/calendar/mockAdapter'
import { localDay, validDay } from '@/features/calendar/time'
import type { AuthSession } from '@/features/personas/auth'
import { noraCareInformation, sourceCitation } from '@/features/personas/careInformation'
import { pickupStatusLabel } from '@/lib/frontendData/displayCopy'
import { reasonLabel } from '@/lib/frontendData/types'
import type { FrontendAdapter } from '@/lib/frontendData/types'
import type { SchoolReportProposal } from './schoolReport'
import type { AddVillagerProposal } from '@/features/add-villager/addVillager'
export type HistoryMessage = { role: 'user' | 'assistant'; content: string }
export type RosinaRequest = { message: string; currentRoute: string; history: HistoryMessage[] }
export type RosinaResponse = { reply: string; actions: unknown[]; notice?: 'sign-in' | 'rate-limit'; schoolReportProposal?: SchoolReportProposal | null; addVillagerProposal?: AddVillagerProposal | null }
export interface RosinaAdapter {
  readonly mode: 'mock' | 'live'
  send(request: RosinaRequest, signal?: AbortSignal): Promise<RosinaResponse>
}
export function createMockRosinaAdapter(session: AuthSession | null, data?: FrontendAdapter): RosinaAdapter {
  return { mode: 'mock', async send({ message, history, currentRoute }) {
    const text = message.trim().toLowerCase()
    const reply = (reply: string, actions: unknown[] = []) => ({ reply, actions })
    if (session?.persona.id === 'whitfield' && /report|fever|school.day/.test(text)) {
      if (!/fever/.test(text)) return reply('What exactly should the school-day report say? I need your words before preparing a sample.')
      const now = Date.now()
      return { reply: 'Here is a sample school-day report to review. Nothing has been filed.', actions: [], schoolReportProposal: {
        id: 'sample-school-report-nora', version: 1, childId: 'p_nora', kind: 'fever', text: 'Nora has a fever today.',
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString(),
      } }
    }
    const routeParams = new URLSearchParams(currentRoute.split('?')[1] ?? '')
    let calendarChildId = routeParams.get('childId') ?? session?.scope.childId
    if (session && currentRoute.startsWith('#/calendar') && routeParams.has('event') && !routeParams.has('childId')) {
      try { calendarChildId = (await createMockCalendarAdapter(session.persona.personId).readEvent(routeParams.get('event')!)).child.id }
      catch { return reply('That event is not shared with you. I can only discuss records within your access.') }
    }
    if (/another family|other family|jax|nora/.test(text) && ((session?.scope.childId === 'p_jax' && /nora/.test(text)) || (session?.scope.childId === 'p_nora' && /jax/.test(text)) || /another family|other family/.test(text))) return reply("I can't show another family's child. I can only use information that has been shared with you.")
    if (/calendar|recital|check-in|field trip event/.test(text)) {
      if (!session) return reply('Choose a demo person first so I can open a calendar shared with them.')
      const calendar = createMockCalendarAdapter(session.persona.personId)
      const children = await calendar.listChildren()
      const namedChild = ['nora', 'jax', 'emma', 'malik'].find(name => new RegExp(`\\b${name}\\b`).test(text))
      const routeChild = new URLSearchParams(currentRoute.split('?')[1] ?? '').get('childId')
      const child = namedChild ? children.find(c => c.displayName.split(' ')[0].toLowerCase() === namedChild) : children.find(c => c.id === (routeChild ?? session.scope.childId))
      if (!child) return reply('That calendar is not shared with you. I can only open calendars within your own access.')
      const requestedDay = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
      if (requestedDay && !validDay(requestedDay)) return reply('Which date do you mean? That calendar date is not valid.')
      if (/recital|check-in|field trip event/.test(text)) {
        const data = await calendar.readCalendar({ childId: child.id, from: '2026-10-26', to: '2026-11-29' })
        const word = /recital/.test(text) ? 'recital' : /check-in/.test(text) ? 'check-in' : 'field trip'
        const matches = data.events.filter(event => event.title.toLowerCase().includes(word))
        if (matches.length !== 1) return reply(matches.length ? 'Which event do you mean? There is more than one matching event in this calendar.' : 'That event is not available in the calendar shared with you.')
        return reply(`You can open ${matches[0].title}. Its details come from the shared calendar.`, [{ id: 'open-event', args: { id: matches[0].id } }])
      }
      return reply(`Here is ${child.displayName.split(' ')[0]}'s shared calendar. It shows scheduled plans, not a confirmed location.`, [{ id: 'open-calendar', args: { day: requestedDay ?? localDay(Date.now()), childId: child.id } }])
    }
    if (/peanut|snack|care rule/.test(text)) {
      if (((currentRoute.startsWith('#/calendar') || currentRoute.startsWith('#/village')) && calendarChildId !== 'p_nora') || /\b(malik|emma|jax)\b/.test(text)) return reply("I can't confirm that yet. Care information for this child is not available in this view.")
      if (!session || (session.scope.childId !== 'p_nora') || (!session.persona.parent && !session.persona.grants.includes('careplan.read'))) return reply("I can't confirm that yet. I don't have care information available within your access.")
      return reply(`No, Nora has a peanut allergy. Her care plan says: '${noraCareInformation.text}' ${sourceCitation(noraCareInformation.source)}.`)
    }
    if (/what can i do/.test(text)) {
      if (!session) return reply('Choose a person to get started. What you can see depends on what their family has shared.')
      if (session.persona.guardian) return reply(`You can open ${session.scope.childName.split(' ')[0]}'s calendar through your guardian role. Other family records stay private.`, [{ id: 'open-calendar', args: { day: localDay(Date.now()), childId: session.scope.childId } }])
      if (session.persona.grants.includes('careplan.read')) return reply(`You can read ${session.scope.childName.split(' ')[0]}'s care information. You can also open their shared calendar.`, [{ id: 'open-screen', args: { screen: 'care-information' } }, { id: 'open-calendar', args: { day: localDay(Date.now()), childId: session.scope.childId } }])
      if (!session.persona.parent) return reply(`You can ask about ${session.scope.childName.split(' ')[0]}'s schedule and goals. You can open the shared calendar for scheduled plans; goals remain unavailable here. Pickup plans are shared with the child's parents.`, [{ id: 'explain-screen', args: { screen: 'mission-control' } }])
      return reply('You can review pickup plans, explore your village and prepare a pickup request. The screens show recorded information, and every change needs your confirmation.', [{ id: 'open-screen', args: { screen: 'village' } }, { id: 'open-screen', args: { screen: 'mission-control' } }])
    }
    if (/new to/.test(text)) return reply(session?.persona.parent ? 'Start with your own village. It shows the people and relationships shared with you.' : 'Start with what the family has shared with you. You can ask what your role includes before choosing a screen.', [{ id: 'open-screen', args: { screen: session?.persona.parent ? 'village' : session?.persona.grants.includes('careplan.read') ? 'care-information' : 'ask-rosina' } }])
    if (/recommend|caregiver/.test(text)) {
      if (!session || !data) return reply('Sign in to review the recorded recommendation.')
      try {
        const snapshot = await data.readMissionControl(session.scope)
        const candidate = snapshot.candidates.find(c => c.reasonCode === 'APPROVAL_PENDING' || c.reasonCode === 'RECOMMENDED')
        return candidate ? reply(`The detailed recommendation reason isn’t available here. ${candidate.name} is the recorded choice for this pickup. Their caregiver evaluation says: “${reasonLabel(candidate.reasonCode)}”. Parent approval is a separate decision. Source: the pickup plan.`, [{ id: 'explain-recommendation', args: {} }]) : reply('There is no recorded pickup choice to explain. No recommendation is available in your pickup plan.')
      } catch { return reply(`Pickup choices are shared with ${session.scope.childName.split(' ')[0]}'s parents. You can ask what information is shared with your role.`, [{ id: 'open-screen', args: { screen: 'ask-rosina' } }]) }
    }
    if (/afternoon/.test(text) && !/\d{4}-\d{2}-\d{2}/.test(text) && !history.some(m => m.role === 'assistant' && /Which date/.test(m.content))) {
      if (!session || session.scope.childId !== 'p_nora' || !session.persona.parent) return reply("The afternoon schedule isn't connected here yet. I won't fill in missing details.")
      try {
        const snapshot = await data?.readMissionControl(session.scope)
        const latest = snapshot?.coordinationJobs?.[0]
        return reply(latest ? `Nora's afternoon pickup: ${pickupStatusLabel(latest.status).toLowerCase()}. Her pickup plan records this status; it does not describe her whole afternoon. Source: Nora's pickup plan.` : 'There is no afternoon pickup status to show. No pickup plan is available here.', [{ id: 'open-screen', args: { screen: 'mission-control' } }])
      } catch { return reply("Pickup plans are shared with the child's parents. You can ask what information is shared with your role.") }
    }
    if (/arrange|pickup/.test(text) || history.some(m => m.role === 'assistant' && /Which date/.test(m.content))) {
      if (!session) return reply('Choose a demo person first so the request has a child and a permission context.')
      if (!session.persona.parent) return reply("A parent needs to request this pickup here. Pickup planning is shared with the child's parents; you can ask what your role includes.")
      const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0], window = text.match(/\b(morning|afternoon|evening)\b/)?.[0]
      if (!date || !window) return reply(`Which date (YYYY-MM-DD) and pickup window (morning, afternoon or evening) for ${session.scope.childName}?`)
      return reply('Review the details below. Nothing is submitted until you confirm in the app.', [{ id: 'start-pickup', args: { childId: session.scope.childId, date, window } }])
    }
    if (/open.*(person|card|tasha|loretta)/.test(text) && session && data) {
      try {
        const village = await data.readVillage(session.scope)
        const node = village.nodes.find(node => text.includes(node.person.displayName.split(' ')[0].toLowerCase()))
        return node ? reply('You can open this person’s card. They are shown in the village information shared with you.', [{ id: 'open-person', args: { personId: node.person.id } }]) : reply('That person’s card isn’t available here. Which person shown in your village would you like to open?')
      } catch { return reply("These person cards are shared with the child's parents. You can ask what information is shared with your role.") }
    }
    return reply("Which child or activity do you mean? I need that detail before I can answer.")
  } }
}
export function createServiceRosinaAdapter(getAccessToken: () => Promise<string | null>, request: typeof fetch = fetch): RosinaAdapter {
  return { mode: 'live', async send(input, signal) {
    // Temporary v1 boundary until coordination-v2 supplies the approved care-rule action.
    if (/peanut|snack|care rule/i.test(input.message)) return { reply: "I can't confirm that yet", actions: [] }
    const token = await getAccessToken()
    if (!token) throw new Error('UNAUTHENTICATED')
    const response = await request('/api/rosina', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error(response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'UNAUTHORIZED' : 'Rosina unavailable')
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || !('reply' in body) || typeof body.reply !== 'string' || !('actions' in body) || !Array.isArray(body.actions)) throw new Error('Invalid Rosina response')
    return { reply: body.reply, actions: body.actions }
  } }
}

export {createLiveRosinaAdapter} from './liveAdapter'
