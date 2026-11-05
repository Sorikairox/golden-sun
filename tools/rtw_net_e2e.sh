#!/bin/bash
# RTW2: GS1's online link battle in the real retrowser host (docs/RTW.md section 7): tests/rtw_net_e2e.mjs, two
# players in one muted headless Chrome (nothing left running), in up to three runs of ~2 min each:
#   tools/rtw_net_e2e.sh [OUTDIR] [battle|drop|leave ...]    (default port_work/rtw2/e2e, all three)
#     battle  a whole link battle, hashes and link state on both sides, then player 2's page closes (dropped peer)
#     drop    player 2's page closes in the middle of the battle (DROP_AT=3300), then a single player plays alone
#     leave   a whole battle, then player 2 leaves from the host's Online panel
# Timing-sensitive: take the shared Chrome lock around it. Tests what tools/rtw_publish.sh put in retrowser.json +
# retrowser/. Needs the local retrowser checkout built (cd ~/Code/retrowser && npm run build) and the battle test
# save port_work/g7/flash_battle.sav (tools/link2.sh).
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-port_work/rtw2/e2e}; shift 2>/dev/null || true
RUNS=${*:-battle drop leave}
fails=0
mkdir -p "$OUT"
for r in $RUNS; do
  case $r in
    battle) env=() ;;
    drop) env=(DROP_AT=3300 SOLO=1) ;;
    leave) env=(LEAVE=1) ;;
    *) echo "unknown run $r"; exit 2 ;;
  esac
  env "${env[@]+"${env[@]}"}" node tests/rtw_net_e2e.mjs "$OUT/$r" > "$OUT/$r.log" 2>&1
  rc=$?
  echo "== $r"; grep -E "PASS|FAIL|ERROR|TIMEOUT" "$OUT/$r.log" | cut -c1-230
  [ $rc = 0 ] || fails=$((fails + 1))
done
[ $fails = 0 ] && echo "RTW_NET_E2E: ALL PASS ($RUNS)" || { echo "RTW_NET_E2E: $fails run(s) failed (logs in $OUT)"; exit 1; }
