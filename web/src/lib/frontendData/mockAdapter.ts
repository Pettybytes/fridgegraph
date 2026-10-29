import fixture from './mock-data.json'
import type { FrontendAdapter, MissionControlData, Scope } from './types'
export const demoScope: Scope = fixture.scope
export function createMockAdapter(): FrontendAdapter {
  function assertScope(scope: Scope) {
    if (scope.childId !== demoScope.childId || scope.villageId !== demoScope.villageId) {
      throw new Error('UNAUTHORIZED')
    }
  }
  return {
    mode: 'mock',
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
