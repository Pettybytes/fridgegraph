import { createRoot } from 'react-dom/client'
import { FridgeEditing } from './FridgeEditing'
import { mockFridgeEditingAdapter, sampleGoals, sampleNotes } from './mockEditingAdapter'
import type { FridgeViewer } from './editingContract'
import '../../index.css'

const mode = new URLSearchParams(location.search).get('mode')
const viewer: FridgeViewer = mode === 'guide' ? { personId: 'guide', role: 'GUIDE', sessionKey: 'fixture-guide' }
  : mode === 'caregiver' ? { personId: 'dana', role: 'CAREGIVER', sessionKey: 'fixture-caregiver' }
    : { personId: 'kendra', role: 'PARENT', sessionKey: 'fixture-parent' }
const goals = mode === 'guide' || mode === 'caregiver' ? sampleGoals.filter(goal => goal.status === 'APPROVED') : sampleGoals
const notes = mode === 'caregiver' ? sampleNotes.filter(note => note.audience === 'SHARED' || note.author.id === 'dana') : sampleNotes
const adapter = mockFridgeEditingAdapter(goals, notes)

createRoot(document.getElementById('root')!).render(<>
  <p style={{ margin: '16px auto 0', padding: '0 16px', maxWidth: 1160, fontSize: 12, color: 'var(--fg-muted)' }}>Controlled fictional fixture · no live reads or writes · {viewer.role.toLowerCase()} perspective</p>
  <FridgeEditing adapter={adapter} childId="nora" childName="Nora" viewer={viewer} />
</>)
