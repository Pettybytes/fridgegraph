import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LivingVillage } from '../LivingVillage'
import villageMock from '../../../../../docs/mocks/living-village.json'
import type { FrontendAdapter, VillageData, MissionControlData, ParentChatData, Scope } from '@/lib/frontendData/types'
import { DataProvider } from '@/lib/frontendData/provider'
import { projectVillage } from '@/lib/frontendData/mockAdapter'

/* ── Helpers ────────────────────────────────────────────── */

const demoScope: Scope = {
  childId: 'p_nora',
  childName: 'Nora Ellison',
  parentName: 'Kendra',
  villageId: 'v_nora',
}

const villageData: VillageData = projectVillage(villageMock.data.villageGraph)

const missionControlData: MissionControlData = {
  candidates: [
    { id: 'p_gma', name: 'Loretta Brooks', channel: 'CALL', reasonCode: 'AVAILABLE_NO_TRANSPORT', distanceMiles: 8.86, estimatedRideCostUsd: null, costBasis: null },
    { id: 'p_bryan', name: 'Bryan Brooks', channel: 'SMS', reasonCode: 'UNAVAILABLE', distanceMiles: 3.2, estimatedRideCostUsd: null, costBasis: null },
  ],
  events: [],
}

function createTestAdapter(village: VillageData = villageData, mc: MissionControlData = missionControlData): FrontendAdapter {
  return {
    mode: 'mock',
    async readVillage() { return structuredClone(village) },
    async readMissionControl() { return structuredClone(mc) },
    async readParentChat(): Promise<ParentChatData> { return { messages: [] } },
  }
}

function renderVillage(adapter?: FrontendAdapter) {
  return render(
    <DataProvider adapter={adapter ?? createTestAdapter()} scope={demoScope}>
      <LivingVillage />
    </DataProvider>
  )
}

/* ── Mock canvas ────────────────────────────────────────── */

function mockCanvasContext() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    scale: vi.fn(),
    translate: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
  }
  return ctx
}

beforeEach(() => {
  // Mock HTMLCanvasElement.getContext
  const ctx = mockCanvasContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)

  // Mock getBoundingClientRect for canvas parent
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {},
  })

  // react-force-graph-2d's internal render loop calls rAF recursively from
  // inside its own callback. Invoking synchronously here would recurse the
  // call stack to overflow, so this mock only ever renders the first frame.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})

/* ── Tests ──────────────────────────────────────────────── */

describe('LivingVillage', () => {
  it('renders the village container after data loads', async () => {
    renderVillage()
    // Wait for async adapter to resolve
    const container = await screen.findByTestId('living-village')
    expect(container).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    // Use a never-resolving adapter to keep loading state
    const slowAdapter: FrontendAdapter = {
      mode: 'mock',
      readVillage: () => new Promise(() => {}),
      readMissionControl: () => new Promise(() => {}),
      readParentChat: () => new Promise(() => {}),
    }
    renderVillage(slowAdapter)
    expect(screen.getByTestId('living-village-loading')).toBeInTheDocument()
  })

  it('shows error state on adapter failure', async () => {
    const errorAdapter: FrontendAdapter = {
      mode: 'mock',
      async readVillage() { throw new Error('UNAUTHORIZED') },
      async readMissionControl() { throw new Error('UNAUTHORIZED') },
      async readParentChat() { return { messages: [] } },
    }
    renderVillage(errorAdapter)
    const error = await screen.findByTestId('living-village-error')
    expect(error).toBeInTheDocument()
    expect(error).toHaveTextContent("This information is private")
  })

  it('renders search input', async () => {
    renderVillage()
    const input = await screen.findByLabelText('Search people in the village')
    expect(input).toBeInTheDocument()
  })

  it('renders filter chips for each role', async () => {
    renderVillage()
    await screen.findByTestId('living-village')
    expect(screen.getByText('All')).toBeInTheDocument()
    // The mock has child, parent, adult roles
    expect(screen.getByText('Adults')).toBeInTheDocument()
    expect(screen.getByText('Children')).toBeInTheDocument()
    expect(screen.getByText('Parents')).toBeInTheDocument()
  })

  it('filters by search text', async () => {
    renderVillage()
    const input = await screen.findByLabelText('Search people in the village')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'zzzzz' } })
    })
    expect(screen.getByRole('status')).toHaveTextContent('No people match')
  })

  it('renders the canvas with correct aria-label', async () => {
    renderVillage()
    const canvas = await screen.findByRole('img')
    expect(canvas).toHaveAttribute('aria-label', expect.stringContaining('Nora Ellison'))
  })

  it('renders legend items', async () => {
    renderVillage()
    await screen.findByTestId('living-village')
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(screen.getByText('Parent')).toBeInTheDocument()
    expect(screen.getByText('Family')).toBeInTheDocument()
  })

  it('uses contract-compliant labels from reasonLabel', async () => {
    // Verify the labels match the contract
    const { reasonLabel } = await import('@/lib/frontendData/types')
    expect(reasonLabel('PENDING')).toBe('Waiting for reply')
    expect(reasonLabel('OVER_POLICY')).toBe('Ride estimate over your limit')
    expect(reasonLabel('APPROVAL_PENDING')).toBe('Awaiting parent approval')
    expect(reasonLabel('RECOMMENDED')).toBe('Recommended')
  })

  it('exports LivingVillage from index', async () => {
    const mod = await import('../index')
    expect(mod.LivingVillage).toBeDefined()
  })

  it('reacts to new nodes (Dana appearing)', async () => {
    const extendedVillage: VillageData = {
      ...villageData,
      nodes: [
        ...villageData.nodes,
        { person: { id: 'p_dana', displayName: 'Dana Reeves' }, household: null, role: 'adult' },
      ],
      edges: [
        ...villageData.edges,
        { from: { id: 'p_dana' }, to: { id: 'p_nora' }, relationship: { id: 'r_dana', type: 'neighbor', status: 'ACTIVE' } },
      ],
    }
    const adapter = createTestAdapter(extendedVillage)
    renderVillage(adapter)
    const canvas = await screen.findByRole('img')
    // Canvas aria-label should reflect the extra person
    expect(canvas).toHaveAttribute('aria-label', expect.stringContaining('9 people shown'))
  })
})
