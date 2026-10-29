import { readFileSync, writeFileSync } from 'node:fs'
const sourceRoot = new URL('../../docs/mocks/', import.meta.url)
const read = name => JSON.parse(readFileSync(new URL(name, sourceRoot), 'utf8'))
const candidates = read('pickup-candidates.json')
const chat = read('parent-chat.json')
const mission = read('mission-control.json')
const lifecycle = read('pickup-job-lifecycle.json')
const village = read('living-village.json')
const evaluations = new Map(candidates._demoCandidateEvaluations.evaluations.map(item => [item.person.id, item]))
// The static mock's authorized list remains four. Never join by array position: the new
// illustrative PENDING row has an unmatched ID, and must not become an extra dispatched person.
const projectedCandidates = candidates.data.pickupCandidates.map(({ person }) => {
  const evaluation = evaluations.get(person.id)
  if (!evaluation) throw new Error(`Missing approved evaluation for ${person.id}`)
  return { id: person.id, name: person.displayName, channel: person.contactMethods.find(method => method.preferred)?.channel ?? person.contactMethods[0]?.channel,
    reasonCode: evaluation.reasonCode, distanceMiles: evaluation.distanceMiles ?? null,
    estimatedRideCostUsd: evaluation.estimatedRideCostUsd ?? null, costBasis: evaluation.costBasis ?? null }
})
const alt = lifecycle.overLimitPath
const data = {
  scope: { childId: chat.variables.childId, childName: village.data.villageGraph.nodes.find(node => node.person.id === chat.variables.childId).person.displayName,
    parentName: village.data.villageGraph.nodes.find(node => node.person.id === 'p_mom').person.displayName.split(' ')[0], villageId: village.variables.villageId },
  missionControl: { candidates: projectedCandidates, events: mission.feed.map(event => ({
    id: event.id, job: { id: event.job.id, idempotencyKey: event.job.idempotencyKey, status: event.job.status, version: event.job.version },
    stage: event.stage, kind: event.kind, summary: event.summary, at: event.at, ...(event.label ? { label: event.label } : {}),
  })) },
  parentChat: { messages: chat.data.chatThread.map(message => ({ id: message.id, from: message.from, kind: message.kind,
    text: message.text?.replaceAll('ride-cost cap', 'travel limit').replaceAll('ride-cost policy', 'travel limit') ?? null,
    at: message.at, relatedInformationRequestId: message.relatedInformationRequestId, relatedJobId: message.relatedJobId, hasVoiceNote: !!message.voiceNoteUrl,
  })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) },
  overLimitPath: { jobStatus: alt.jobStatus, overLimitCandidate: { id: alt.overLimitCandidate.id, displayName: alt.overLimitCandidate.displayName },
    reasonCode: alt.reasonCode, distanceMiles: alt.distanceMiles, estimatedRideCostUsd: alt.estimatedRideCostUsd, costBasis: alt.costBasis,
    implicitApproval: { acceptOverLimit: alt.implicitApproval.acceptOverLimit, result: alt.implicitApproval.result, confirmationWritten: alt.implicitApproval.confirmationWritten },
    explicitApproval: { acceptOverLimit: alt.explicitApproval.acceptOverLimit, result: alt.explicitApproval.result,
      confirmation: { candidateId: alt.explicitApproval.confirmation.candidateId, approvedBy: alt.explicitApproval.confirmation.approvedBy, overLimitApproved: alt.explicitApproval.confirmation.overLimitApproved } },
  },
}
writeFileSync(new URL('../src/lib/frontendData/mock-data.json', import.meta.url), JSON.stringify(data, null, 2) + '\n')
console.log(`Synced ${projectedCandidates.length} authorized candidates, ${mission.feed.length} recorded events and the over-limit path; private location/contact fields omitted.`)
