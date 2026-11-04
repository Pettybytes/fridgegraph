#!/bin/zsh
# Rebuilds web/src/features/story-replay/assets/rosina-narration.mp3 from Rosina's
# REAL ElevenLabs voice.
#
# Provenance (see assets/rosina-narration.json): the five narration lines are generated once
# through the app's OWN voice path — POST /voice/speak on the deployed build, authenticated as the
# fictional Kendra demo persona (POST /api/demo/login { personaId: "kendra" } mints a short-lived
# demo-persona JWT). That server path uses the same ElevenLabs voice the live app uses. No API key,
# token, or secret is ever placed in a file, argv, or log: the request is made in-browser and only
# the returned audio bytes are saved.
#
# To regenerate:
#   1. Re-fetch the five lines (text in rosina-narration.json) via /voice/speak and save each as
#      $SRC/s1.mp3 .. $SRC/s5.mp3 (raw ElevenLabs mp3 out of the audioBase64 field).
#   2. Run this script from web/:  SRC=/path/to/lines zsh scripts/build-replay-narration.sh
# It loudness-normalizes each line, concatenates with fixed silence gaps, writes the master mp3,
# and prints the measured segment manifest to paste into rosina-narration.json.
#
# Needs: ffmpeg, ffprobe. No network, no credentials.
set -euo pipefail
HERE=${0:a:h}
ASSETS=$HERE/../src/features/story-replay/assets
SRC=${SRC:-./narration-lines}
OUT=$(mktemp -d); trap 'rm -rf "$OUT"' EXIT

typeset -a ids; ids=(s1 s2 s3 s4 s5)
LEAD_MS=700; GAP_MS=1400

dur_ms(){ ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" | awk '{printf "%d",$1*1000}'; }
sil(){ ffmpeg -v error -y -f lavfi -i anullsrc=r=44100:cl=mono -t "$(awk "BEGIN{print $1/1000}")" "$2"; }

for id in $ids; do ffmpeg -v error -y -i "$SRC/$id.mp3" -af "loudnorm=I=-18:TP=-2:LRA=11" -ar 44100 -ac 1 "$OUT/$id.wav"; done
sil $LEAD_MS "$OUT/lead.wav"; sil $GAP_MS "$OUT/gap.wav"
: > "$OUT/list.txt"; echo "file '$OUT/lead.wav'" >> "$OUT/list.txt"
cursor=$LEAD_MS; man="["
for i in 1 2 3 4 5; do
  id=${ids[$i]}; d=$(dur_ms "$OUT/$id.wav")
  man+="{\"id\":\"$id\",\"speaker\":\"rosina\",\"startMs\":$cursor,\"endMs\":$((cursor+d))},"
  echo "file '$OUT/$id.wav'" >> "$OUT/list.txt"; cursor=$((cursor+d))
  if [ "$i" -lt 5 ]; then echo "file '$OUT/gap.wav'" >> "$OUT/list.txt"; cursor=$((cursor+GAP_MS)); fi
done
man="${man%,}]"
ffmpeg -v error -y -f concat -safe 0 -i "$OUT/list.txt" -c:a libmp3lame -q:a 4 "$ASSETS/rosina-narration.mp3"
echo "SEGMENTS=$man"
echo "TOTAL_MS=$(dur_ms "$ASSETS/rosina-narration.mp3")"
