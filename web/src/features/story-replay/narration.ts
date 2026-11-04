import narrationUrl from './assets/replay-narration.mp3'
import manifest from './assets/replay-narration.json'
import lorettaClip from './assets/voice-three-phone-loretta.json'

export type NarrationSpeaker = 'rosina' | 'loretta'
export type NarrationSegment = Readonly<{ id: string; speaker: NarrationSpeaker; startMs: number; endMs: number; text: string }>
export type Narration = Readonly<{ src: string; durationMs: number; segments: readonly NarrationSegment[] }>

/**
 * One preloaded track for the whole replay. Rosina's segments are synthesized
 * narration (macOS say, labeled in the manifest); segment s4 is the verbatim
 * illustrative Loretta clip spliced in unchanged, so her reply is the same
 * recorded audio the demo has always used. Built by web/scripts/build-replay-narration.sh.
 */
export const REPLAY_NARRATION: Narration = {
  src: narrationUrl,
  durationMs: manifest.durationMs,
  segments: manifest.segments as readonly NarrationSegment[],
}

/** Waveform peaks derived from Loretta's approved clip, drawn in her reply bubble. */
export const LORETTA_PEAKS: readonly number[] = lorettaClip.peaks

export function speakerAt(narration: Narration | null, elapsedMs: number): NarrationSpeaker | null {
  if (!narration) return null
  const segment = narration.segments.find(s => elapsedMs >= s.startMs && elapsedMs < s.endMs)
  return segment?.speaker ?? null
}
