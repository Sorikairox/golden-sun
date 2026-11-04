#!/bin/bash
# TLA8: the games' own transfer by password, by hand (docs/TLA8.md). Every step is the games' own code driven by keys:
#  1. GS1: the test-only cleared save (TLA_PLAN 3.3 / 6.1): ml_saturos_win.sav (tools/regress.sh ml_saturos_win makes
#     it) continued, the warp probe to the File Screen at FILE_SCREEN_FROM_TITLE, Yes, file 2 (tests/routes/gs1_clear.keys)
#  2. GS1: power-on with it, the hidden Send (R+Left), file 2, Password, Gold / Silver / Bronze
#     (tests/routes/gs1_send.keys); tests/probes/password.cjs reads each password the screen shows, ramdump.cjs keeps
#     GS1's state with the file loaded (gSaveBuffer = the state's own layout) for the checks
#  3. TLA: new game, "Transfer data from Golden Sun?" Yes, Password, the level, the symbols typed on the entry grid by
#     keys (tools/pw2keys.cjs), Finish, Isaac named, the party review left with B: Func_080ae410 takes the state
#  4. tests/probes/transfer_check.cjs: TLA's party against the vendor's rules (levels, experience, base stats, Djinn,
#     story flags, items and counts, coins, Func_080ae410's flags), printed PASS/FAIL with digests
# Everything the games produce (save, passwords, keys, dumps, captures) stays in port_work/tla8 (save-derived data).
# Cases cable and route_a (tests/transfer_a.cjs): route_a links a real GS1 instance (hidden Send -> Cable) with TLA
# (Yes -> Cable) through port/pc/link.c: the greetings meet, GS1 sends its 4100-byte save part (TLA9a: BULK_MAX 4352
# in both games; TLA8's 4096 sent 0 bytes), TLA imports it, the review is left with B and TLA's party is checked
# (transfer_check.cjs cable); cable runs TLA's receive against a stand-in that plays GS1's side with the 4100 bytes
# GS1's Save_ChooseAndLoadFile loaded, with the same checks. Both give the same units and flags SHA-1.
# Usage: tools/transfer_pw.sh [--update] [--twice] [gold|silver|bronze|cable|route_a ...]   (--twice: each TLA route twice, digests
# compared). The digests (cleared save SHA-1, TLA's units/flags SHA-1, RAM and picture digests after the import) are
# compared with tests/regress/expected_transfer.tsv; --update rewrites it.
set -uo pipefail
cd "$(dirname "$0")/.."
W=port_work/tla8; mkdir -p $W/shots
GS1="build/wasm/game.js $HOME/roms/Golden_Sun_USA_Europe.gba"
update=0; [ "${1:-}" = --update ] && { update=1; shift; }
twice=0; [ "${1:-}" = --twice ] && { twice=1; shift; }
EXP=tests/regress/expected_transfer.tsv; got=$W/got.tsv; : > $got
LEVELS=("$@"); [ ${#LEVELS[@]} -eq 0 ] && LEVELS=(gold silver bronze cable route_a)
src=port_work/regress/ml_saturos_win.sav
[ -f $src ] || { echo "missing $src (tools/regress.sh ml_saturos_win)"; exit 2; }
fail=0
# 1. the cleared save
WARP_AT=2100 WARP_SCENE=1 WARP_ENTRANCE=2 node tests/boot.cjs $GS1 3000 --quiet --keys-file tests/routes/gs1_clear.keys \
  --probe tests/probes/warp.cjs --flash-in $src --flash-out $W/gs1_clear.sav --shot 2850 --out $W/shots/clear > $W/clear.log 2>&1
sha=$(shasum $W/gs1_clear.sav | cut -c1-12)
echo "cleared save: sha1 $sha (file 2, sendFlag set by Save_ToChosenFile)"
printf 'clear\tsave\t%s\n' "$sha" >> $got
# 2. the passwords (Gold first: its 26 check groups locate the buffer; Silver/Bronze are read at the same place)
sel() { case $1 in gold) echo "A@2080-2082,A@2400-2402 260";; silver) echo "A@2080-2082,RIGHT@2300-2302,A@2400-2402 61";;
  bronze) echo "A@2080-2082,RIGHT@2300-2302,RIGHT@2340-2342,A@2420-2422 16";; esac; }
addr=
for L in gold "${LEVELS[@]}"; do
  [ "$L" = gold ] && [ -n "$addr" ] && continue
  case $L in cable|route_a) continue;; esac
  set -- $(sel $L)
  DUMP_AT=2550 DUMP_OUT=$W/gs1_ram_send.bin PW_ADDR=$addr PW_N=$2 PW_AT=2600 PW_OUT=$W/pw_$L.json \
    node tests/boot.cjs $GS1 2610 --quiet --keys-file tests/routes/gs1_send.keys --keys "$1" \
    --probe tests/probes/password.cjs,tests/probes/ramdump.cjs --flash-in $W/gs1_clear.sav --shot 2600 --out $W/shots/gs1_$L > $W/gs1_$L.log 2>&1
  grep '^password' $W/gs1_$L.log | sed "s/^/$L: /" | sed 's/ at 0x[0-9a-f]*//'
  [ "$L" = gold ] && addr=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$W/pw_gold.json')).at.toString(16))")
  node tools/pw2keys.cjs $W/pw_$L.json 1100 > $W/pw_$L.keys
done
# 3-4. TLA, typed and checked
run() {
  local L=$1 tag=$2 E SELT
  E=$(head -1 $W/pw_$L.keys | sed 's/.*ends at f//')
  case $L in gold) SELT="";; silver) SELT="RIGHT@800-802,";; bronze) SELT="RIGHT@790-792,RIGHT@815-817,";; esac
  local K="${SELT}A@850-852,START@$((E+280))-$((E+282)),A@$((E+310))-$((E+312)),B@$((E+480))-$((E+482))"
  local AT=$((E+580))
  DIGEST_AT=$AT TC_GS1=$W/gs1_ram_send.bin TC_MODE=$L TC_AT=$AT node tests/boot.cjs --game tla $((AT+1)) --quiet --keys "$K" \
    --keys-file tests/routes/tla/transfer_pw.keys,$W/pw_$L.keys --probe tests/probes/transfer_check.cjs,tests/probes/digest.cjs \
    --shot $((E-20)),$((E+300)),$((E+400)),$AT --out $W/shots/tla_${L}$tag > $W/tla_${L}$tag.log 2>&1
  grep -q 'FAIL' $W/tla_${L}$tag.log && { grep 'FAIL' $W/tla_${L}$tag.log; fail=1; }
  grep '^transfer_check' $W/tla_${L}$tag.log | sed 's/^transfer_check //'
  [ -z "$tag" ] && { grep '^transfer_check' $W/tla_$L.log | awk -v l=$L '{print l "\tunits_flags\t" $(NF-3) " " $NF}' >> $got;
    grep '^digest' $W/tla_$L.log | awk -v l=$L '{print l "\tram_pic\t" $4 " " $6}' >> $got; }
}
# GS1's state with the cleared file loaded, on the Transfer Method screen (the bytes its cable send would carry)
DUMP_AT=2000 DUMP_OUT=$W/gs1_ram_cable.bin node tests/boot.cjs $GS1 2001 --quiet --keys-file tests/routes/gs1_send.keys \
  --probe tests/probes/ramdump.cjs --flash-in $W/gs1_clear.sav --out $W/shots/gs1_cable > /dev/null 2>&1
cable() {
  local L=$1 tag=$2
  if [ $L = cable ]; then
    TC_MODE=cable TC_GS1=$W/gs1_ram_cable.bin TC_PRE=700 TC_AT=1100 node tests/transfer_a.cjs --virtual $W/gs1_ram_cable.bin \
      --frames 1102 --keys1 B@1000-1002 --probe1 tests/probes/transfer_check.cjs --shot 790,900,1100 --out $W/shots/cable$tag > $W/tla_cable$tag.log 2>&1
  else
    TC_MODE=cable TC_GS1=$W/gs1_ram_cable.bin TC_PRE=2021 TC_AT=2421 node tests/transfer_a.cjs --frames 2423 \
      --keys1 B@2321-2323 --probe1 tests/probes/transfer_check.cjs --shot 2050,2110,2300,2421 --out $W/shots/route_a$tag > $W/tla_route_a$tag.log 2>&1
  fi
  grep -q 'FAIL' $W/tla_$L$tag.log && { grep 'FAIL' $W/tla_$L$tag.log; fail=1; }
  grep '^transfer_check\|bulk on the wire\|^route_a' $W/tla_$L$tag.log | sed 's/^transfer_check //'
  [ -z "$tag" ] && grep '^route_a' $W/tla_$L.log | awk -v l=$L '{print l "\tram_units\t" $(NF-2) " " $NF}' >> $got
}
for L in "${LEVELS[@]}"; do
  case $L in cable|route_a)
    cable $L ""
    if [ $twice = 1 ]; then cable $L _2
      [ "$(grep -v '^boot' $W/tla_$L.log)" = "$(grep -v '^boot' $W/tla_${L}_2.log)" ] && echo "$L: second run identical" || { echo "$L: runs DIFFER"; fail=1; }
    fi
    continue;; esac
  run $L ""
  if [ $twice = 1 ]; then
    run $L _2
    a=$(grep -v '^boot' $W/tla_$L.log | grep -i 'digest\|transfer_check'); b=$(grep -v '^boot' $W/tla_${L}_2.log | grep -i 'digest\|transfer_check')
    [ "$a" = "$b" ] && echo "$L: second run identical (checks and RAM digests)" || { echo "$L: runs DIFFER"; fail=1; }
  fi
done
if [ $update = 1 ]; then
  { echo "# tools/transfer_pw.sh digests (TLA8): case, what, digest (no game data)"; cat $got; } > $EXP; echo "wrote $EXP"
elif [ -f $EXP ]; then
  while IFS=$'\t' read -r c w d; do
    e=$(awk -F'\t' -v c="$c" -v w="$w" '$1 == c && $2 == w {print $3}' $EXP)
    [ "$e" = "$d" ] && echo "$c $w OK" || { echo "$c $w DIFF (expected '$e', got '$d')"; fail=1; }
  done < $got
fi
exit $fail
