import { useEffect, useState } from 'react'
import { StatusChip } from '@/components/fg/primitives'
import './dadStatusChip.css'

/** The nullable Person.sharedStatus read contract. The village reader owns authorization;
 * null means no status, expired status, or a person the caller may not see. */
export type SharedStatus = {
  personId: string
  emoji: string | null
  text: string
  etaText: string | null
  setAt: string
  expiresAt: string
}

export function DadStatusChip({ personId, sharedStatus, mode = 'mock' }: {
  personId: string
  sharedStatus: SharedStatus | null | undefined
  mode?: 'mock' | 'live'
}) {
  const [now, setNow] = useState(() => Date.now())
  const expiry = sharedStatus ? Date.parse(sharedStatus.expiresAt) : NaN

  useEffect(() => {
    if (!Number.isFinite(expiry)) return
    const remaining = expiry - Date.now()
    if (remaining <= 0) return
    // Reschedule long expiries when the platform's maximum timer interval is reached.
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(remaining, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [expiry, now])

  if (!sharedStatus || sharedStatus.personId !== personId ||
      !sharedStatus.text.trim() || sharedStatus.text.length > 60 ||
      !Number.isFinite(Date.parse(sharedStatus.setAt)) || !Number.isFinite(expiry) ||
      expiry <= Math.max(now, Date.now())) return null

  const emoji = sharedStatus.emoji?.trim() || null
  const eta = sharedStatus.etaText
  return <span className="dad-status-group" data-mode={mode}>
    <StatusChip tone="neutral" icon={false} className="dad-status-chip"
      role="status" aria-label={`${mode === 'mock' ? 'Sample shared status: ' : 'Shared status: '}${emoji ? `${emoji} ` : ''}${sharedStatus.text}${eta !== null ? `, ETA: ${eta}` : ''}`}>
      {emoji && <span aria-hidden="true">{emoji}</span>}
      <span>{sharedStatus.text}</span>
      {eta !== null && <span className="dad-status-eta">· ETA: {eta}</span>}
    </StatusChip>
    {mode === 'mock' && <StatusChip tone="simulated" icon={false}>Sample</StatusChip>}
  </span>
}
