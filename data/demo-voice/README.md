# Demo voice notes

Four clips generated for the 30-day demo history: three voice-linked responses (`job_hist_08`,
`job_hist_09`, `job_hist_12`) and the standalone three-phone Loretta asset.

**Voices:** ElevenLabs **stock** voices only — Jessica (Priya), Sarah (Loretta), Matilda (Gloria),
model `eleven_multilingual_v2`. No cloned or real-person voice was used; one cloned client voice
exists on the account and is deliberately unused. All speakers are fictional.

**Transcripts:** Meta `muse-voice-transcribe-1.0` via `POST /v1/asr/transcribe`, stored
**verbatim** (including `4.20`, `1.20` and duplicated words). The script text is kept separately;
a transcript is never replaced by its script.

**Timestamps:** corrected EDT (`-04:00`) for October 2026. The fixture's `-05:00` values are one
hour late; teacher-persona's follow-up fixes that.

| Asset | Speaker | Story | Duration | MP3 SHA-256 |
| --- | --- | --- | --- | --- |
| `vn_hist_08_1` | p_priya | job_hist_08 | 9.20 s | `aa8833aac0ee…` |
| `vn_hist_09_1` | p_gma | job_hist_09 | 6.27 s | `4f6672bbeac0…` |
| `vn_hist_12_1` | p_gloria | job_hist_12 | 8.68 s | `2fd15b9bb850…` |
| `voice_three_phone_loretta` | p_gma | — (illustrative) | 4.13 s | `e6a1b980b454…` |

Playback: MP3 (44.1 kHz). Muse input: mono 16-bit PCM WAV, 24 kHz. `turnTimings` is `null` —
the ASR response returned no turn-level timings, and none are invented.

`voice_three_phone_loretta` is illustrative only: no story or event link.
