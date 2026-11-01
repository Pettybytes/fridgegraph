import {expect,it,vi} from 'vitest'
import {readSchoolReports} from './schoolReports'
import type {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
const runRead=<T,>(read:()=>Promise<T>)=>read()
it('uses the date-only read only when reportedAt is absent from the GraphQL schema',async()=>{
 const query=vi.fn().mockRejectedValueOnce(Error('Cannot query field "reportedAt" on type "SchoolReport".')).mockResolvedValueOnce({data:{schoolReports:[{id:'school-1',kind:'health',text:'Rested today',at:'2026-11-01'}]}})
 const reports=await readSchoolReports({query} as unknown as ReturnType<typeof createGraphClient>,'p_nora',runRead)
 expect(query).toHaveBeenCalledTimes(2);expect(reports[0].reportedAt).toBeUndefined();expect(reports[0].at).toBe('2026-11-01')
})
it('recognizes a missing-field validation response wrapped in HTTP 400',async()=>{
 const query=vi.fn().mockRejectedValueOnce(Object.assign(Error('Response not successful: Received status code 400'),{bodyText:'{\"errors\":[{\"message\":\"Cannot query field \\\"reportedAt\\\" on type \\\"SchoolReport\\\".\"}]}'})).mockResolvedValueOnce({data:{schoolReports:[]}})
 await expect(readSchoolReports({query} as unknown as ReturnType<typeof createGraphClient>,'p_nora',runRead)).resolves.toEqual([])
 expect(query).toHaveBeenCalledTimes(2)
})
it('does not turn a real school read failure into an empty result',async()=>{
 const query=vi.fn().mockRejectedValue(Error('UNAUTHORIZED'))
 await expect(readSchoolReports({query} as unknown as ReturnType<typeof createGraphClient>,'p_nora',runRead)).rejects.toThrow('UNAUTHORIZED')
 expect(query).toHaveBeenCalledTimes(1)
})
