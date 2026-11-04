import { useEffect, useState } from 'react'
import { RESET_COMPLETE } from '@/features/personas/demoReset'
import { useSession } from '@/features/personas/Session'
import { useChildAccess } from '@/features/personas/childContext'
import { useOrbit } from '@/features/orbit/runtime'
import { onNoticeConfirmed, requestNoticeSample } from '@/features/notice-plan/sampleSignal'
import { DemoChecklist } from './DemoChecklist'
import { checklistStorageKey } from './storage'
import { DEMO_CHECKLIST_EVIDENCE } from './evidence'

const RUN_KEY = 'fg:judge-checklist-run'
let memoryRunId = ''
function newRunId() { return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random()}` }
function currentRunId() {
  try {
    const saved = sessionStorage.getItem(RUN_KEY)
    if (saved) return saved
    const next = newRunId()
    sessionStorage.setItem(RUN_KEY, next)
    return next
  } catch { return memoryRunId ||= newRunId() }
}
function rotateRunId() {
  const next = newRunId()
  memoryRunId = next
  try { sessionStorage.setItem(RUN_KEY, next) } catch { /* The in-memory run is still distinct. */ }
  return next
}

export function TodayDemoChecklist({ reopenSignal }: { reopenSignal: number }) {
  const { session, authMode, resetDemo, resetError, notice } = useSession()
  const child = useChildAccess()
  const orbit = useOrbit()
  const [runId, setRunId] = useState(currentRunId)
  // Card 1 completion is derived from the server's recorded pickup, reported by the real notice
  // flow — never a checkbox. Scope reports to the currently focused child.
  const [noticeResult, setNoticeResult] = useState<{ jobId: string; status: string; mode: 'mock' | 'live' } | null>(null)
  const focusedChildId = child?.selectedChildId ?? session?.scope.childId ?? ''
  useEffect(() => onNoticeConfirmed(detail => {
    if (detail.childId === focusedChildId) setNoticeResult({ jobId: detail.jobId, status: detail.status, mode: detail.mode })
  }), [focusedChildId])
  // Reset preserves the perspective (#239) and remounts this component before
  // the caller's promise settles. Rotate only on the committed reset notice.
  useEffect(() => { if (notice === RESET_COMPLETE) { setRunId(rotateRunId()); setNoticeResult(null) } }, [notice])
  if (!session) return null
  const guide = session.marks?.demoGuide === true || session.persona.id === 'demo-guide'
  if (!guide && session.persona.id !== 'kendra') return null
  const childId = focusedChildId
  const live = authMode === 'live' && Boolean(session.accessToken)
  const parent = (!guide || session.marks?.showcaseEditor === true) && session.persona.parent && live
  const availability = {
    noticeConfirmReady: parent && import.meta.env.VITE_NOTICE_PLAN_LIVE === 'true',
    villageReady: parent && import.meta.env.VITE_ADD_VILLAGER_LIVE === 'true',
    orbitReady: parent && Boolean(orbit && !orbit.scope.readOnly),
    voiceReady: parent && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    // This build mounts no browser photo-descriptor adapter; Orbit uses the explicit unavailable adapter.
    photoReady: false,
  }
  const onReset = parent && session.marks?.demo === true ? async () => {
    const success = await resetDemo()
    if (success) {
      try { localStorage.removeItem(checklistStorageKey('1', session.persona.id, childId, runId)) } catch { /* Storage may be unavailable. */ }
    }
    return success
  } : undefined
  // One trigger that opens Rosina and stages the authorized sample through the SAME notice flow.
  // Only wired under the live gate; the mock/public build keeps the instructional step.
  const onStartNotice = availability.noticeConfirmReady ? () => {
    window.dispatchEvent(new Event('rosina:open'))
    requestNoticeSample()
  } : undefined
  return <div id="today-demo-checklist" tabIndex={-1}>
    <DemoChecklist demoRunId={runId} personaId={session.persona.id} childId={childId} mode={guide && !parent ? 'guide' : 'parent'}
      evidenceLinks={DEMO_CHECKLIST_EVIDENCE} availability={availability} reopenSignal={reopenSignal}
      onReset={onReset} resetFailure={resetError} onStartNotice={onStartNotice} noticeResult={noticeResult} />
  </div>
}
