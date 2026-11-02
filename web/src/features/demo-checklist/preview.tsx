import { createRoot } from 'react-dom/client'
import '../../index.css'
import { DemoChecklist } from './DemoChecklist'
import { DEMO_CHECKLIST_EVIDENCE } from './evidence'

// Standalone layout preview only. No session, reset, model, or backend is connected.
const guide = new URLSearchParams(window.location.search).has('guide')
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 960, margin: '32px auto', padding: '0 16px' }}>
  <p style={{ maxWidth: 880, margin: '0 0 16px' }}>Checklist layout preview · fictional sample availability flags · no app actions are connected.</p>
  <DemoChecklist
    personaId={guide ? 'demo-guide' : 'kendra'} childId="p_nora" demoRunId="fixture-preview" mode={guide ? 'guide' : 'parent'}
    availability={{ noticeConfirmReady: true, villageReady: true, orbitReady: true, voiceReady: false, photoReady: false }}
    evidenceLinks={DEMO_CHECKLIST_EVIDENCE}
  />
</main>)
