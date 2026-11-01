#!/bin/bash
# Regression runs (GS9): replays the key node runs and compares RAM/picture digests (tests/probes/digest.cjs) with
# tests/regress/expected.tsv (digests only, no images). Cases run on a private copy of the build (port_work/regress/bin).
#   tools/regress.sh            run all cases, print OK/DIFF per case, exit 1 on any DIFF
#   tools/regress.sh --update   rewrite expected.tsv from this build (after a change that is meant to alter results)
#   tools/regress.sh CASE...    run only these cases
# Cases: prologue_save (+ cmp of the saved flash with the stored SHA-1), soft_reset (the game's own reset, title,
# Continue), garet, boulder, vale_monsters, vale_felix,
# vale_plaza (real play: GS11, the prologue's four monster fights to Vale three years later), vale_day1_save (GS12:
# the opening to the Vale day-one save, its flash SHA-1 kept), vale_sanctum (GS12: from that save, Saturos and Menardi,
# Kraden, Mt. Aleph, Sol Sanctum's stepping stones, a random battle won; needs port_work/regress/vale_day1.sav, made first), battle_fight,
# battle_party, battle_summon, battle_lost, field_psynergy, worldmap, credits (test-only probes), link2 (two
# instances, its own RAM digests).
set -uo pipefail
cd "$(dirname "$0")/.."
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
EXP=tests/regress/expected.tsv
W=port_work/regress; BIN=$W/bin; mkdir -p $BIN
cp build/wasm/game.js build/wasm/game.wasm $BIN/
update=0; [ "${1:-}" = --update ] && { update=1; shift; }
R=tests/routes; P=tests/probes
PRO=$R/prologue.keys; ROCK=$R/prologue.keys,$R/first_rock.keys
# name | frames | digest frames | env | keys | probes (digest added) | extra
CASES=(
  "prologue_save|5400|5400||$PRO,$R/first_save.keys||--flash-out $W/prologue.sav"
  "garet|6900|5850,6900||$PRO,$R/vale_garet.keys||"
  "boulder|10200|8000,9600,10200||$PRO,$R/vale_garet.keys,$R/vale_boulder.keys||"
  "battle_fight|7000|6000,7000||$ROCK,$R/battle_fight.keys|$P/battle.cjs|"
  "battle_party|8400|7200,8400||$ROCK,$R/battle_party.keys|$P/party.cjs,$P/battle.cjs|"
  "battle_summon|9000|7600,9000|PARTY_STANDBY=1 BATTLE_ZONE=60|$ROCK,$R/battle_summon.keys|$P/party.cjs,$P/battle.cjs|"
  "battle_lost|7000|6200,7000|BATTLE_ZONE=60|$ROCK,$R/battle_lost.keys|$P/battle.cjs|"
  "field_psynergy|6600|5950,6300||$ROCK,$R/field_psynergy.keys|$P/party.cjs|"
  "worldmap|6400|5750,5900,6400|WARP_AT=5400|$ROCK,$R/worldmap.keys|$P/warp.cjs|"
  "credits|5700|5650|CRED_AT=5400|$ROCK|$P/credits.cjs|"
  "soft_reset|8000|5700,7000,8000||$PRO,$R/first_save.keys,$R/soft_reset.keys||"
  "vale_monsters|14800|11600,12400,14800||$PRO,$R/vale_garet.keys,$R/vale_boulder.keys,$R/vale_monsters.keys||"
  "vale_felix|21950|17000,20300,21950||$PRO,$R/vale_garet.keys,$R/vale_boulder.keys,$R/vale_monsters.keys,$R/vale_felix.keys||"
  "vale_plaza|40000|30000,35500,36900,40000||$PRO,$R/vale_garet.keys,$R/vale_boulder.keys,$R/vale_monsters.keys,$R/vale_felix.keys,$R/vale_plaza.keys||"
  "vale_day1_save|57000|43900,52000,57000||$PRO,$R/vale_garet.keys,$R/vale_boulder.keys,$R/vale_monsters.keys,$R/vale_felix.keys,$R/vale_plaza.keys,$R/vale_day1_save.keys||--flash-out $W/vale_day1.sav"
  "vale_sanctum|21800|2000,5000,9500,14600,16700,17800,18700,19400,21800||$R/vale_day1_continue.keys,$R/vale_sanctum.keys,$R/sol_sanctum.keys||--flash-in $W/vale_day1.sav"
)
want() { [ $# -eq 0 ] && return 0; local c; for c in "${SEL[@]}"; do [ "$c" = "$1" ] && return 0; done; return 1; }
SEL=("$@")
out=$W/actual.tsv; : > $out
fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r name frames at envs keys probes extra <<< "$c"
  [ ${#SEL[@]} -gt 0 ] && ! want "$name" && continue
  log=$W/$name.log
  if [[ "$extra" == *"--flash-in $W/vale_day1.sav"* ]] && [ ${#SEL[@]} -gt 0 ] && ! want vale_day1_save; then # make the save it starts from
    rm -f $W/vale_day1.sav; IFS='|' read -r _ sf _ _ sk _ sx <<< "${CASES[$(( ${#CASES[@]} - 2 ))]}"
    perl -e "alarm ${LIMIT:-240}; exec @ARGV" node tests/boot.cjs $BIN/game.js "$ROM" "$sf" --keys-file "$sk" --quiet --out $W/shots $sx > $W/vale_day1_save.pre.log 2>&1
  fi
  env $envs DIGEST_AT=$at perl -e "alarm ${LIMIT:-240}; exec @ARGV" node tests/boot.cjs $BIN/game.js "$ROM" "$frames" \
    --keys-file "$keys" --probe "${probes:+$probes,}$P/digest.cjs" --quiet --out $W/shots $extra > "$log" 2>&1
  grep '^digest' "$log" | while read -r _ f _ ram _ pic; do printf '%s\t%s\t%s\t%s\n' "$name" "$f" "$ram" "$pic"; done >> $out
  if [[ "$extra" == --flash-out* ]] && [ -f "${extra#--flash-out }" ]; then # the save the route wrote
    printf '%s\tsave\t%s\t-\n' "$name" "$(shasum "${extra#--flash-out }" | cut -c1-16)" >> $out
  fi
  grep -q 'game stopped\|Aborted\|killed after' "$log" && { echo "$name: STOPPED (see $log)"; fail=1; }
done
if [ ${#SEL[@]} -eq 0 ] || want link2; then
  LOG=$W/link2.log GAME=$BIN/game.js OUT=$W/link2 tools/link2.sh > $W/link2.summary
  grep '^ram digest' $W/link2.log | awk '{print "link2\tend\t" $4 "\t" $6}' >> $out
  grep -q 'DIFFER\|stopped' $W/link2.log && { echo "link2: DIFFER/stopped (see $W/link2.log)"; fail=1; }
fi
if [ $update = 1 ]; then
  mkdir -p tests/regress
  if [ ${#SEL[@]} -gt 0 ] && [ -f $EXP ]; then # keep the other cases' rows
    awk -F'\t' 'NR==FNR{n[$1]=1; next} !($1 in n)' $out $EXP > $W/keep.tsv; cat $W/keep.tsv $out | sort -s -k1,1 > $EXP
  else sort -s -k1,1 $out > $EXP; fi
  echo "expected digests updated: $(wc -l < $EXP) rows in $EXP"; exit $fail
fi
for name in $(cut -f1 $out | uniq); do
  if diff <(grep "^$name	" $EXP | sort) <(grep "^$name	" $out | sort) > /dev/null; then echo "$name: OK"
  else echo "$name: DIFF"; diff <(grep "^$name	" $EXP | sort) <(grep "^$name	" $out | sort) | sed 's/^/    /' | head -6; fail=1; fi
done
exit $fail
