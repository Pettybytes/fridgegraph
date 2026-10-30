import type { ReactNode } from 'react'
export function AccessEmptyState({ children }: { children?: ReactNode }) {
  return <section className="route-slot" role="alert"><h2>This information is private</h2>{children ?? <><p>This information hasn’t been shared with your account. Each family chooses what to share.</p><a href="#/mission-control">Return to your village</a></>}</section>
}
