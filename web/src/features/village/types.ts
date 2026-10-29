/**
 * Village graph types — matches the client-assembled shape
 * described in frontend-data.md §3 and docs/mocks/living-village.json.
 *
 * Field names are verbatim from the contract. Never rename a field.
 */

import type { ReasonCode } from '@/lib/frontendData/types'

/* ── Node ───────────────────────────────────────────────── */

export type VillagePerson = {
  id: string
  displayName: string
}

export type VillageHousehold = {
  id: string
}

export type VillageNode = {
  person: VillagePerson
  household: VillageHousehold | null
  role: string // 'child' | 'parent' | 'adult'
}

/* ── Edge ───────────────────────────────────────────────── */

export type VillageRelationship = {
  id: string
  type: string
  status: string // 'ACTIVE' | 'PENDING' | …
}

export type VillageEdge = {
  from: { id: string }
  to: { id: string }
  relationship: VillageRelationship
}

/* ── Assembled graph (§3 mock shape) ────────────────────── */

export type VillageGraphData = {
  nodes: VillageNode[]
  edges: VillageEdge[]
}

/* ── Highlight overlay from active job state ────────────── */

export type PersonHighlight = {
  reasonCode: ReasonCode
}

/* ── Component props ────────────────────────────────────── */

export type LivingVillageProps = {
  /** Assembled village graph — nodes + edges. */
  data?: VillageGraphData
  /** Per-person highlight driven by the coordination job state. */
  highlights?: Record<string, PersonHighlight>
  /** ID of the center person (default: first child node). */
  centerId?: string
}

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
