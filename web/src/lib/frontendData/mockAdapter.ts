import fixture from './mock-data.json'
import villageMock from '../../../../docs/mocks/living-village.json'
import type { FrontendAdapter, MissionControlData, Scope, VillageData } from './types'
export const demoScope: Scope = fixture.scope
// Copy only the graph fields the screen needs, including nested objects.
export function projectVillage(source: VillageData): VillageData {
  return {
    nodes: source.nodes.map(node => ({
      person: { id: node.person.id, displayName: node.person.displayName },
      household: node.household ? { id: node.household.id } : null,
      role: node.role,
    })),
    edges: source.edges.map(edge => ({
      from: { id: edge.from.id },
      to: { id: edge.to.id },
      relationship: { id: edge.relationship.id, type: edge.relationship.type, status: edge.relationship.status },
    })),
  }
}
export function createMockAdapter(): FrontendAdapter & { readParentChat(scope: Scope): Promise<import('./types').ParentChatData> } {
  function assertScope(scope: Scope) {
    if (scope.childId !== demoScope.childId || scope.villageId !== demoScope.villageId) {
      throw new Error('UNAUTHORIZED')
    }
  }
  return {
    mode: 'mock',
    async readVillage(scope) {
      assertScope(scope)
      return projectVillage(villageMock.data.villageGraph)
    },
    async readMissionControl(scope) {
      assertScope(scope)
      return structuredClone(fixture.missionControl) as MissionControlData
    },
    async readParentChat(scope) {
      assertScope(scope)
      return structuredClone(fixture.parentChat)
    },
  }
}
