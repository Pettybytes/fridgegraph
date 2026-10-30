import type { AuthSession } from '@/features/personas/auth'
import { noraCareInformation, sourceCitation } from '@/features/personas/careInformation'
import { pickupStatusLabel } from '@/lib/frontendData/displayCopy'
import { reasonLabel } from '@/lib/frontendData/types'
import type { FrontendAdapter } from '@/lib/frontendData/types'
export type HistoryMessage = { role: 'user' | 'assistant'; content: string }
export type RosinaRequest = { message: string; currentRoute: string; history: HistoryMessage[] }
export type RosinaResponse = { reply: string; actions: unknown[] }
export interface RosinaAdapter {
  readonly mode: 'mock' | 'live'
  send(request: RosinaRequest, signal?: AbortSignal): Promise<RosinaResponse>
}
export function createMockRosinaAdapter(session: AuthSession | null, data?: FrontendAdapter): RosinaAdapter {
  return { mode: 'mock', async send({ message, history }) {
    const text = message.trim().toLowerCase()
    const reply = (reply: string, actions: unknown[] = []) => ({ reply, actions })
    if (/another family|other family|jax|nora/.test(text) && ((session?.scope.childId === 'p_jax' && /nora/.test(text)) || (session?.scope.childId === 'p_nora' && /jax/.test(text)) || /another family|other family/.test(text))) return reply("I can't show another family's child. I can only use information that has been shared with you.")
    if (/peanut|snack|care rule/.test(text)) {
      if (!session || (session.scope.childId !== 'p_nora') || (!session.persona.parent && !session.persona.grants.includes('careplan.read'))) return reply("I can't confirm that yet. I don't have care information available within your access.")
      return reply(`No, Nora has a peanut allergy. Her care plan says: '${noraCareInformation.text}' ${sourceCitation(noraCareInformation.source)}.`)
    }
    if (/what can i do/.test(text)) {
      if (!session) return reply('Choose a person to get started. What you can see depends on what their family has shared.')
      if (session.persona.grants.includes('careplan.read')) return reply(`You can read ${session.scope.childName.split(' ')[0]}'s care information. Their schedule is also shared with you, but the schedule screen isn't available here yet.`, [{ id: 'open-screen', args: { screen: 'care-information' } }])
      if (!session.persona.parent) return reply(`You can ask about ${session.scope.childName.split(' ')[0]}'s schedule and goals. Their screens aren't available here yet. Pickup plans are shared with the child's parents.`, [{ id: 'explain-screen', args: { screen: 'mission-control' } }])
      return reply('You can review pickup plans, explore your village and prepare a pickup request. The screens show recorded information, and every change needs your confirmation.', [{ id: 'open-screen', args: { screen: 'village' } }, { id: 'open-screen', args: { screen: 'mission-control' } }])
    }
    if (/new to/.test(text)) return reply(session?.persona.parent ? 'Start with your own village. It shows the people and relationships shared with you.' : 'Start with what the family has shared with you. You can ask what your role includes before choosing a screen.', [{ id: 'open-screen', args: { screen: session?.persona.parent ? 'village' : session?.persona.grants.includes('careplan.read') ? 'care-information' : 'ask-rosina' } }])
    if (/recommend|caregiver/.test(text)) {
      if (!session || !data) return reply('Sign in to review the recorded recommendation.')
      try {
        const snapshot = await data.readMissionControl(session.scope)
        const candidate = snapshot.candidates.find(c => c.reasonCode === 'APPROVAL_PENDING' || c.reasonCode === 'RECOMMENDED')
        return candidate ? reply(`The detailed recommendation reason isn’t available here. ${candidate.name} is the recorded choice for this pickup. Their caregiver evaluation says: “${reasonLabel(candidate.reasonCode)}”. Parent approval is recorded separately. Source: the pickup plan.`, [{ id: 'explain-recommendation', args: {} }]) : reply('There is no recorded pickup choice to explain. No recommendation is available in your pickup plan.')
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
