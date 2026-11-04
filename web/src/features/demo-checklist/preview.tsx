import { createRoot } from 'react-dom/client'
import '../../index.css'
import { DemoChecklist } from './DemoChecklist'

// Standalone layout preview only. No session, reset, model, or backend is connected.
const params = new URLSearchParams(window.location.search)
const guide = params.has('guide')
// Dev-only: `?result=live|mock` previews the Card 1 action card after a confirmed notice so its
// completed state and "Check the result" links can be reviewed. The e2e preview passes no param.
const result = params.get('result')
const noticeResult = result === 'live' ? { jobId: 'pickup_sample_demo', status: 'discovering', mode: 'live' as const }
  : result === 'mock' ? { jobId: 'mock-pickup:p_nora:2026-10-26:afternoon', status: 'discovering', mode: 'mock' as const } : null
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 960, margin: '32px auto', padding: '0 16px' }}>
  <p style={{ maxWidth: 880, margin: '0 0 16px' }}>Checklist layout preview · fictional sample availability flags · no app actions are connected.</p>
  <DemoChecklist
    personaId={guide ? 'demo-guide' : 'kendra'} childId="p_nora" demoRunId="fixture-preview" mode={guide ? 'guide' : 'parent'}
    availability={{ noticeConfirmReady: true, villageReady: true, orbitReady: true, voiceReady: false, photoReady: false }}
    onStartNotice={() => { /* preview only; no app action is connected */ }}
    noticeResult={noticeResult}
  />
</main>)
