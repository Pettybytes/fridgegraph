import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const OUT = 'data/demo-voice'
const AUD = `${OUT}/audio`
fs.mkdirSync(AUD, { recursive: true })

const CLIPS = [
  {
    id: 'vn_hist_08_1',
    speaker: 'p_priya', speakerName: 'Priya', child: 'p_nora',
    story: 'job_hist_08', response: 'ce_hist_08_1', attempt: 'att_hist_08_1',
    recordedAt: '2026-10-12T20:08:00Z', offset: '-04:00',
    voiceId: 'cgSgspJ2msm6clMCkdW9', voiceName: 'Jessica - Playful, Bright, Warm',
    text: "Hi — yes, I can get Nora at 4:20. I'm already heading that way for my own pickup, so it's no trouble. I'll be at the gate a few minutes early.",
    critical: /4[:.]20|four twenty/i,
  },
  {
    id: 'vn_hist_09_1',
    speaker: 'p_gma', speakerName: 'Loretta', child: 'p_nora',
    story: 'job_hist_09', response: 'ce_hist_09_1', attempt: 'att_hist_09_1',
    recordedAt: '2026-10-13T16:47:00Z', offset: '-04:00',
    voiceId: 'EXAVITQu4vr4xnSDxMaL', voiceName: 'Sarah - Mature, Reassuring',
    text: "Of course. I'll leave a little early and bring her the snack she likes. Tell them not to worry — I'll be there by one.",
    critical: /by one|\b1[:.]00\b/i,
  },
  {
    id: 'vn_hist_12_1',
    speaker: 'p_gloria', speakerName: 'Gloria', child: 'p_nora',
    story: 'job_hist_12', response: 'ce_hist_12_1', attempt: 'att_hist_12_1',
    recordedAt: '2026-10-18T18:21:00Z', offset: '-04:00',
    voiceId: 'XrExE9yKIg1WjnnlVkGX', voiceName: 'Matilda - Knowledgeable, Professional',
    text: "Hi, this is Gloria. Walter and I can take turns this week — I'm free at half past two today. Just let the front office know I'm coming.",
    critical: /half past two|2[:.]30/i,
  },
  {
    id: 'voice_three_phone_loretta',
    speaker: 'p_gma', speakerName: 'Loretta', child: 'p_nora',
    story: null, response: null, attempt: null,
    recordedAt: null, offset: null, illustrative: true,
    voiceId: 'EXAVITQu4vr4xnSDxMaL', voiceName: 'Sarah - Mature, Reassuring',
    text: "Yes — I can be there at one-twenty. I'll head out now so I'm not rushing.",
    critical: /one[- ]twenty|1[:.]20/i,
  },
]

const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true }

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

async function tts(text, voiceId) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: VOICE_SETTINGS }),
  })
  if (!r.ok) throw new Error(`TTS ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return Buffer.from(await r.arrayBuffer())
}

async function asr(wav) {
  const base = (process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '')
  const fd = new FormData()
  fd.append('request', new Blob([JSON.stringify({
    model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK',
  })], { type: 'application/json' }), 'request.json')
  fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'clip.wav')
  const r = await fetch(`${base}/asr/transcribe`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + (process.env.META_API_KEY || ''), accept: 'application/json' },
    body: fd,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`ASR ${r.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

const results = []
for (const clip of CLIPS) {
  const attempts = []
  let final = null
  for (let n = 1; n <= 2; n++) {
    const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const mp3 = await tts(clip.text, clip.voiceId)
    const mp3Path = `${AUD}/${clip.id}.mp3`
    fs.writeFileSync(mp3Path, mp3)
    const wavPath = `${AUD}/${clip.id}.wav`
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3Path, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', wavPath])
    const wav = fs.readFileSync(wavPath)
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', wavPath]).toString().trim())
    const transcribedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const asrRes = await asr(wav)
    const transcript = String(asrRes.transcript ?? '')
    const criticalOk = clip.critical.test(transcript)
    attempts.push({ attempt: n, generatedAt, transcribedAt, duration, transcript, criticalOk, audioDurationMs: asrRes.audioDurationMs })
    final = { attempt: n, generatedAt, transcribedAt, duration, transcript, criticalOk, mp3Path, wavPath, mp3, wav }
    if (criticalOk) break
  }
  results.push({
    id: clip.id,
    speakerPersonId: clip.speaker,
    speakerName: clip.speakerName,
    childId: clip.child,
    storyId: clip.story,
    responseId: clip.response,
    attemptId: clip.attempt,
    recordedAt: clip.recordedAt,
    offset: clip.offset,
    illustrative: clip.illustrative ?? false,
    script: clip.text,
    voiceId: clip.voiceId,
    voiceName: clip.voiceName,
    transcript: final.transcript,
    durationSeconds: Number(final.duration.toFixed(2)),
    attempts,
    files: { playback: final.mp3Path, muse: final.wavPath },
    sha256: { mp3: sha(final.mp3), wav: sha(final.wav) },
    generatedAt: final.generatedAt,
    transcribedAt: final.transcribedAt,
    turnTimings: null,
  })
  console.log(clip.id, 'attempts', final.attempt, 'criticalOk', final.criticalOk, 'dur', final.duration.toFixed(2), '|', final.transcript)
}

fs.writeFileSync(`${OUT}/generation-results.json`, JSON.stringify({ generatedAt: new Date().toISOString(), clips: results }, null, 2))
console.log('wrote generation-results.json')
