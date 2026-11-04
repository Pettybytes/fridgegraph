import { RecordedReplay } from './RecordedReplay'
import { ThreePhoneStory } from './ThreePhoneStory'
import { RECORDING } from './recording'

// Only replace the illustrative replay after the entire real journey is captured.
export function DemoReplay() {
  return RECORDING.complete ? <RecordedReplay /> : <ThreePhoneStory />
}
