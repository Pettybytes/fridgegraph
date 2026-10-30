import type { AuthSession } from '@/features/personas/auth'
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
    if (/another family|other family|jax|nora/.test(text) && ((session?.scope.childId === 'p_jax' && /nora/.test(text)) || (session?.scope.childId === 'p_nora' && /jax/.test(text)) || /another family|other family/.test(text))) return reply("I can only discuss a child within your signed-in access. I can't show another family's child or private information.")
    if (/peanut|snack|care rule/.test(text)) {
      if (!session || (session.scope.childId !== 'p_nora') || (!session.persona.parent && !session.persona.grants.includes('careplan.read'))) return reply("I can't confirm that yet. I don't have care information available within your access.")
      return reply("Nora's care information says: “Peanut allergy. Epi-pen in right backpack pocket.” Source: Nora's care plan, demo fixture (src/fixtures.ts). A peanut-butter snack conflicts with that recorded care information.")
    }
    if (/what can i do/.test(text)) return reply('You can explore your village, review recorded pickup activity, ask about this screen, and prepare a pickup request for confirmation.', [{ id: 'open-screen', args: { screen: 'village' } }, { id: 'explain-screen', args: { screen: 'mission-control' } }])
    if (/new to/.test(text)) return reply('Start with the people in your own village. Some screens may be unavailable with your current access; no private information from another family is shown.', [{ id: 'open-screen', args: { screen: 'village' } }])
    if (/recommend|caregiver/.test(text)) {
      if (!session || !data) return reply('Sign in to review the recorded recommendation.')
      try {
        const snapshot = await data.readMissionControl(session.scope)
        const candidate = snapshot.candidates.find(c => c.reasonCode === 'APPROVAL_PENDING' || c.reasonCode === 'RECOMMENDED')
        return candidate ? reply(`${candidate.name} has the recorded status ${candidate.reasonCode}. Source: Mission Control candidate evaluation (demo). Detailed ranking reasons are unavailable here. Candidate acceptance and parent approval are separate facts.`, [{ id: 'explain-recommendation', args: {} }]) : reply('No recommendation is recorded in your current view.')
      } catch { return reply("You don't have access to this recommendation.") }
    }
    if (/afternoon/.test(text) && !/\d{4}-\d{2}-\d{2}/.test(text) && !history.some(m => m.role === 'assistant' && /Which date/.test(m.content))) {
      if (!session || session.scope.childId !== 'p_nora' || !session.persona.parent) return reply("The afternoon schedule isn't connected here yet. I won't fill in missing details.")
      try {
        const snapshot = await data?.readMissionControl(session.scope)
        const latest = snapshot?.coordinationJobs?.[0]
        return reply(latest ? `Nora's recorded afternoon pickup status is ${latest.status}. Source: Mission Control demo job. This is a pickup record, not a complete afternoon calendar.` : 'No afternoon pickup status is available.', [{ id: 'open-screen', args: { screen: 'mission-control' } }])
      } catch { return reply("You don't have access to this pickup record.") }
    }
    if (/arrange|pickup/.test(text) || history.some(m => m.role === 'assistant' && /Which date/.test(m.content))) {
      if (!session) return reply('Choose a demo person first so the request has a child and a permission context.')
      if (!session.persona.parent) return reply("You don't have access to create a parent pickup request in this demo view.")
      const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0], window = text.match(/\b(morning|afternoon|evening)\b/)?.[0]
      if (!date || !window) return reply(`Which date (YYYY-MM-DD) and pickup window (morning, afternoon or evening) for ${session.scope.childName}?`)
      return reply('Review the details below. Nothing is submitted until you confirm in the app.', [{ id: 'start-pickup', args: { childId: session.scope.childId, date, window } }])
    }
    if (/open.*(person|card|tasha|loretta)/.test(text) && session && data) {
      try {
        const village = await data.readVillage(session.scope)
        const node = village.nodes.find(node => text.includes(node.person.displayName.split(' ')[0].toLowerCase()))
        return node ? reply('Open this person from your available village projection.', [{ id: 'open-person', args: { personId: node.person.id } }]) : reply('That person card is unavailable in your current village projection. Which person shown here would you like to open?')
      } catch { return reply("You don't have access to these person cards.") }
    }
    return reply("Can you say which child or recorded activity you mean? I won't guess missing details.")
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
