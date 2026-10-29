/**
 * Internal village graph types.
 *
 * Shared types (VillageNode, VillageEdge, VillageData, ReasonCode, etc.)
 * come from @/lib/frontendData/types — only react-force-graph-2d node/link
 * shapes live here. fx/fy are set once, to pin the center person in place.
 */

/* ── Force-graph node/link (react-force-graph-2d) ───────── */

export type GraphNode = {
  id: string
  displayName: string
  initials: string
  role: string
  household: string | null
  isCenter: boolean
  x?: number
  y?: number
  fx?: number
  fy?: number
}

export type GraphLink = {
  // react-force-graph-2d/d3-force mutate `source`/`target` in place, from
  // the string ids below into live node object references, the first time
  // a link passes through the physics engine. Since link objects are
  // stable across re-renders (not recreated per search/filter change),
  // that mutation is permanent. `sourceId`/`targetId` are a stable copy
  // app code can always filter/compare against; never read `source`/
  // `target` back out for anything but handing to react-force-graph-2d.
  source: string
  target: string
  sourceId: string
  targetId: string
  relationshipType: string
  relationshipStatus: string
}
