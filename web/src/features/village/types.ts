/**
 * Internal village graph types.
 *
 * Shared types (VillageNode, VillageEdge, VillageData, ReasonCode, etc.)
 * come from @/lib/frontendData/types — only react-force-graph-2d node/link
 * shapes live here. fx/fy are set once, to pin the center person in place.
 */

import type { ReasonCode } from '@/lib/frontendData/types'

/* ── Force-graph node/link (react-force-graph-2d) ───────── */

export type GraphNode = {
  id: string
  displayName: string
  initials: string
  role: string
  household: string | null
  highlight: ReasonCode | null
  isCenter: boolean
  fx?: number
  fy?: number
}

export type GraphLink = {
  source: string
  target: string
  relationshipType: string
  relationshipStatus: string
}
