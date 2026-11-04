import narrationUrl from './assets/rosina-narration.mp3'
import manifest from './assets/rosina-narration.json'
import lorettaClip from './assets/voice-three-phone-loretta.json'

export type NarrationSpeaker = 'rosina' | 'loretta'
export type NarrationSegment = Readonly<{ id: string; speaker: NarrationSpeaker; startMs: number; endMs: number; text: string }>
export type Narration = Readonly<{ src: string; durationMs: number; segments: readonly NarrationSegment[] }>

/**
 * One preloaded track for the whole replay: Rosina's REAL ElevenLabs voice plus
 * Loretta's own line in the Blanco voice, generated once via the ElevenLabs API
 * and committed as a static asset. See assets/rosina-narration.json for provenance.
 * No key or token is stored.
 */
export const REPLAY_NARRATION: Narration = {
  src: narrationUrl,
  durationMs: manifest.durationMs,
  segments: manifest.segments as readonly NarrationSegment[],
}

/** Waveform peaks for Loretta's line in the narration track, drawn in her reply bubble on Phone 1. */
export const LORETTA_PEAKS: readonly number[] =
  (manifest as { lorettaPeaks?: readonly number[] }).lorettaPeaks ?? lorettaClip.peaks

export function speakerAt(narration: Narration | null, elapsedMs: number): NarrationSpeaker | null {
  if (!narration) return null
  const segment = narration.segments.find(s => elapsedMs >= s.startMs && elapsedMs < s.endMs)
  return segment?.speaker ?? null
}
