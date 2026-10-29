/**
 * Internal village graph types.
 *
 * Shared types (VillageNode, VillageEdge, VillageData, ReasonCode, etc.)
 * come from @/lib/frontendData/types — only force-graph internals live here.
 */

import type { ReasonCode } from '@/lib/frontendData/types'

/* ── Internal force-graph node ──────────────────────────── */

export type GraphNode = {
  id: string
  displayName: string
  initials: string
  role: string
  household: string | null
  highlight: ReasonCode | null
  isCenter: boolean
  x?: number
  y?: number
  fx?: number
  fy?: number
  vx?: number
  vy?: number
}

export type GraphLink = {
  source: string
  target: string
  relationshipType: string
  relationshipStatus: string
}
