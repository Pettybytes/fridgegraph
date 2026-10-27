#!/bin/bash
# One B4 owner cycle: typecheck -> restart stack -> suite in BOTH clock modes -> per-owner proof
# -> commit + push. Any failure stops before the commit.
set -uo pipefail
owner="$1"
cd "$(dirname "$0")/.." || exit 1

tsc_out=$(npx tsc --noEmit 2>&1 | grep -v "^npm notice")
if [ -n "$tsc_out" ]; then echo "TSC FAIL:"; echo "$tsc_out"; exit 1; fi
echo "typecheck ok"

for p in 4001 4002 4003 4004 4005 4006 4007; do
  pid=$(lsof -ti tcp:$p 2>/dev/null)
  if [ -n "$pid" ]; then kill $pid 2>/dev/null; fi
done
sleep 2
set -a; . ./.env; set +a
nohup npm start > /tmp/fg-stack.log 2>&1 &
sleep 9

DEMO_CLOCK=1 node ops/run-evidence.mjs > /tmp/b4_c1.log 2>&1
DEMO_CLOCK=0 node ops/run-evidence.mjs > /tmp/b4_c0.log 2>&1

if grep -q "DB_UNAVAILABLE" /tmp/b4_c1.log /tmp/b4_c0.log; then echo "DB_UNAVAILABLE PRESENT"; exit 1; fi

mode_diff=$(diff <(grep "^--- " /tmp/b4_c1.log | awk '{print $2, $NF}') <(grep "^--- " /tmp/b4_c0.log | awk '{print $NF}'))
if [ -n "$mode_diff" ]; then echo "CLOCK MODES DIFFER:"; echo "$mode_diff"; exit 1; fi
echo "both clock modes identical ($(grep -c '^--- ' /tmp/b4_c1.log) cases)"

tally=$(grep -o "errors=[A-Z_|]*" /tmp/b4_c1.log | sort | uniq -c | tr '\n' ' ')
echo "denials: $tally"

node ops/b4-proof.mjs "$owner" > /tmp/b4_proof.log 2>&1
tail -3 /tmp/b4_proof.log
if ! grep -q "B4 ${owner^^} PASS" /tmp/b4_proof.log; then echo "PROOF FAILED"; cat /tmp/b4_proof.log; exit 1; fi

git add -A
git commit -q -m "feat: B4 ${owner} reads Postgres

- ${owner} resolvers read their own tables through the per-request RLS client
- suite identical in DEMO_CLOCK=1 and DEMO_CLOCK=0
- evidence 21-b4-${owner}.md: named-row reality check, paired RLS, reset checksums"
git push -q origin main
echo "COMMITTED ${owner} $(git rev-parse --short HEAD)"
