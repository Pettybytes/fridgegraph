import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const assetDir = path.join(root, 'web/src/features/story-replay/assets')
const manifest = JSON.parse(readFileSync(path.join(root, 'data/demo-voice/manifest.json'), 'utf8'))
const asset = manifest.assets.find(item => item.assetId === 'voice_three_phone_loretta')
if (!asset || !asset.illustrative || asset.storyId !== null || !asset.transcriptVerbatim || asset.files.playback !== 'data/demo-voice/audio/voice_three_phone_loretta.mp3') {
  throw new Error('The approved illustrative Loretta clip is missing or its manifest contract changed.')
}

const source = path.join(root, asset.files.playback)
const bytes = readFileSync(source)
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (sha256 !== asset.sha256.mp3) throw new Error('Loretta playback bytes do not match the manifest SHA-256.')

// Decode the actual MP3. Equal-width RMS bins describe the sound, not word timing.
const decoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', source, '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1'], { maxBuffer: 2_000_000 })
if (decoded.status !== 0 || !decoded.stdout?.length) throw new Error(`Could not decode Loretta MP3: ${decoded.stderr?.toString('utf8') ?? 'unknown error'}`)
const pcm = decoded.stdout
const sampleCount = Math.floor(pcm.length / 2)
const durationMs = Math.round(sampleCount / 8000 * 1000)
if (Math.abs(durationMs - asset.durationSeconds * 1000) > 100) throw new Error('Decoded duration does not match the manifest.')
const bins = 48
const rms = Array.from({ length: bins }, (_, index) => {
  const from = Math.floor(index * sampleCount / bins)
  const to = Math.floor((index + 1) * sampleCount / bins)
  let sum = 0
  for (let sample = from; sample < to; sample++) {
    const value = pcm.readInt16LE(sample * 2) / 32768
    sum += value * value
  }
  return Math.sqrt(sum / Math.max(1, to - from))
})
const max = Math.max(...rms)
const peaks = rms.map(value => Number((value / max).toFixed(3)))

copyFileSync(source, path.join(assetDir, 'voice-three-phone-loretta.mp3'))
writeFileSync(path.join(assetDir, 'voice-three-phone-loretta.json'), `${JSON.stringify({ assetId: asset.assetId, transcript: asset.transcript, durationMs, peaks, sha256 }, null, 2)}\n`)
process.stdout.write(`Synced illustrative Loretta clip: ${durationMs} ms, ${bins} audio-derived peaks.\n`)
