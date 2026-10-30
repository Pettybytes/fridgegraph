import { useEffect } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { useSession } from './Session'
export function ApolloSessionCleanup({ clearAdapter }: { clearAdapter?: () => Promise<unknown> }) {
  const client = useApolloClient()
  const { registerPrivateCleanup } = useSession()
  useEffect(() => registerPrivateCleanup(() => Promise.all([client.clearStore(), clearAdapter?.()])), [client, clearAdapter, registerPrivateCleanup])
  return null
}
