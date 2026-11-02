import { createRoot } from 'react-dom/client'
import '../../index.css'
import { InviteComposer } from './InvitesPanel'
import { createMockInvite } from './fixture'

// Standalone fictional sample for visual and PNG review; no application navigation or live reads.
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 1000, margin: '32px auto', padding: '0 16px' }}>
    <InviteComposer childId="fixture-child" childFirstName="Maya" mode="mock" createInvite={createMockInvite('Maya')} />
  </main>,
)
