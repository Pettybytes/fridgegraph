/**
 * ONE shared Rosina voice controller for the whole signed-in surface. Both the Today mic and the
 * panel mic consume this single instance, so a tap in either place drives the same recording — never
 * two controllers, never a synthetic click from one to the other. The conversation thread lives in
 * RosinaPanel; it registers its history + append callbacks here with `useVoiceBinding`, so voice turns
 * carry the same bounded history as text turns and insert their transcript/reply into the live thread.
 *
 * Three contexts on purpose:
 *   - a STABLE start handle (`useVoiceStart`) — callers that only start capture (the Today mic) never
 *     re-render on voice state;
 *   - a STABLE binding API (`useVoiceBinding`) — the panel registers its thread once on mount and the
 *     effect never churns (its identity is fixed), so registration can't loop;
 *   - the REACTIVE controller (`useVoiceControllerOptional`) — the mic UI re-renders on state changes.
 * The controller object itself is recreated each render, so it is kept OUT of the two stable contexts.
 *
 * `resetKey` (caller/child/session generation) is owned here: changing it tears the controller down
 * and discards any in-flight or late result.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useRosinaVoice, type VoiceDeps, type HistoryMessage } from './useRosinaVoice'
import type { VoiceController } from './RosinaVoiceButton'

export type VoiceBinding = {
  getHistory?: () => HistoryMessage[]
  onTranscript?: (text: string) => void
  onReply?: (reply: string, actions: unknown[]) => void | false
}

export type VoiceStartHandle = { start: () => void }
type VoiceBindApi = { setBinding: (b: VoiceBinding) => void; clearBinding: (b: VoiceBinding) => void; cancel: () => void }

const VoiceControllerContext = createContext<VoiceController | null>(null)
const VoiceStartContext = createContext<VoiceStartHandle | null>(null)
const VoiceBindContext = createContext<VoiceBindApi | null>(null)

export function VoiceProvider({ getAccessToken, resetKey, deps, children }: {
  getAccessToken: VoiceDeps['getAccessToken']
  resetKey?: unknown
  deps?: Partial<Omit<VoiceDeps, 'getAccessToken' | 'resetKey' | 'getHistory' | 'onTranscript' | 'onReply'>>
  children: ReactNode
}) {
  const bindingRef = useRef<VoiceBinding>({})
  const v = useRosinaVoice({
    getAccessToken,
    resetKey,
    getHistory: () => bindingRef.current.getHistory?.() ?? [],
    onTranscript: (t) => bindingRef.current.onTranscript?.(t),
    onReply: (r, a) => bindingRef.current.onReply?.(r, a),
    ...deps,
  })
  const vRef = useRef(v); vRef.current = v
  // STABLE handles (identity fixed for the provider's lifetime) — safe as effect dependencies.
  const startHandle = useRef<VoiceStartHandle>({ start: () => { void vRef.current.start() } }).current
  const bindApi = useRef<VoiceBindApi>({
    setBinding: (b) => { bindingRef.current = b },
    clearBinding: (b) => { if (bindingRef.current === b) bindingRef.current = {} },
    cancel: () => { vRef.current.cancel() },
  }).current
  return (
    <VoiceStartContext.Provider value={startHandle}>
      <VoiceBindContext.Provider value={bindApi}>
        <VoiceControllerContext.Provider value={v}>{children}</VoiceControllerContext.Provider>
      </VoiceBindContext.Provider>
    </VoiceStartContext.Provider>
  )
}

/** The reactive shared controller, or null without a provider (standalone/tests fall back to a lone
 *  mic). Subscribing RE-RENDERS on voice-state changes — use only where that is wanted (the mic UI). */
export function useVoiceControllerOptional(): VoiceController | null {
  return useContext(VoiceControllerContext)
}

/** A stable "start capture" handle, or null without a provider. Does NOT re-render on voice state. */
export function useVoiceStart(): VoiceStartHandle | null {
  return useContext(VoiceStartContext)
}

/** Register a thread's history + append callbacks with the shared controller while mounted. The bind
 *  API identity is fixed, so this effect runs exactly once per mount (no churn, no loop). On unmount
 *  (e.g. the panel closes) the controller is torn down — capture/playback stop, requests cancel. */
export function useVoiceBinding(binding: VoiceBinding) {
  const api = useContext(VoiceBindContext)
  const ref = useRef(binding); ref.current = binding
  useEffect(() => {
    if (!api) return
    const live: VoiceBinding = {
      getHistory: () => ref.current.getHistory?.() ?? [],
      onTranscript: (t) => ref.current.onTranscript?.(t),
      onReply: (r, a) => ref.current.onReply?.(r, a),
    }
    api.setBinding(live)
    return () => { api.clearBinding(live); api.cancel() }
  }, [api])
}
