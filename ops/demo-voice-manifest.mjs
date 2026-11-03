import fs from 'node:fs'

const OUT = 'data/demo-voice'
const gen = JSON.parse(fs.readFileSync(`${OUT}/generation-results.json`, 'utf8'))

const assets = gen.clips.map((c) => ({
  assetId: c.id,
  kind: c.illustrative ? 'illustrative_story_asset' : 'voice_note',
  speakerPersonId: c.speakerPersonId,
  childId: c.childId,
  storyId: c.storyId,
  responseId: c.responseId,
  attemptId: c.attemptId,
  linkedEventIds: c.responseId ? [c.responseId] : [],
  recordedAt: c.recordedAt,
  recordedOffset: c.offset,
  illustrative: c.illustrative,
  script: c.script,
  transcript: c.transcript,
  transcriptVerbatim: true,
  durationSeconds: c.durationSeconds,
  turnTimings: c.turnTimings,
  files: c.files,
  sha256: c.sha256,
  generatedAt: c.generatedAt,
  transcribedAt: c.transcribedAt,
  provenance: {
    tts: { provider: 'ElevenLabs', model: 'eleven_multilingual_v2', voiceId: c.voiceId, voiceName: c.voiceName },
    asr: { provider: 'Meta', model: 'muse-voice-transcribe-1.0', endpoint: '/v1/asr/transcribe' },
    attempts: c.attempts.map((a) => ({ attempt: a.attempt, generatedAt: a.generatedAt, transcribedAt: a.transcribedAt, criticalOk: a.criticalOk })),
    notes: 'Fictional speakers. Stock/designed voices only; no real-person cloning.',
  },
}))

const manifest = {
  version: 'v1',
  contract: 'docs/contracts/demo-history.md',
  anchorDate: '2026-11-02',
  anchorTimezone: 'America/Detroit',
  timestampBasis: 'corrected EDT (-04:00) for October 2026; teacher-persona follow-up fixes the fixture',
  generatedAt: gen.generatedAt,
  assets,
}
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2))

const rows = assets.map((a) =>
  `| \`${a.assetId}\` | ${a.speakerPersonId} | ${a.storyId ?? '— (illustrative)'} | ${a.durationSeconds.toFixed(2)} s | \`${a.sha256.mp3.slice(0, 12)}…\` |`).join('\n')

const readme = `# Demo voice notes

Four clips generated for the 30-day demo history: three voice-linked responses (\`job_hist_08\`,
\`job_hist_09\`, \`job_hist_12\`) and the standalone three-phone Loretta asset.

**Voices:** ElevenLabs **stock** voices only — Jessica (Priya), Sarah (Loretta), Matilda (Gloria),
model \`eleven_multilingual_v2\`. No cloned or real-person voice was used; one cloned client voice
exists on the account and is deliberately unused. All speakers are fictional.

**Transcripts:** Meta \`muse-voice-transcribe-1.0\` via \`POST /v1/asr/transcribe\`, stored
**verbatim** (including \`4.20\`, \`1.20\` and duplicated words). The script text is kept separately;
a transcript is never replaced by its script.

**Timestamps:** corrected EDT (\`-04:00\`) for October 2026. The fixture's \`-05:00\` values are one
hour late; teacher-persona's follow-up fixes that.

| Asset | Speaker | Story | Duration | MP3 SHA-256 |
| --- | --- | --- | --- | --- |
${rows}

Playback: MP3 (44.1 kHz). Muse input: mono 16-bit PCM WAV, 24 kHz. \`turnTimings\` is \`null\` —
the ASR response returned no turn-level timings, and none are invented.

\`voice_three_phone_loretta\` is illustrative only: no story or event link.
`
fs.writeFileSync(`${OUT}/README.md`, readme)
console.log('wrote manifest.json and README.md', assets.length)
