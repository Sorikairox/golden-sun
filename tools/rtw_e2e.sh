#!/bin/bash
# The retrowser.app build in the real retrowser host (docs/RTW.md): tests/rtw_e2e.mjs for GS1, then The Lost Age
# (one muted headless Chrome at a time; the host's dist and a GitHub mock served in-process, nothing left running).
#   tools/rtw_e2e.sh [OUTDIR] [gs1|tla ...]      (default port_work/rtw/e2e, both games; ~2.5 + ~5.5 min)
# Tests what tools/rtw_publish.sh put in retrowser.json + retrowser/ (staged as the repo's main). Needs the local
# retrowser checkout built (cd ~/Code/retrowser && npm run build; RETROWSER_DIR to use another).
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-port_work/rtw/e2e}; shift 2>/dev/null || true
GAMES=${*:-gs1 tla}
fails=0
mkdir -p "$OUT"
for g in $GAMES; do
  node tests/rtw_e2e.mjs $g "$OUT" > "$OUT/$g.log" 2>&1
  rc=$?
  grep -E "FAIL|ERROR|TIMEOUT|RTW_E2E" "$OUT/$g.log" | cut -c1-220
  [ $rc = 0 ] || fails=$((fails + 1))
done
[ $fails = 0 ] && echo "RTW_E2E: ALL PASS ($GAMES)" || { echo "RTW_E2E: $fails game(s) failed (logs in $OUT)"; exit 1; }
