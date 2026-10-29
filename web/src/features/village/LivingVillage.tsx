import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VillageGraphData, LivingVillageProps, GraphNode, GraphLink, PersonHighlight } from './types'
import { reasonLabel } from '@/lib/frontendData/types'
import type { ReasonCode } from '@/lib/frontendData/types'
import { PersonCard } from './PersonCard'
import './village.css'

/* ── helpers ────────────────────────────────────────────── */

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function toGraph(
  data: VillageGraphData,
  highlights: Record<string, PersonHighlight>,
  centerId: string,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = data.nodes.map(n => ({
    id: n.person.id,
    displayName: n.person.displayName,
    initials: initials(n.person.displayName),
    role: n.role,
    household: n.household?.id ?? null,
    highlight: highlights[n.person.id]?.reasonCode ?? null,
    isCenter: n.person.id === centerId,
  }))

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

/* ── main component ─────────────────────────────────────── */

export function LivingVillage({ data, highlights = {}, centerId }: LivingVillageProps) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLink[]>([])
  const simTickRef = useRef(0)

  // Determine center
  const resolvedCenter = centerId ?? data?.nodes.find(n => n.role === 'child')?.person.id ?? ''

  // Build graph data
  const graph = useMemo(() => {
    if (!data) return { nodes: [], links: [] }
    return toGraph(data, highlights, resolvedCenter)
  }, [data, highlights, resolvedCenter])

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
    const links = graph.links.filter(l => nodeIds.has(l.source as string) && nodeIds.has(l.target as string))
    return { nodes, links }
  }, [graph, search, roleFilter])

  // Find edge for selected node
  const selectedEdge = useMemo(() => {
    if (!selected || !data) return null
    const edge = data.edges.find(
      e => (e.from.id === selected.id && e.to.id === resolvedCenter) ||
           (e.to.id === selected.id && e.from.id === resolvedCenter)
    )
    return edge ?? null
  }, [selected, data, resolvedCenter])

  // Simple force simulation (no dependency on react-force-graph-2d rendering in tests)
  const runSimulation = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { nodes, links } = filtered
    nodesRef.current = nodes
    linksRef.current = links

    // Initialize positions in a circle around center
    const w = canvas.width
    const h = canvas.height
    const cx = w / 2
    const cy = h / 2

    nodes.forEach((node, i) => {
      if (node.isCenter) {
        node.x = cx
        node.y = cy
        node.fx = cx
        node.fy = cy
      } else {
        const angle = (i / (nodes.length - 1 || 1)) * Math.PI * 2 - Math.PI / 2
        const radius = Math.min(w, h) * 0.28
        if (node.x === undefined) {
          node.x = cx + Math.cos(angle) * radius
          node.y = cy + Math.sin(angle) * radius
        }
      }
      node.vx = 0
      node.vy = 0
    })

    // Build adjacency for force
    const linkMap = new Map<string, string[]>()
    links.forEach(l => {
      const s = l.source as string
      const t = l.target as string
      if (!linkMap.has(s)) linkMap.set(s, [])
      if (!linkMap.has(t)) linkMap.set(t, [])
      linkMap.get(s)!.push(t)
      linkMap.get(t)!.push(s)
    })

    simTickRef.current = 0

    function tick() {
      simTickRef.current++
      const alpha = Math.max(0.001, 1 - simTickRef.current / 300)

      // Simple forces
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!
        if (a.fx !== undefined) continue

        // Repulsion from all other nodes
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue
          const b = nodes[j]!
          const dx = (a.x ?? 0) - (b.x ?? 0)
          const dy = (a.y ?? 0) - (b.y ?? 0)
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = (800 / (dist * dist)) * alpha
          a.vx = (a.vx ?? 0) + (dx / dist) * force
          a.vy = (a.vy ?? 0) + (dy / dist) * force
        }

        // Attraction along links
        const neighbors = linkMap.get(a.id) ?? []
        for (const nid of neighbors) {
          const b = nodes.find(n => n.id === nid)
          if (!b) continue
          const dx = (b.x ?? 0) - (a.x ?? 0)
          const dy = (b.y ?? 0) - (a.y ?? 0)
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const idealDist = Math.min(w, h) * 0.22
          const force = ((dist - idealDist) / dist) * 0.06 * alpha
          a.vx = (a.vx ?? 0) + dx * force
          a.vy = (a.vy ?? 0) + dy * force
        }

        // Center gravity
        a.vx = (a.vx ?? 0) + (cx - (a.x ?? 0)) * 0.002 * alpha
        a.vy = (a.vy ?? 0) + (cy - (a.y ?? 0)) * 0.002 * alpha

        // Damping
        a.vx = (a.vx ?? 0) * 0.85
        a.vy = (a.vy ?? 0) * 0.85

        a.x = (a.x ?? 0) + (a.vx ?? 0)
        a.y = (a.y ?? 0) + (a.vy ?? 0)
      }

      draw(ctx, w, h, nodes, links)

      if (alpha > 0.002) {
        animRef.current = requestAnimationFrame(tick)
      }
    }

    tick()
  }, [filtered])

  // Resize canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    function resize() {
      if (!canvas || !parent) return
      const dpr = window.devicePixelRatio || 1
      const rect = parent.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const resizeCtx = canvas.getContext('2d')
      if (resizeCtx) resizeCtx.scale(dpr, dpr)
      // Reset node positions on resize
      nodesRef.current.forEach(n => { n.x = undefined; n.y = undefined })
      runSimulation()
    }

    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animRef.current)
    }
  }, [runSimulation])

  // Click handling
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const nodeRadius = 26

    // Node positions are stored in canvas-pixel space, we need CSS-pixel comparison
    const dpr = window.devicePixelRatio || 1
    const hit = nodesRef.current.find(n => {
      const nx = (n.x ?? 0) / dpr
      const ny = (n.y ?? 0) / dpr
      const dx = nx - x
      const dy = ny - y
      return Math.sqrt(dx * dx + dy * dy) < nodeRadius
    })

    if (hit) {
      setSelected(prev => prev?.id === hit.id ? null : hit)
    } else {
      setSelected(null)
    }
  }, [])

  // Available roles for filter
  const roles = useMemo(() => {
    if (!data) return []
    const set = new Set(data.nodes.map(n => n.role))
    return Array.from(set).sort()
  }, [data])

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
            className={`village-chip ${roleFilter === null ? 'active' : ''}`}
            onClick={() => setRoleFilter(null)}
            aria-pressed={roleFilter === null}
          >
            All
          </button>
          {roles.map(role => (
            <button
              key={role}
              className={`village-chip ${roleFilter === role ? 'active' : ''}`}
              onClick={() => setRoleFilter(roleFilter === role ? null : role)}
              aria-pressed={roleFilter === role}
            >
              {role.charAt(0).toUpperCase() + role.slice(1)}s
            </button>
          ))}
        </div>
      </div>

      {/* Graph canvas */}
      <div className="village-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="village-canvas"
          onClick={handleCanvasClick}
          role="img"
          aria-label={`Village graph centered on ${data.nodes.find(n => n.person.id === resolvedCenter)?.person.displayName ?? 'the child'}. ${filtered.nodes.length} people shown.`}
        />
        {filtered.nodes.length === 0 && search && (
          <div className="village-no-results" role="status">
            No people match "{search}"
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
      <PersonCard
        node={selected}
        edge={selectedEdge}
        centerName={data.nodes.find(n => n.person.id === resolvedCenter)?.person.displayName ?? ''}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

/* ── Canvas drawing ─────────────────────────────────────── */

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  nodes: GraphNode[],
  links: GraphLink[],
) {
  const dpr = window.devicePixelRatio || 1
  ctx.save()
  ctx.clearRect(0, 0, w / dpr, h / dpr)

  // Background gradient
  const bg = ctx.createRadialGradient(w / (2 * dpr), h / (2 * dpr), 0, w / (2 * dpr), h / (2 * dpr), Math.max(w, h) / (2 * dpr))
  bg.addColorStop(0, '#f5f0fa')
  bg.addColorStop(1, '#eef2f9')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w / dpr, h / dpr)

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Draw links
  ctx.lineWidth = 1.5
  for (const link of links) {
    const src = nodeMap.get(link.source as string)
    const tgt = nodeMap.get(link.target as string)
    if (!src || !tgt) continue

    const sx = (src.x ?? 0) / dpr
    const sy = (src.y ?? 0) / dpr
    const tx = (tgt.x ?? 0) / dpr
    const ty = (tgt.y ?? 0) / dpr

    // Gentle curve
    const mx = (sx + tx) / 2
    const my = (sy + ty) / 2
    const dx = tx - sx
    const dy = ty - sy
    const off = Math.min(20, Math.sqrt(dx * dx + dy * dy) * 0.1)
    const cpx = mx - dy * off / Math.sqrt(dx * dx + dy * dy || 1)
    const cpy = my + dx * off / Math.sqrt(dx * dx + dy * dy || 1)

    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.quadraticCurveTo(cpx, cpy, tx, ty)
    ctx.strokeStyle = link.relationshipStatus === 'ACTIVE' ? 'rgba(117,89,161,0.25)' : 'rgba(117,89,161,0.12)'
    ctx.stroke()
  }

  // Draw nodes
  const baseR = 24
  for (const node of nodes) {
    const nx = (node.x ?? 0) / dpr
    const ny = (node.y ?? 0) / dpr
    const r = node.isCenter ? baseR + 6 : baseR
    const fill = ROLE_FILL[node.role] ?? '#657086'

    // Highlight glow
    if (node.highlight) {
      const glow = HIGHLIGHT_GLOW[node.highlight]
      ctx.beginPath()
      ctx.arc(nx, ny, r + 10, 0, Math.PI * 2)
      ctx.fillStyle = glow
      ctx.fill()
    }

    // Outer ring
    ctx.beginPath()
    ctx.arc(nx, ny, r + 3, 0, Math.PI * 2)
    ctx.fillStyle = node.highlight ? HIGHLIGHT_RING[node.highlight] : '#e0dae8'
    ctx.fill()

    // Circle fill
    ctx.beginPath()
    ctx.arc(nx, ny, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()

    // Initials
    ctx.fillStyle = '#fff'
    ctx.font = `600 ${node.isCenter ? 15 : 13}px 'Geist Variable', sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(node.initials, nx, ny + 1)

    // Name label
    ctx.fillStyle = '#3e4a5e'
    ctx.font = `500 ${node.isCenter ? 13 : 11}px 'Geist Variable', sans-serif`
    ctx.fillText(node.displayName, nx, ny + r + 16)

    // Highlight badge
    if (node.highlight) {
      const label = reasonLabel(node.highlight)
      ctx.font = `600 9px 'Geist Variable', sans-serif`
      const tw = ctx.measureText(label).width
      const bx = nx - tw / 2 - 6
      const by = ny - r - 18

      ctx.fillStyle = HIGHLIGHT_RING[node.highlight]
      roundRect(ctx, bx, by, tw + 12, 16, 4)
      ctx.fill()

      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, nx, by + 8)
    }
  }

  ctx.restore()
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
