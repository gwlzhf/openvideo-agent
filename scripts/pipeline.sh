#!/usr/bin/env bash
# One-shot: build → mix audio → render → delivery check → quieter final → privacy scan → narration (if narration.json).
# Usage: bash pipeline.sh <video-dir>
#   FINAL_GAIN_DB (default -5): the mixer normalises to -16 LUFS, which feels loud for a
#   soft background; the delivered renders/final.mp4 is attenuated by this much (video stream copied).
set -euo pipefail
V="${1:?video dir}"
S="$(cd "$(dirname "$0")" && pwd)"
GAIN="${FINAL_GAIN_DB:--5}"
cd "$V"
npm run build 2>&1 | tail -1
node "$S/mix-audio.mjs" . | tail -1
node render-film.mjs --audio assets/master.wav --output renders/final-norm.mp4 | tail -1
node "$S/check-delivery.mjs" . renders/final-norm.mp4 > evidence/delivery.json 2>&1 || true
node -e "
const r = JSON.parse(require('fs').readFileSync('evidence/delivery.json', 'utf8'));
console.log('ok', r.ok);
console.log('errors', JSON.stringify(r.errors));
console.log('warnings', JSON.stringify(r.warnings));
"
ffmpeg -y -loglevel error -i renders/final-norm.mp4 -c:v copy -af "volume=${GAIN}dB" -c:a aac -b:a 192k renders/final.mp4
echo "final: renders/final.mp4 (audio ${GAIN} dB vs the checked -16 LUFS reference renders/final-norm.mp4)"
# Privacy: anything listed in .privacy-terms (one per line) must not appear in the built film.
if [ -f .privacy-terms ]; then
  hits=$(grep -rliFf .privacy-terms dist --include=*.js --include=*.html || true)
  if [ -n "$hits" ]; then echo "PRIVACY HIT in: $hits" >&2; exit 1; else echo "privacy scan: clean"; fi
fi
# Narration: default on whenever narration.json exists. Writes renders/final-narrated-sub.mp4 (the deliverable).
if [ -f narration.json ]; then
  node "$S/make-voice.mjs" "$PWD" | tail -2
fi
