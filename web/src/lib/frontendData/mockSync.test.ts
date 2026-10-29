import { expect, it } from 'vitest'
import candidates from '../../../../docs/mocks/pickup-candidates.json'
import lifecycle from '../../../../docs/mocks/pickup-job-lifecycle.json'
import fixture from './mock-data.json'
it('keeps authorized candidates joined by ID and preserves source costBasis verbatim', () => {
  expect(fixture.missionControl.candidates.map(item => item.id)).toEqual(candidates.data.pickupCandidates.map(item => item.person.id))
  for (const item of fixture.missionControl.candidates) {
    const source = candidates._demoCandidateEvaluations.evaluations.find(row => row.person.id === item.id)!
    expect(item.reasonCode).toBe(source.reasonCode)
    expect(item.costBasis).toBe('costBasis' in source ? source.costBasis : null)
    expect(item.estimatedRideCostUsd).toBe('estimatedRideCostUsd' in source ? source.estimatedRideCostUsd : null)
  }
  expect(fixture.overLimitPath).toMatchObject({ overLimitCandidate: lifecycle.overLimitPath.overLimitCandidate, costBasis: lifecycle.overLimitPath.costBasis, explicitApproval: lifecycle.overLimitPath.explicitApproval })
  expect(JSON.stringify(fixture)).not.toMatch(/"(?:lat|lng|origin|address|contactMethods|voiceNoteUrl)"/)
})
