import fs from 'node:fs'

const base = (process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '')
const url = process.env.MUSE_ASR_URL || `${base}/asr/transcribe`
const model = process.env.MUSE_ASR_MODEL || 'muse-voice-transcribe-1.0'

const wav = fs.readFileSync('data/demo-voice/probe/probe.wav')
const fd = new FormData()
fd.append('request', new Blob([
  JSON.stringify({ model, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' }),
], { type: 'application/json' }), 'request.json')
fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'clip.wav')

const r = await fetch(url, {
  method: 'POST',
  headers: { authorization: 'Bearer ' + (process.env.META_API_KEY || ''), accept: 'application/json' },
  body: fd,
})
const text = await r.text()
console.log('asr status', r.status)
console.log(text.slice(0, 1200))
fs.writeFileSync('data/demo-voice/probe/asr-response.txt', `status ${r.status}\n${text}\n`)
