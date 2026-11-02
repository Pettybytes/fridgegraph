import { describe, expect, it, vi } from 'vitest'
import type { ApolloClient } from '@apollo/client'
import { CONFIRM_SCHOOL_DAY_REPORT, createLiveSchoolReportConfirm, type SchoolReportProposal } from './schoolReport'

const proposal:SchoolReportProposal={id:'srp_1',version:3,childId:'p_nora',kind:'fever',text:'Nora has a fever today.',createdAt:'2026-11-01T20:00:00Z',expiresAt:'2026-11-01T20:10:00Z'}
const report={id:'sr_1',child:{id:'p_nora'},kind:'fever',text:proposal.text,at:'2026-11-01',reportedAt:'2026-11-01T20:03:00Z'}
describe('authenticated school report confirmation transport',()=>{
 it('uses only the direct GraphQL confirm mutation with the exact proposal id and version',async()=>{
  const mutate=vi.fn().mockResolvedValue({data:{confirmSchoolDayReport:report}})
  const confirm=createLiveSchoolReportConfirm({mutate} as unknown as ApolloClient)
  expect(mutate).not.toHaveBeenCalled()
  expect(await confirm(proposal)).toEqual(report)
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(mutate.mock.calls[0][0]).toMatchObject({mutation:CONFIRM_SCHOOL_DAY_REPORT,variables:{proposalId:'srp_1',version:3},fetchPolicy:'no-cache'})
 })
 it('never replays a failed mutation and refuses a mismatched child response',async()=>{
  const mutate=vi.fn().mockRejectedValueOnce({errors:[{extensions:{code:'PROPOSAL_STALE'}}]}).mockResolvedValueOnce({data:{confirmSchoolDayReport:{...report,child:{id:'p_jax'}}}})
  const confirm=createLiveSchoolReportConfirm({mutate} as unknown as ApolloClient)
  await expect(confirm(proposal)).rejects.toMatchObject({errors:[{extensions:{code:'PROPOSAL_STALE'}}]})
  expect(mutate).toHaveBeenCalledTimes(1)
  await expect(confirm(proposal)).rejects.toThrow('Invalid report response')
  expect(mutate).toHaveBeenCalledTimes(2)
  expect(mutate.mock.calls.map(call=>call[0].variables)).toEqual([{proposalId:'srp_1',version:3},{proposalId:'srp_1',version:3}])
 })
 it('does not claim success when a response changes the reviewed report text',async()=>{
  const mutate=vi.fn().mockResolvedValue({data:{confirmSchoolDayReport:{...report,text:'Different report'}}})
  await expect(createLiveSchoolReportConfirm({mutate} as unknown as ApolloClient)(proposal)).rejects.toThrow('Invalid report response')
  expect(mutate).toHaveBeenCalledTimes(1)
 })
})
