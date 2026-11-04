import { gql } from '@apollo/client'
import type { createGraphClient } from './graphqlAdapter'

/** Alias repeated record reads in bounded GraphQL operations, without HTTP batching.
 * Values stay in variables; authorization still runs on every server field.
 */
export async function readJobRecords<A, T>(client: ReturnType<typeof createGraphClient>, ids: string[], runRead: <R>(read: () => Promise<R>) => Promise<R>, attempts: string, timeline: string) {
  const records = new Map<string, { attempts: A[]; timeline: T[] }>()
  // At most two chunks in flight; no unbounded per-row request fan-out.
  const chunks = Array.from({ length: Math.ceil(ids.length / 25) }, (_, i) => ids.slice(i * 25, (i + 1) * 25))
  let next = 0
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++]
      const variables = Object.fromEntries(chunk.map((id, i) => [`id${i}`, id]))
      const query = gql(`query WebStoredRecords(${chunk.map((_, i) => `$id${i}:ID!`).join(',')}) {
        ${chunk.map((_, i) => `a${i}:attempts(jobId:$id${i}){${attempts}} t${i}:jobTimeline(jobId:$id${i}){${timeline}}`).join('\n')}
      }`)
      const data = await runRead(async () => {
        const result = await client.query<Record<string, A[] | T[]>>({ query, variables, fetchPolicy: 'network-only' })
        if (!result.data) throw Error('READ_UNAVAILABLE')
        return result.data
      })
      chunk.forEach((id, i) => records.set(id, { attempts: data[`a${i}`] as A[], timeline: data[`t${i}`] as T[] }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, worker))
  return records
}
