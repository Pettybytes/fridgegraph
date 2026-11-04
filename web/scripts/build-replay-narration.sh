#!/bin/zsh
# Rebuilds web/src/features/story-replay/assets/replay-narration.mp3 and prints the
# segment manifest to paste into replay-narration.json.
#
# Provenance: Rosina's segments are synthesized locally with macOS `say`
# (voice Samantha) and are labeled as synthesized in the manifest and on the page.
# Segment s4 is the verbatim illustrative voice_three_phone_loretta clip
# (ElevenLabs stock voice, data/demo-voice/manifest.json), loudness-normalized
# and spliced unchanged. No network, no credentials, fictional people only.
#
# Run from web/: zsh scripts/build-replay-narration.sh
# Needs: macOS `say`, ffmpeg, ffprobe.
set -euo pipefail
HERE=${0:a:h}
ASSETS=$HERE/../src/features/story-replay/assets
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

typeset -a ids speakers texts gaps
ids=(s1 s2 s3 s4 s5 s6)
speakers=(rosina rosina rosina loretta rosina rosina)
texts=(
  "This is a replay of the demo, with fictional people. A school notice posts: early dismissal at one thirty."
  "Nora's pickup is still recorded for three fifteen. I draft a new plan and ask Kendra first."
  "Kendra approves the outreach. A pickup request goes to Loretta, a test caregiver."
  ""
  "Kendra confirms the plan. It is recorded for Monday at one thirty."
  "The activity log and Mission Control update across the village."
)
gaps=(1500 1800 1700 1400 1700 600)
LEAD_MS=700

norm () { ffmpeg -v error -y -i "$1" -af "loudnorm=I=-18:TP=-2:LRA=11" -ar 44100 -ac 1 "$2"; }
dur_ms () { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" | awk '{printf "%d", $1*1000}'; }
silence () { ffmpeg -v error -y -f lavfi -i anullsrc=r=44100:cl=mono -t "$(awk "BEGIN{print $1/1000}")" "$2"; }

for i in 1 2 3 4 5 6; do
  if [[ "${speakers[$i]}" == "loretta" ]]; then
    norm "$ASSETS/voice-three-phone-loretta.mp3" "$OUT/seg$i.wav"
  else
    say -v Samantha -r 178 -o "$OUT/seg$i.aiff" "${texts[$i]}"
    norm "$OUT/seg$i.aiff" "$OUT/seg$i.wav"
  fi
done

silence $LEAD_MS "$OUT/lead.wav"
inputs=("$OUT/lead.wav")
cursor=$LEAD_MS
manifest="["
for i in 1 2 3 4 5 6; do
  d=$(dur_ms "$OUT/seg$i.wav")
  manifest+="{\"id\":\"${ids[$i]}\",\"speaker\":\"${speakers[$i]}\",\"startMs\":$cursor,\"endMs\":$((cursor+d))},"
  cursor=$((cursor+d))
  inputs+=("$OUT/seg$i.wav")
  g=${gaps[$i]}
  silence $g "$OUT/gap$i.wav"
  inputs+=("$OUT/gap$i.wav")
  cursor=$((cursor+g))
done
manifest="${manifest%,}]"

: > "$OUT/list.txt"
for f in "${inputs[@]}"; do echo "file '$f'" >> "$OUT/list.txt"; done
ffmpeg -v error -y -f concat -safe 0 -i "$OUT/list.txt" -c:a libmp3lame -q:a 4 "$ASSETS/replay-narration.mp3"
echo "SEGMENTS=$manifest"
echo "TOTAL_MS=$(dur_ms "$ASSETS/replay-narration.mp3")"
