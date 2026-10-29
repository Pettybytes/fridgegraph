import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d'
import ForceGraph2D from 'react-force-graph-2d'
import { AnimatePresence } from 'motion/react'
import type { GraphNode, GraphLink } from './types'
import { useSurfaceData, useDataContext, dataErrorMessage } from '@/lib/frontendData/provider'
import { reasonLabel } from '@/lib/frontendData/types'
import type { ReasonCode, VillageData, MissionControlData } from '@/lib/frontendData/types'
import { PersonCard } from './PersonCard'
import './village.css'

/* ── helpers ────────────────────────────────────────────── */

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const ROLE_PLURAL: Record<string, string> = { child: 'Children', parent: 'Parents', adult: 'Adults' }

function rolePlural(role: string): string {
  return ROLE_PLURAL[role] ?? `${role.charAt(0).toUpperCase() + role.slice(1)}s`
}

function toGraph(
  data: VillageData,
  centerId: string,
  knownPositions: Record<string, { x: number; y: number }>,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const others = data.nodes.filter(n => n.person.id !== centerId)
  const nodes: GraphNode[] = data.nodes.map(n => {
    const isCenter = n.person.id === centerId
    const known = knownPositions[n.person.id]
    // Seed a node's first-ever position on a ring around the center so it
    // appears in frame immediately, instead of wherever d3-force's default
    // initializer happens to drop it (which can be far outside the canvas
    // once a node re-enters the simulation after being filtered out).
    const idx = others.findIndex(o => o.person.id === n.person.id)
    const angle = others.length ? (idx / others.length) * Math.PI * 2 : 0
    const seed = known ?? { x: Math.cos(angle) * 160, y: Math.sin(angle) * 160 }
    return {
      id: n.person.id,
      displayName: n.person.displayName,
      initials: initials(n.person.displayName),
      role: n.role,
      household: n.household?.id ?? null,
      isCenter,
      x: isCenter ? 0 : seed.x,
      y: isCenter ? 0 : seed.y,
      // Pin the center person at the graph origin — react-force-graph-2d
      // renders graph-space (0,0) at the canvas's visual center by default.
      ...(isCenter ? { fx: 0, fy: 0 } : {}),
    }
  })

  const links: GraphLink[] = data.edges.map(e => ({
    source: e.from.id,
    target: e.to.id,
    sourceId: e.from.id,
    targetId: e.to.id,
    relationshipType: e.relationship.type,
    relationshipStatus: e.relationship.status,
  }))

  return { nodes, links }
}

/* ── highlight colors ───────────────────────────────────── */

const HIGHLIGHT_RING: Record<ReasonCode, string> = {
  RECOMMENDED: '#3d9e7a',
  APPROVAL_PENDING: '#d4a037',
  PENDING: '#d4a037',
  OVER_POLICY: '#c05e5e',
  UNAVAILABLE: '#94a1b5',
  UNREACHABLE: '#94a1b5',
  NO_VERIFIED_CONTACT_METHOD: '#94a1b5',
  AVAILABLE_NO_TRANSPORT: '#8fa2ba',
  UNAUTHORIZED: '#94a1b5',
}

const HIGHLIGHT_GLOW: Record<ReasonCode, string> = {
  RECOMMENDED: 'rgba(61,158,122,0.35)',
  APPROVAL_PENDING: 'rgba(212,160,55,0.30)',
  PENDING: 'rgba(212,160,55,0.30)',
  OVER_POLICY: 'rgba(192,94,94,0.25)',
  UNAVAILABLE: 'rgba(148,161,181,0.15)',
  UNREACHABLE: 'rgba(148,161,181,0.15)',
  NO_VERIFIED_CONTACT_METHOD: 'rgba(148,161,181,0.15)',
  AVAILABLE_NO_TRANSPORT: 'rgba(143,162,186,0.15)',
  UNAUTHORIZED: 'rgba(148,161,181,0.15)',
}

const ROLE_FILL: Record<string, string> = {
  child: '#7559a1',
  parent: '#3a506b',
  adult: '#8b6e4e',
}

const BASE_RADIUS = 22

function nodeRadius(node: GraphNode): number {
  return node.isCenter ? BASE_RADIUS + 6 : BASE_RADIUS
}

/* ── main component ─────────────────────────────────────── */

export function LivingVillage() {
  const { scope } = useDataContext()
  const { data: villageResult, loading: villageLoading, error: villageError } = useSurfaceData<VillageData>('village')
  const { data: mcResult } = useSurfaceData<MissionControlData>('mission-control')

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const forcesConfigured = useRef(false)
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({})

  const data = villageResult?.frontendSnapshot ?? null

  // Derive highlights from mission-control candidates — same shared
  // adapter, a different surface. Not a second data provider.
  const highlights = useMemo(() => {
    const map: Record<string, ReasonCode> = {}
    const candidates = mcResult?.frontendSnapshot?.candidates
    if (candidates) {
      for (const c of candidates) {
        map[c.id] = c.reasonCode
      }
    }
    return map
  }, [mcResult])

  // The village is centered on the scoped child, not on whichever
  // "child"-role node happens to come first in the graph.
  const centerId = scope.childId

  // Deliberately NOT keyed on `highlights`: mission-control polls every
  // 2.5s, and react-force-graph-2d fully re-heats its physics (alpha=1,
  // fresh cooldown) on every graphData identity change. With only the
  // center node pinned, repeated reheats compound outward each poll and
  // the layout never settles. nodeCanvasObject reads `highlights` live
  // via closure at paint time instead (safe: changing that prop only
  // repaints, per the library's triggerUpdate:false for it).
  const graph = useMemo(() => {
    if (!data) return { nodes: [], links: [] }
    return toGraph(data, centerId, positionsRef.current)
  }, [data, centerId])

  // Filter
  const filtered = useMemo(() => {
    let nodes = graph.nodes
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      nodes = nodes.filter(n => n.displayName.toLowerCase().includes(q))
    }
    if (roleFilter) {
      nodes = nodes.filter(n => n.role === roleFilter)
    }
    const nodeIds = new Set(nodes.map(n => n.id))
    const links = graph.links.filter(l => nodeIds.has(l.sourceId) && nodeIds.has(l.targetId))
    return { nodes, links }
  }, [graph, search, roleFilter])

  // Record live positions every tick so a node that's later filtered out
  // and back in re-seeds from where it last was, not from scratch.
  const handleEngineTick = useCallback(() => {
    for (const n of filtered.nodes) {
      if (typeof n.x === 'number' && typeof n.y === 'number') {
        positionsRef.current[n.id] = { x: n.x, y: n.y }
      }
    }
  }, [filtered])

  // Clear selection if the selected person drops out of the filtered set
  useEffect(() => {
    if (selected && !filtered.nodes.some(n => n.id === selected.id)) {
      setSelected(null)
    }
  }, [filtered, selected])

  // Find the edge between the selected person and the center
  const selectedEdge = useMemo(() => {
    if (!selected || !data) return null
    return data.edges.find(
      e => (e.from.id === selected.id && e.to.id === centerId) ||
           (e.to.id === selected.id && e.from.id === centerId)
    ) ?? null
  }, [selected, data, centerId])

  // Measure the canvas container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function measure() {
      if (!el) return
      const rect = el.getBoundingClientRect()
      setDimensions({ width: rect.width, height: rect.height })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // The ref only attaches once `data` has loaded and the real
    // container (not the loading/error placeholder) is in the tree.
  }, [data])

  // Give the layout an organic, wider spread. Keep a very weak centering
  // force as a safety net — e.g. if search narrows to a single person who
  // isn't the pinned center, nothing else is left to keep them in frame.
  useEffect(() => {
    const fg = fgRef.current
    // Depends on `dimensions` too: ForceGraph2D only mounts (and attaches
    // fgRef) once the container has been measured, which happens in a
    // later render than the one where `filtered` first becomes non-empty.
    if (!fg || forcesConfigured.current) return
    const center = fg.d3Force('center')
    if (center && 'strength' in center) (center as unknown as { strength: (s: number) => void }).strength(0.08)
    const charge = fg.d3Force('charge')
    // Kept moderate on purpose: every graphData change (including a
    // search/filter edit) makes the library reheat to alpha=1 from
    // whichever positions the nodes already hold. A strong charge with
    // ~28 pairwise repulsions (8 nodes) compounds on each reheat faster
    // than the weak safety-net center force can pull back, and the
    // layout diverges off-canvas within a couple of reheats. This value
    // was tuned empirically to stay stable across repeated reheats.
    if (charge) charge.strength(-90)
    const link = fg.d3Force('link')
    if (link && 'distance' in link) (link as unknown as { distance: (d: number) => void }).distance(140)
    forcesConfigured.current = true
    // The engine already ticked a few frames under the default (weak)
    // charge before this ran; reheat so the new forces actually move nodes.
    fg.d3ReheatSimulation()
  }, [filtered, dimensions.width, dimensions.height])

  const handleNodeClick = useCallback((node: NodeObject<GraphNode>) => {
    setSelected(prev => (prev?.id === node.id ? null : (node as GraphNode)))
  }, [])

  const nodeCanvasObject = useCallback((node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D) => {
    const n = node as GraphNode & { x?: number; y?: number }
    const nx = n.x ?? 0
    const ny = n.y ?? 0
    const r = nodeRadius(n)
    const fill = ROLE_FILL[n.role] ?? '#657086'
    // Looked up live (not embedded on the node) so highlight updates don't
    // perturb the physics graphData identity — see toGraph(). Changing
    // this callback's identity only repaints (triggerUpdate: false in the
    // underlying library for nodeCanvasObject), it doesn't reheat physics.
    const highlight = highlights[n.id] ?? null

    if (highlight) {
      ctx.beginPath()
      ctx.arc(nx, ny, r + 10, 0, Math.PI * 2)
      ctx.fillStyle = HIGHLIGHT_GLOW[highlight]
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(nx, ny, r + 3, 0, Math.PI * 2)
    ctx.fillStyle = highlight ? HIGHLIGHT_RING[highlight] : '#e0dae8'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(nx, ny, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()

    ctx.fillStyle = '#fff'
    ctx.font = `600 ${n.isCenter ? 14 : 12}px 'Geist Variable', sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(n.initials, nx, ny + 1)

    ctx.fillStyle = '#3e4a5e'
    ctx.font = `500 ${n.isCenter ? 13 : 11}px 'Geist Variable', sans-serif`
    ctx.fillText(n.displayName, nx, ny + r + 16)

    if (highlight) {
      const label = reasonLabel(highlight)
      ctx.font = '600 9px sans-serif'
      const tw = ctx.measureText(label).width
      const bx = nx - tw / 2 - 6
      const by = ny - r - 18
      ctx.fillStyle = HIGHLIGHT_RING[highlight]
      roundRect(ctx, bx, by, tw + 12, 16, 4)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(label, nx, by + 8)
    }
  }, [highlights])

  const nodePointerAreaPaint = useCallback((node: NodeObject<GraphNode>, color: string, ctx: CanvasRenderingContext2D) => {
    const n = node as GraphNode & { x?: number; y?: number }
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(n.x ?? 0, n.y ?? 0, nodeRadius(n) + 3, 0, Math.PI * 2)
    ctx.fill()
  }, [])

  const linkColor = useCallback((link: GraphLink) =>
    link.relationshipStatus === 'ACTIVE' ? 'rgba(117,89,161,0.3)' : 'rgba(117,89,161,0.14)', [])

  // Available roles for filter
  const roles = useMemo(() => {
    if (!data) return []
    const set = new Set(data.nodes.map(n => n.role))
    return Array.from(set).sort()
  }, [data])

  // Loading state
  if (villageLoading && !data) {
    return (
      <div className="village-empty" role="status" data-testid="living-village-loading">
        <div className="village-loading-ring" />
        <p>Loading the village…</p>
      </div>
    )
  }

  // Error state
  if (villageError) {
    return (
      <div className="village-empty village-error" role="alert" data-testid="living-village-error">
        <p>{dataErrorMessage(villageError)}</p>
      </div>
    )
  }

  // No data
  if (!data) {
    return (
      <div className="village-empty" role="status">
        <p>The village graph will appear here once data is available.</p>
      </div>
    )
  }

  return (
    <div className="village-container" data-testid="living-village">
      {/* Search & filter bar */}
      <div className="village-controls">
        <div className="village-search-wrap">
          <svg className="village-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="village-search"
            type="search"
            placeholder="Search people…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search people in the village"
          />
        </div>
        <div className="village-filters" role="group" aria-label="Filter by role">
          <button
            className={`village-chip${roleFilter === null ? ' active' : ''}`}
            onClick={() => setRoleFilter(null)}
            aria-pressed={roleFilter === null}
          >
            All
          </button>
          {roles.map(role => (
            <button
              key={role}
              className={`village-chip${roleFilter === role ? ' active' : ''}`}
              onClick={() => setRoleFilter(roleFilter === role ? null : role)}
              aria-pressed={roleFilter === role}
            >
              {rolePlural(role)}
            </button>
          ))}
        </div>
      </div>

      {/* Graph canvas */}
      <div
        ref={containerRef}
        className="village-canvas-wrap"
        role="img"
        aria-label={`Village graph centered on ${scope.childName}. ${filtered.nodes.length} people shown.`}
      >
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ForceGraph2D<GraphNode, GraphLink>
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={filtered}
            backgroundColor="#f5f0fa"
            nodeId="id"
            linkSource="source"
            linkTarget="target"
            nodeCanvasObject={nodeCanvasObject}
            nodeCanvasObjectMode={() => 'replace'}
            nodePointerAreaPaint={nodePointerAreaPaint}
            linkColor={linkColor}
            linkWidth={1.5}
            linkCurvature={0.18}
            onNodeClick={handleNodeClick}
            onBackgroundClick={() => setSelected(null)}
            onEngineTick={handleEngineTick}
            cooldownTime={2000}
            d3AlphaDecay={0.04}
            d3VelocityDecay={0.45}
            enableNodeDrag={false}
          />
        )}
        {filtered.nodes.length === 0 && search && (
          <div className="village-no-results" role="status">
            No people match &ldquo;{search}&rdquo;
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="village-legend" aria-label="Graph legend">
        <span className="village-legend-item"><span className="village-legend-dot" style={{ background: '#7559a1' }} />Child</span>
        <span className="village-legend-item"><span className="village-legend-dot" style={{ background: '#3a506b' }} />Parent</span>
        <span className="village-legend-item"><span className="village-legend-dot" style={{ background: '#8b6e4e' }} />Family</span>
      </div>

      {/* Person card */}
      <AnimatePresence>
        {selected && (
          <PersonCard
            key={selected.id}
            node={selected}
            edge={selectedEdge}
            centerName={scope.childName}
            highlight={highlights[selected.id] ?? null}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
