// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import bundled from './assets/voice-three-phone-loretta.json'

const manifest = JSON.parse(readFileSync(new URL('../../../../data/demo-voice/manifest.json', import.meta.url), 'utf8'))
const asset = manifest.assets.find((item: { assetId: string }) => item.assetId === 'voice_three_phone_loretta')
const copiedMp3 = readFileSync(new URL('./assets/voice-three-phone-loretta.mp3', import.meta.url))

describe('public illustrative Loretta voice', () => {
  it('uses only the manifest-approved clip and its verbatim Muse transcript', () => {
    expect(asset.illustrative).toBe(true)
    expect(asset.storyId).toBeNull()
    expect(asset.linkedEventIds).toEqual([])
    expect(asset.transcriptVerbatim).toBe(true)
    expect(bundled.transcript).toBe(asset.transcript)
    expect(bundled.assetId).toBe(asset.assetId)
    expect(createHash('sha256').update(copiedMp3).digest('hex')).toBe(asset.sha256.mp3)
    expect(bundled.sha256).toBe(asset.sha256.mp3)
    expect(readdirSync(new URL('./assets/', import.meta.url)).filter(name => name.endsWith('.mp3'))).toEqual(['voice-three-phone-loretta.mp3'])
  })

  it('keeps the measured clip length and varied audio-derived waveform', () => {
    expect(bundled.durationMs).toBe(4133)
    expect(Math.abs(bundled.durationMs - asset.durationSeconds * 1000)).toBeLessThan(100)
    expect(bundled.peaks).toHaveLength(48)
    expect(new Set(bundled.peaks).size).toBeGreaterThan(20)
    expect(bundled.peaks.every(value => value >= 0 && value <= 1)).toBe(true)
  })
})
