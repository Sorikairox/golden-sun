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
# Kraden, Mt. Aleph, Sol Sanctum's stepping stones, a random battle won; needs port_work/regress/vale_day1.sav, made first),
# sol_sanctum_save (GS13: the Sol Sanctum save, SHA-1 kept), sol_jewels (GS13: from it, both Small Jewels set, the
# statues Moved, the maze; its save SHA-1 kept), sol_star_room (GS14: from it, statue 2 and 6 Moved, the round passage,
# the Luna/Sol rooms, the statue puzzle, the Elemental Star Room to the Jupiter Star event; its save SHA-1 kept), mt_aleph (GS15: from it, the Mars Star, the
# eruption, Retreat, Sol Entrance, Vale's eruption, the Sanctum's quest, Vale's farewell, the World Map save; SHA-1 kept), battle_fight,
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
  "sol_sanctum_save|22200|22100,22200||$R/vale_day1_continue.keys,$R/vale_sanctum.keys,$R/sol_sanctum.keys,$R/sol_sanctum_save.keys||--flash-in $W/vale_day1.sav --flash-out $W/sol_sanctum.sav"
  "sol_jewels|33700|2000,4300,7700,11300,15000,16900,17900,22700,28000,31000,32500,33700||$R/vale_day1_continue.keys,$R/sol_jewels.keys,$R/sol_jewels_save.keys||--flash-in $W/sol_sanctum.sav --flash-out $W/sol_jewels.sav"
  "sol_star_room|75700|3016,6700,7900,13000,17000,20000,24000,31600,37000,40000,56500,58500,66000,75100,75700||$R/vale_day1_continue.keys,$R/sol_star_room.keys,$R/sol_star_room_save.keys||--flash-in $W/sol_jewels.sav --flash-out $W/sol_star_room.sav"
  "mt_aleph|59300|3640,4500,9000,14000,20000,23600,25600,26100,27200,33600,40000,50000,58100,59300||$R/vale_day1_continue.keys,$R/mt_aleph.keys,$R/mt_aleph_save.keys||--flash-in $W/sol_star_room.sav --flash-out $W/mt_aleph.sav"
)
# the case that writes each save a later case starts from (made first when only the later case is asked for)
maker() { case "$1" in $W/vale_day1.sav) echo vale_day1_save;; $W/sol_sanctum.sav) echo sol_sanctum_save;; $W/sol_jewels.sav) echo sol_jewels;; $W/sol_star_room.sav) echo sol_star_room;; esac; } # bash 3.2: no associative arrays
flash_out() { [[ "$1" =~ --flash-out\ ([^ ]+) ]] && echo "${BASH_REMATCH[1]}"; }
case_of() { local c; for c in "${CASES[@]}"; do [ "${c%%|*}" = "$1" ] && echo "$c"; done; }
premake() { # the save this case starts from, written by its maker case (and that one's own first), unless selected
  [[ "$1" =~ --flash-in\ ([^ ]+) ]] || return 0
  local f=${BASH_REMATCH[1]}; local m; m=$(maker "$f")
  [ -z "$m" ] && return 0; want "$m" && return 0
  local n fr a e k p x; IFS='|' read -r n fr a e k p x <<< "$(case_of "$m")"
  premake "$x"; rm -f "$f"
  perl -e "alarm ${LIMIT:-240}; exec @ARGV" node tests/boot.cjs $BIN/game.js "$ROM" "$fr" --keys-file "$k" --quiet --out $W/shots $x > $W/$m.pre.log 2>&1
}
want() { [ $# -eq 0 ] && return 0; local c; for c in "${SEL[@]}"; do [ "$c" = "$1" ] && return 0; done; return 1; }
SEL=("$@")
out=$W/actual.tsv; : > $out
fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r name frames at envs keys probes extra <<< "$c"
  [ ${#SEL[@]} -gt 0 ] && ! want "$name" && continue
  log=$W/$name.log
  [ ${#SEL[@]} -gt 0 ] && premake "$extra"
  env $envs DIGEST_AT=$at perl -e "alarm ${LIMIT:-240}; exec @ARGV" node tests/boot.cjs $BIN/game.js "$ROM" "$frames" \
    --keys-file "$keys" --probe "${probes:+$probes,}$P/digest.cjs" --quiet --out $W/shots $extra > "$log" 2>&1
  grep '^digest' "$log" | while read -r _ f _ ram _ pic; do printf '%s\t%s\t%s\t%s\n' "$name" "$f" "$ram" "$pic"; done >> $out
  fo=$(flash_out "$extra")
  if [ -n "$fo" ] && [ -f "$fo" ]; then # the save the route wrote
    printf '%s\tsave\t%s\t-\n' "$name" "$(shasum "$fo" | cut -c1-16)" >> $out
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
