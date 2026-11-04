import narrationUrl from './assets/rosina-narration.mp3'
import manifest from './assets/rosina-narration.json'
import lorettaClip from './assets/voice-three-phone-loretta.json'

export type NarrationSpeaker = 'rosina'
export type NarrationSegment = Readonly<{ id: string; speaker: NarrationSpeaker; startMs: number; endMs: number; text: string }>
export type Narration = Readonly<{ src: string; durationMs: number; segments: readonly NarrationSegment[] }>

/**
 * One preloaded track for the whole replay: Rosina's REAL ElevenLabs voice, generated
 * once through the app's own voice path (/voice/speak) and committed as a static asset.
 * See assets/rosina-narration.json for provenance. No key or token is stored.
 */
export const REPLAY_NARRATION: Narration = {
  src: narrationUrl,
  durationMs: manifest.durationMs,
  segments: manifest.segments as readonly NarrationSegment[],
}

/** Waveform peaks from Loretta's recorded illustrative clip, drawn in her reply bubble on Phone 1. */
export const LORETTA_PEAKS: readonly number[] = lorettaClip.peaks

export function speakerAt(narration: Narration | null, elapsedMs: number): NarrationSpeaker | null {
  if (!narration) return null
  const segment = narration.segments.find(s => elapsedMs >= s.startMs && elapsedMs < s.endMs)
  return segment?.speaker ?? null
}
