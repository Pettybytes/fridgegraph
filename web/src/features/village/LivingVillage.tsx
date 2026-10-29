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
  highlights: Record<string, ReasonCode>,
  centerId: string,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = data.nodes.map(n => {
    const isCenter = n.person.id === centerId
    return {
      id: n.person.id,
      displayName: n.person.displayName,
      initials: initials(n.person.displayName),
      role: n.role,
      household: n.household?.id ?? null,
      highlight: highlights[n.person.id] ?? null,
      isCenter,
      // Pin the center person at the graph origin — react-force-graph-2d
      // renders graph-space (0,0) at the canvas's visual center by default.
      ...(isCenter ? { fx: 0, fy: 0 } : {}),
    }
  })

  const links: GraphLink[] = data.edges.map(e => ({
    source: e.from.id,
    target: e.to.id,
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

  const graph = useMemo(() => {
    if (!data) return { nodes: [], links: [] }
    return toGraph(data, highlights, centerId)
  }, [data, highlights, centerId])

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
    const links = graph.links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target))
    return { nodes, links }
  }, [graph, search, roleFilter])

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

  // Give the layout an organic, non-rigid feel: wider spread, no
  // competing centering force (the pinned center node already anchors it).
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || forcesConfigured.current) return
    fg.d3Force('center', null)
    const charge = fg.d3Force('charge')
    if (charge) charge.strength(-260)
    const link = fg.d3Force('link')
    if (link && 'distance' in link) (link as unknown as { distance: (d: number) => void }).distance(130)
    forcesConfigured.current = true
  }, [filtered])

  const handleNodeClick = useCallback((node: NodeObject<GraphNode>) => {
    setSelected(prev => (prev?.id === node.id ? null : (node as GraphNode)))
  }, [])

  const nodeCanvasObject = useCallback((node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D) => {
    const n = node as GraphNode & { x?: number; y?: number }
    const nx = n.x ?? 0
    const ny = n.y ?? 0
    const r = nodeRadius(n)
    const fill = ROLE_FILL[n.role] ?? '#657086'

    if (n.highlight) {
      ctx.beginPath()
      ctx.arc(nx, ny, r + 10, 0, Math.PI * 2)
      ctx.fillStyle = HIGHLIGHT_GLOW[n.highlight]
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(nx, ny, r + 3, 0, Math.PI * 2)
    ctx.fillStyle = n.highlight ? HIGHLIGHT_RING[n.highlight] : '#e0dae8'
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

    if (n.highlight) {
      const label = reasonLabel(n.highlight)
      ctx.font = '600 9px sans-serif'
      const tw = ctx.measureText(label).width
      const bx = nx - tw / 2 - 6
      const by = ny - r - 18
      ctx.fillStyle = HIGHLIGHT_RING[n.highlight]
      roundRect(ctx, bx, by, tw + 12, 16, 4)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(label, nx, by + 8)
    }
  }, [])

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
            cooldownTime={2000}
            d3AlphaDecay={0.04}
            d3VelocityDecay={0.3}
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
