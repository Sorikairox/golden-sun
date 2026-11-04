#!/bin/bash
# TLA6: regression runs for The Lost Age, as tools/regress.sh does for GS1: replays the key routes in node
# (tests/routes/tla/*.keys, inputs only) and compares RAM/picture digests (tests/probes/digest.cjs) and the save's
# SHA-1 with tests/regress/expected_tla.tsv (digests only: nothing of the game is stored). Runs on a private copy of
# build/wasm-tla (port_work/regress_tla/bin), so a rebuild during a run does not mix builds.
# Usage: tools/regress_tla.sh [--update] [CASE...]
# Cases (milestone screens):
#   new_game  logos (Nintendo 120, Camelot 250), title logo 380, Felix naming 450, the transfer question 600,
#             Isaac naming 700
#   opening   the intro (3000 clouds, 6000 The Lost Age), the Venus Lighthouse talk (9000, 12000), the area name 14560,
#             Jenna under control 14700
#   walk      from opening: Jenna walks off the door cell, up into the aerie and back (14660, 14800, 14900, 15010)
#   save      from opening: pause menu 14750, Save 14800, "Your game was saved" 14950; the flash's SHA-1
#   continue  with save's flash: the intro 300, Continue (file 1: Jenna, Venus Lighthouse) at 700-900, back in the field 1100
#             (the same picture as opening 14700), the field menu 1300 and 1700
#   down      (TLA6b) from opening: the way down the lighthouse's rooms (14800 the room behind the door, 15200, 15700 the
#             Venus Lighthouse entrance), 16100 Jenna below the steps (step trigger 9 moved the statues)
#   battle    (TLA6b) from down: the guards and Alex (16500, 20000, 24000), Kraden's talk 26800, the Ruffian's talk 28100,
#             the first battle ("Ruffian appeared!") 28300 and 28700
#   win       (TLA7) from battle: Fight, Psynergy, Fume on the Ruffian (28720 the target, 28880 the flames), "You felled
#             Ruffian!" 29120, the field back 29240, west past the beaten Ruffian into Suhalla Gate (scene 6) 29500, 29800
#   gate      (TLA7) from win: up the Suhalla Gate ledges to trigger 20 (30100 "Waahhh! It's them!"), the second Ruffian
#             battle (30600, 31000 the rewards), back on the plateau 31300, west to scene 7's mountain path 31500, 31800
#   cave      (TLA8) from gate: down scene 7's two vines to the cave mouth (32300 the three Ruffians), the third battle
#             (33180 Psynergy: Fume, 34700 won), scene 8's cave (35700), a Punch Ant won and Kraden (37300), scene 9 37900
#   idejima   (TLA8) from cave: Alex, the beam, the island adrift (40000, 46000), Felix and Sheba (50000), Felix's check
#             for injuries (54300), Felix under control on Idejima 55300
#   party     (TLA8) from idejima: Kraden wakes and joins (55700, 56200), Jenna (56800, 57200), Sheba (58100, 58500), the
#             field with the party of three 58700
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
W=$ROOT/port_work/regress_tla
EXP=$ROOT/tests/regress/expected_tla.tsv
R=tests/routes/tla
UPDATE=0
[ "${1:-}" = "--update" ] && { UPDATE=1; shift; }
SEL=("$@")
mkdir -p $W/bin $W/shots
cp build/wasm-tla/game.js build/wasm-tla/game.wasm $W/bin/
# name | frames | digest frames | key files | extra
CASES=(
  "new_game|700|120,250,380,450,600,700|$R/new_game.keys|"
  "opening|14700|3000,6000,9000,12000,14560,14700|$R/new_game.keys,$R/opening.keys|"
  "walk|15010|14660,14800,14900,15010|$R/new_game.keys,$R/opening.keys,$R/walk.keys|"
  "save|15300|14750,14800,14950,15250|$R/new_game.keys,$R/opening.keys,$R/save.keys|--flash-out $W/save.sav"
  "continue|1800|300,1100,1300,1700|$R/continue.keys|--flash-in $W/save.sav"
  "down|16100|14800,15200,15700,16100|$R/new_game.keys,$R/opening.keys,$R/down.keys|"
  "battle|28700|16500,20000,24000,26800,28100,28300,28700|$R/new_game.keys,$R/opening.keys,$R/down.keys,$R/battle.keys|"
  "win|29800|28720,28880,29120,29240,29500,29800|$R/new_game.keys,$R/opening.keys,$R/down.keys,$R/battle.keys,$R/win.keys|"
  "gate|31800|30100,30600,31000,31300,31500,31800|$R/new_game.keys,$R/opening.keys,$R/down.keys,$R/battle.keys,$R/win.keys,$R/gate.keys|"
  "cave|37900|32300,33180,34700,35700,37300,37900|$R/new_game.keys,$R/opening.keys,$R/down.keys,$R/battle.keys,$R/win.keys,$R/gate.keys,$R/cave.keys|"
  "idejima|55300|40000,46000,50000,54300,55300|$R/new_game.keys,$R/opening.keys,$R/down.keys,$R/battle.keys,$R/win.keys,$R/gate.keys,$R/cave.keys,$R/idejima.keys|"
  "party|58700|55700,56200,56800,57200,58100,58500,58700|$R/new_game.keys,$R/opening.keys,$R/down.keys,$R/battle.keys,$R/win.keys,$R/gate.keys,$R/cave.keys,$R/idejima.keys,$R/party.keys|"
)
want() { [ ${#SEL[@]} -eq 0 ] && return 0; local c; for c in "${SEL[@]}"; do [ "$c" = "$1" ] && return 0; done; return 1; }
out=$W/got.tsv
: > $out
fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r name frames at keys extra <<< "$c"
  want "$name" || { [ "$name" = save ] && want continue && [ ! -f $W/save.sav ]; } || continue
  [ "$name" = save ] && rm -f $W/save.sav
  log=$W/$name.log
  DIGEST_AT=$at node tests/boot.cjs $W/bin/game.js "$HOME/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba" "$frames" \
    --keys-file "$keys" --probe tests/probes/digest.cjs --quiet --out $W/shots $extra > "$log" 2>&1
  grep '^digest' "$log" | while read -r _ f _ ram _ pic; do printf '%s\t%s\t%s\t%s\n' "$name" "$f" "$ram" "$pic"; done >> $out
  if [ "$name" = save ]; then
    if [ -f $W/save.sav ]; then printf 'save\tflash\t%s\t-\n' "$(shasum $W/save.sav | cut -c1-16)" >> $out
    else printf 'save\tflash\tmissing\t-\n' >> $out; fi
  fi
  grep -q 'game stopped\|stub:' "$log" && { echo "$name: STOP ($(grep -m1 'game stopped\|stub:' "$log"))"; fail=1; }
done
if [ $UPDATE = 1 ]; then
  { [ -f $EXP ] && awk -F'\t' -v sel="$(cut -f1 $out | sort -u | tr '\n' ' ')" 'index(" " sel, " " $1 " ") == 0' $EXP; cat $out; } \
    | sort -t$'\t' -k1,1 -k2,2n > $EXP.new && mv $EXP.new $EXP
  echo "expected digests updated: $(wc -l < $EXP) rows in $EXP"; exit $fail
fi
for name in $(cut -f1 $out | uniq); do
  if diff <(grep "^$name	" $EXP | sort) <(grep "^$name	" $out | sort) > /dev/null; then echo "$name: OK"
  else echo "$name: DIFF"; diff <(grep "^$name	" $EXP | sort) <(grep "^$name	" $out | sort) | head -6; fail=1; fi
done
[ $fail = 0 ] && echo "REGRESS_TLA_RESULT: ALL OK" || echo "REGRESS_TLA_RESULT: FAIL"
exit $fail
