import {formatTime} from '@/features/calendar/time'

/**
 * The shared Orbit text, shown exactly as it lands on a phone: an iOS Messages bubble from the
 * "FridgeGraph" sender with a timestamp. It is the real message the village receives, not a
 * collapsed detail. Verbatim; never edited here.
 */
export function OrbitMessage({message, at}: {message: string | null; at?: string | null}) {
  return <div className="orbit-sms" aria-label="Shared message">
    <span className="orbit-sms-from">FridgeGraph</span>
    <div className="orbit-sms-bubble">{message ?? 'Message not recorded.'}</div>
    {at && <time className="orbit-sms-time" dateTime={at}>{formatTime(at)}</time>}
  </div>
}
