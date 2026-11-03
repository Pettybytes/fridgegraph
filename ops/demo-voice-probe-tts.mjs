import fs from 'node:fs'

const key = process.env.ELEVENLABS_API_KEY
const text = "Yes, I can be there at 1:20. I'll head out now so I'm not rushing."
const voice = 'EXAVITQu4vr4xnSDxMaL'

const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
  method: 'POST',
  headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
  body: JSON.stringify({
    text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
  }),
})
console.log('tts status', r.status)
if (!r.ok) {
  console.log((await r.text()).slice(0, 400))
  process.exit(1)
}
const b = Buffer.from(await r.arrayBuffer())
fs.writeFileSync('data/demo-voice/probe/probe.mp3', b)
console.log('mp3 bytes', b.length)
