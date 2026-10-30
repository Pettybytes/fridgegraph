import { describe, expect, it } from 'vitest'
import { actionAllowed, actionRoute, catalog, validateActions } from './catalog'
describe('Rosina catalog authority', () => {
  it('drops unknown ids, arbitrary routes, extra args and invalid values', () => {
    expect(validateActions([
      { id: 'future-v2', args: {} }, { id: '__proto__', args: {} },
      { id: 'open-screen', args: { screen: 'https://outside.example' } },
      { id: 'open-screen', args: { screen: 'village', url: 'https://outside.example' } },
      { id: 'open-person', args: { personId: '../private' } },
      { id: 'start-pickup', args: { childId: 'p_nora', date: '2026-02-30', window: 'afternoon' } },
    ])).toEqual([])
  })
  it('drops an unimplemented action, even when the response claims it is implemented', () => {
    catalog['open-screen'].implemented = false
    try { expect(validateActions([{ id: 'open-screen', args: { screen: 'village' }, implemented: true }])).toEqual([]) }
    finally { catalog['open-screen'].implemented = true }
  })
  it('builds its own routes and ignores model-written links and confirmation claims', () => {
    const [action] = validateActions([{ id: 'open-screen', args: { screen: 'village' }, url: 'https://outside.example' }])
    expect(actionRoute(action)).toBe('#/village')
    const [pickup] = validateActions([{ id: 'start-pickup', args: { childId: 'p_nora', date: '2026-10-30', window: 'afternoon' }, requiresConfirmation: false }])
    expect(catalog[pickup.id].changesData).toBe(true)
  })
  it('checks child scope and visible person membership independently of args validity', () => {
    const context = { childId: 'p_nora', parent: true, visiblePeople: new Set(['p_tasha']) }
    expect(actionAllowed({ id: 'open-person', args: { personId: 'p_jax' } }, context)).toBe(false)
    expect(actionAllowed({ id: 'start-pickup', args: { childId: 'p_jax', date: '2026-10-30', window: 'morning' } }, context)).toBe(false)
    expect(actionAllowed({ id: 'open-person', args: { personId: 'p_tasha' } }, context)).toBe(true)
  })
})
