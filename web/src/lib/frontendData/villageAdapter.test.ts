import { describe, expect, it } from 'vitest'
import source from '../../../../docs/mocks/living-village.json'
import { createMockAdapter, demoScope, projectVillage } from './mockAdapter'

describe('village adapter', () => {
  it('projects the approved eight nodes and seven relationship edges', async () => {
    const village = await createMockAdapter().readVillage(demoScope)
    expect(village).toEqual(source.data.villageGraph)
    expect(village.nodes).toHaveLength(8)
    expect(village.edges).toHaveLength(7)
    expect(village.nodes.find(node => node.person.id === 'p_gma')?.household).toBeNull()
  })
  it.each([
    { ...demoScope, childId: 'other' },
    { ...demoScope, villageId: 'other' },
  ])('rejects unauthorized child or village scope: %j', async scope => {
    await expect(createMockAdapter().readVillage(scope)).rejects.toThrow('UNAUTHORIZED')
  })
  it('whitelists graph fields even when input contains private location or contact fields', () => {
    const enriched = {
      ...source.data.villageGraph,
      address: 'private',
      nodes: source.data.villageGraph.nodes.map(node => ({
        ...node,
        lat: 0, lng: 0,
        person: { ...node.person, address: 'private', contactMethods: [{ value: 'private' }] },
        household: node.household ? { ...node.household, coordinates: [0, 0] } : null,
      })),
      edges: source.data.villageGraph.edges.map(edge => ({
        ...edge, contact: 'private', relationship: { ...edge.relationship, address: 'private' },
      })),
    }
    expect(projectVillage(enriched)).toEqual(source.data.villageGraph)
    expect(JSON.stringify(projectVillage(enriched))).not.toMatch(/"(?:lat|lng|address|coordinates|contactMethods|value|contact)"/)
  })
  it('returns independent graph objects on every read', async () => {
    const adapter = createMockAdapter()
    const first = await adapter.readVillage(demoScope)
    first.nodes[0].person.displayName = 'changed'
    first.edges[0].relationship.status = 'changed'
    expect(await adapter.readVillage(demoScope)).toEqual(source.data.villageGraph)
  })
})
