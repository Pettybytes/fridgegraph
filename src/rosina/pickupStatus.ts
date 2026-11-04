import type { ChildAccess } from './childAccess';
import { applyOutputGuard } from './outputGuard';
export const isPickupStatusQuestion = (message: string) => /pickup|\bjob\b/i.test(message) && /status|open|waiting|approved|respond|pending/i.test(message);
const label: Record<string, string> = {
  pending: 'pending discovery', discovering: 'collecting caregiver responses',
  awaiting_approval: 'awaiting parent approval',
  confirmed: 'parent approved. Parent approval does not establish pickup completion',
  failed: 'failed',
};
/** No model interpretation of approval status. IDs/states come from this caller's fresh router read. */
export function pickupStatusReply(message: string, selectedChildId: string | undefined, children: ChildAccess[], lensText: string): string | null {
  if (!isPickupStatusQuestion(message)) return null;
  if (applyOutputGuard(message, children.map(c => c.displayName ?? '').join('\n') + lensText).triggered) return null;
  const explicit = children.filter(c => c.displayName && new RegExp(`\\b${c.displayName.split(' ')[0]}\\b`, 'i').test(message));
  const child = explicit.length === 1 ? explicit[0] : explicit.length > 1 ? null : children.find(c => c.id === selectedChildId) ?? (children.length === 1 ? children[0] : null);
  if (!child?.scopes.has('pickup.request')) return null;
  let data: Record<string, unknown>; try { data = JSON.parse(lensText) } catch { return null }
  const rows = data[child.id.replace(/[^a-zA-Z0-9_]/g, '_') + '_pickups'];
  if (!Array.isArray(rows)) return null;
  const requestedId = message.match(/\b(?:fx_)?job_[a-zA-Z0-9_-]+\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i)?.[0];
  const matching = rows.filter((r): r is { id: string; status: string } => typeof r?.id === 'string' && typeof r?.status === 'string')
    .filter(r => requestedId ? r.id === requestedId : /\bopen\b/i.test(message) ? !['confirmed', 'failed'].includes(r.status) : true);
  if (requestedId && !matching.length) return null;
  if (!matching.length) return 'There are no open pickup requests in the current shared records.';
  return matching.map(r => `Pickup request ${r.id}: ${label[r.status] ?? 'state ' + r.status}.`).join('\n');
}
