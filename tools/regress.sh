#!/bin/bash
# Regression runs (GS9): replays the key node runs and compares RAM/picture digests (tests/probes/digest.cjs) with
# tests/regress/expected.tsv (digests only, no images). Cases run on a private copy of the build (port_work/regress/bin).
#   tools/regress.sh            run all cases, print OK/DIFF per case, exit 1 on any DIFF
#   tools/regress.sh --update   rewrite expected.tsv from this build (after a change that is meant to alter results)
#   tools/regress.sh CASE...    run only these cases
#   tools/regress.sh --quick    core probe cases + the newest QUICK_N (default 3) story cases, reusing the saves an
#                               earlier run left in port_work/regress (REUSE=1); ~1 min. The full run (~5+ min) stays the
#                               end-of-session check.
#   REUSE=1 tools/regress.sh CASE...  keep a start save an earlier run made instead of replaying its maker chain
# Cases: prologue_save (+ cmp of the saved flash with the stored SHA-1), soft_reset (the game's own reset, title,
# Continue), garet, boulder, vale_monsters, vale_felix,
# vale_plaza (real play: GS11, the prologue's four monster fights to Vale three years later), vale_day1_save (GS12:
# the opening to the Vale day-one save, its flash SHA-1 kept), vale_sanctum (GS12: from that save, Saturos and Menardi,
# Kraden, Mt. Aleph, Sol Sanctum's stepping stones, a random battle won; needs port_work/regress/vale_day1.sav, made first),
# sol_sanctum_save (GS13: the Sol Sanctum save, SHA-1 kept), sol_jewels (GS13: from it, both Small Jewels set, the
# statues Moved, the maze; its save SHA-1 kept), sol_star_room (GS14: from it, statue 2 and 6 Moved, the round passage,
# the Luna/Sol rooms, the statue puzzle, the Elemental Star Room to the Jupiter Star event; its save SHA-1 kept), mt_aleph (GS15: from it, the Mars Star, the
# eruption, Retreat, Sol Entrance, Vale's eruption, the Sanctum's quest, Vale's farewell, the World Map save; SHA-1 kept), vault (GS15: from it,
# Flint and the Djinn lesson, the World Map to Vault, Hammet's caravan, Ivan joins in the mayor's house, save; SHA-1 kept),
# vault_inn (GS15: from it, the inn's guests' room, the suspects flee Ivan, the plan to corner one; save, SHA-1 kept), vault_crate (GS16: from it,
# the cornering chase, Ivan's Mind Read, out of the inn, Move on the crate; save, SHA-1 kept), vault_grind (GS16: from it, Ivan stays
# behind, 78 World Map battles to Isaac Lv 6; save), vault_thieves (GS16: from it, Ivan rejoins, the loft, the thieves'
# battle won, the Shaman's Rod, Ivan leaves; save), goma_entrance, goma_ivan, goma_pillar (GS17), goma_forge (GS18: from
# goma_pillar, the pond room, Move on the west pillar and the stump, across the pond, Forge's battle won; save), bilibin (GS18: from goma_forge,
# the stream room's stump Moved into the stream, the bridge, the World Map to Bilibin; save), mccoy (GS18: from
# bilibin, Mind Read on the tree man, the palace gate, McCoy's audience, the captain's hint; save), kolima (GS18: from mccoy, the
# Bilibin Barricade's crates Moved, the World Map to Kolima, the forest curse scene; save), kolima_forest (GS18: from
# kolima, Cure, the World Map to Kolima Forest; save), kolima_grind (GS19: from kolima_forest, 82 battles by grindbot, Lv 9; save),
# kolima_glade (GS19: from kolima_grind, the entrance's logs (the river log), the glade's logs, to the cliff; save),
# kolima_cliff (GS19: from kolima_glade, the cliff's three logs, the river log tips in, the cliff top, to the floodgate; save),
# kolima_floodgate (GS19: from kolima_cliff, the Floodgate Switch twice, a log rolled on the riverbed, the floating logs; save),
# tret_tree (GS19: from kolima_floodgate, Laurel, Tret's wrathful side, the vine into the Tret Tree; save),
# tret_battle (GS19: from tret_tree, a battle with a Djinn unleashed and a summon (battlebot BB_SEQ); save),
# tret_cocoon (GS20: from tret_battle, Cure, the Tret Tree's floors, webs, branches and vines, cocoon 50's falls to Tret; save),
# tret_grind (GS20: from tret_battle, out to Tret's glade, 38 battles by grindbot, Lv 10/10/9, back into the tree; save),
# tret_win (GS21: from tret_grind, the walk to Tret, Tret beaten by battlebot BB_SEQ: Flint set and unleashed, Venus
# summoned, Volcano, Ray, Cure Well; Tret's thanks; save),
# bilibin_cave (GS21: from tret_win, Retreat twice, the World Map round the river, the Bilibin Barricade from the east
# (Move on the crates), the World Map north past Bilibin over two narrow bridges into the Bilibin Cave Entrance; save),
# bilibin_ice (GS21: from bilibin_cave, the south mouth into Bilibin Cave, its corridors to the hole into the ice room; save),
# bilibin_exit (GS22: from bilibin_ice, across the ice room, the torch pushed beside the ice pillar (it melts), south out to
# the World Map; save),
# imil (GS22: from bilibin_exit, the World Map to Imil, Megan, Mia's healing in the old couple's house, the item shop; save),
# lizard_man (GS22: from imil, Mercury Lighthouse's door (Move on the statue, Mia's Ply), the Lizard Man beaten with a Djinn
# unleashed and Venus summoned (battlebot BB_SEQ); save),
# ml_lower (GS22: from lizard_man, the inner door, the goddess's room, the twin fountains, into the lower floor; save),
# mia_joins (GS22: from ml_lower, the stepping stones, Move on the statue blocking Mia: Mia joins; her menus; save),
# ml_ply (GS23: from mia_joins, the Middle's pipe maze (stair pipe, jets, passages under the pipes, a chest), the gate statue
# on its switch, the Lower's hole into the pool's heart, Mia's Ply at 12,32: the pool's lights and shimmer; save),
# ml_upper (GS24: from ml_pipes, the filled room's ring hops, the Upper's stone doors (door switch pipe, the statue falls), the
# stair gate's switch, the five statues (Move on the last), the Middle's fountain pipe, Sleet's room; save before Sleet).
# ml_sleet (GS24: from ml_upper, Sleet's battle by battlebot (Ivan and Mia defend), "Sleet joined Ivan"; save).
# ml_aerie (GS25: from ml_sleet, Ply heals, back through the Upper/Middle, the Exterior, Move on the gap statue, the east path,
# the waterfall's riddle, Ply on its statue from 15 px: the party rises to the Lighthouse Aerie, the platforms; save).
# ml_saturos_loss (GS25: from ml_aerie, the confrontation event, Saturos's battle (Djinn unleashed, a summon, Ray, Mia's
# Tundra/Ply) lost at Lv 10 as the vendor's numbers say; the party wakes in Imil; no save).
# GS26: imil_rest (from ml_aerie via the loss: revives, the inn; save), imil_grind1/imil_grind2 (World Map grind by grindbot +
# scratch smartbot keys, Lv 10 -> 12 -> 15; inn; save; imil_grind2 is long, ~404k frames), ml_upper_return (Imil back up to the
# Upper's stone doors room, reusing GS23/GS24 key spans shifted; save), ml_aerie_lv15 (to the aerie; save), ml_saturos_win
# (Saturos beaten at Lv 15: summons, Forge unleashed, Mia's Ply; Alex's scene; save).
# ml_pipes (GS23: from ml_ply, the pool hops (golden rings) in the goddess's pool and the Lower's pool room, the west twin
# fountains, the passage to the dry fountain room, the Lower's pipe room: the three pipe sections joined, the water ride; save),
# battle_fight,
# battle_party, battle_summon, battle_lost, field_psynergy, worldmap, credits (test-only probes), link2 (two
# instances, its own RAM digests).
# zoom_edges_most, zoom_edges_more (GS31: kolima_glade's route at Map zoom Most, bilibin_ice's at More; zoomjitter.cjs
# fails the case when the zoomed picture jitters at a map's edge: the frame's place must follow the camera the BGs show).
# zoom_menus_field, zoom_menus_shop (GS33: "Menus: Edges", the default, at Map zoom Most: menus_field.keys's field menu, its
# screens, Pause, Extra settings and the World Map's menu in Kolima Forest's entrance at the map's top edge; imil.keys's
# dialogues and item shop; menujitter.cjs fails the case when an open window moves in the frame).
set -uo pipefail
cd "$(dirname "$0")/.."
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
EXP=tests/regress/expected.tsv
# REGRESS_DIR / REGRESS_BUILD (GS29, tools/regress_cmp.sh): another work folder and build (default port_work/regress,
# build/wasm), so two builds can run side by side
W=${REGRESS_DIR:-port_work/regress}; BIN=$W/bin; mkdir -p $BIN
cp ${REGRESS_BUILD:-build/wasm}/game.js ${REGRESS_BUILD:-build/wasm}/game.wasm $BIN/
update=0; [ "${1:-}" = --update ] && { update=1; shift; }
quick=0; [ "${1:-}" = --quick ] && { quick=1; shift; }
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
  "vault|27800|2400,4200,7000,9800,11400,14600,16800,18800,19800,20400,21400,24400,26400,27800||$R/vale_day1_continue.keys,$R/vault.keys,$R/vault_save.keys||--flash-in $W/mt_aleph.sav --flash-out $W/vault.sav"
  "vault_inn|7300|2440,3150,3400,3700,4000,4300,4800,5300,5800,6700,7300||$R/vale_day1_continue.keys,$R/vault_inn.keys,$R/vault_inn_save.keys||--flash-in $W/vault.sav --flash-out $W/vault_inn.sav"
  "vault_crate|7700|2700,2880,3400,4000,4600,5300,5900,6100,6300,6700,7700||$R/vale_day1_continue.keys,$R/vault_crate.keys,$R/vault_crate_save.keys||--flash-in $W/vault_inn.sav --flash-out $W/vault_crate.sav"
  "vault_grind|216000|2600,3044,50000,100000,150000,215300,216000||$R/vale_day1_continue.keys,$R/vault_grind.keys,$R/vault_grind_save.keys||--flash-in $W/vault_crate.sav --flash-out $W/vault_grind.sav"
  "vault_thieves|35300|2200,3300,3700,8400,12000,16000,20100,24000,28000,32000,35300||$R/vale_day1_continue.keys,$R/vault_thieves.keys,$R/vault_thieves_save.keys||--flash-in $W/vault_grind.sav --flash-out $W/vault_thieves.sav"
  "goma_entrance|9400|2700,3500,4600,5200,6600,7720,8300,9400||$R/vale_day1_continue.keys,$R/goma_entrance.keys,$R/goma_entrance_save.keys||--flash-in $W/vault_thieves.sav --flash-out $W/goma_entrance.sav"
  "goma_ivan|13100|2560,3700,4100,5300,7000,9400,10900,11900,12200,13100||$R/vale_day1_continue.keys,$R/goma_ivan.keys,$R/goma_ivan_save.keys||--flash-in $W/goma_entrance.sav --flash-out $W/goma_ivan.sav"
  "goma_pillar|10500|2700,3530,4970,6700,7700,8440,9600,10500||$R/vale_day1_continue.keys,$R/goma_pillar.keys,$R/goma_pillar_save.keys||--flash-in $W/goma_ivan.sav --flash-out $W/goma_pillar.sav"
  "goma_forge|18200|3593,6713,9400,10300,11710,12685,13900,15200,16400,17900,18200||$R/vale_day1_continue.keys,$R/goma_forge.keys,$R/goma_forge_save.keys||--flash-in $W/goma_pillar.sav --flash-out $W/goma_forge.sav"
  "bilibin|7200|2227,3430,3950,4927,5600,5930,6019,6320,6900,7200||$R/vale_day1_continue.keys,$R/bilibin.keys,$R/bilibin_save.keys||--flash-in $W/goma_forge.sav --flash-out $W/bilibin.sav"
  "mccoy|14000|2700,2800,3606,3900,4500,5100,5400,6600,8400,10500,12000,12900,13750,14000||$R/vale_day1_continue.keys,$R/mccoy.keys,$R/mccoy_save.keys||--flash-in $W/bilibin.sav --flash-out $W/mccoy.sav"
  "kolima|24000|2272,2971,6253,6800,7705,9477,11000,12500,14000,16000,18000,20000,22700,23700,24000||$R/vale_day1_continue.keys,$R/kolima.keys,$R/kolima_save.keys||--flash-in $W/mccoy.sav --flash-out $W/kolima.sav"
  "kolima_forest|5150|2500,3200,3580,4263,4400,4900,5150||$R/vale_day1_continue.keys,$R/kolima_forest.keys,$R/kolima_forest_save.keys||--flash-in $W/kolima.sav --flash-out $W/kolima_forest.sav"
  "kolima_grind|262600|2500,30000,64600,120000,200000,261290,261850,262600||$R/vale_day1_continue.keys,$R/kolima_grind.keys,$R/kolima_grind_save.keys||--flash-in $W/kolima_forest.sav --flash-out $W/kolima_grind.sav"
  "kolima_glade|10800|2700,3800,5132,5400,9100,10000,10650,10800||$R/vale_day1_continue.keys,$R/kolima_glade.keys,$R/kolima_glade_save.keys||--flash-in $W/kolima_grind.sav --flash-out $W/kolima_glade.sav"
  "kolima_cliff|9750|2500,3200,4300,5300,5600,8300,8972,9600,9750||$R/vale_day1_continue.keys,$R/kolima_cliff.keys,$R/kolima_cliff_save.keys||--flash-in $W/kolima_glade.sav --flash-out $W/kolima_cliff.sav"
  "kolima_floodgate|7100|2500,2700,3100,3800,4300,5200,6000,6280,6900,7100||$R/vale_day1_continue.keys,$R/kolima_floodgate.keys,$R/kolima_floodgate_save.keys||--flash-in $W/kolima_cliff.sav --flash-out $W/kolima_floodgate.sav"
  "tret_tree|9950|2300,2700,3233,7871,8300,8900,9075,9800,9950||$R/vale_day1_continue.keys,$R/tret_tree.keys,$R/tret_tree_save.keys||--flash-in $W/kolima_floodgate.sav --flash-out $W/tret_tree.sav"
  "tret_battle|5800|3107,3400,3800,4200,4600,4862,5600,5800||$R/vale_day1_continue.keys,$R/tret_battle.keys,$R/tret_battle_save.keys||--flash-in $W/tret_tree.sav --flash-out $W/tret_battle.sav"
  "tret_cocoon|12500|4191,4440,4763,5263,5983,7238,8591,9110,10703,11140,11501,12200,12500||$R/vale_day1_continue.keys,$R/tret_cocoon.keys,$R/tret_cocoon_save.keys||--flash-in $W/tret_battle.sav --flash-out $W/tret_cocoon.sav"
  "tret_grind|162300|4000,40000,100000,160523,160700,161300,161900,162300||$R/vale_day1_continue.keys,$R/tret_grind.keys,$R/tret_grind_save.keys||--flash-in $W/tret_battle.sav --flash-out $W/tret_grind.sav"
  "tret_win|23000|12102,13660,14764,18382,20000,22100,22700,23000||$R/vale_day1_continue.keys,$R/tret_win.keys,$R/tret_win_save.keys||--flash-in $W/tret_grind.sav --flash-out $W/tret_win.sav"
  "bilibin_cave|18500|3012,4812,5347,9727,11800,12057,17412,18500||$R/vale_day1_continue.keys,$R/bilibin_cave.keys,$R/bilibin_cave_save.keys||--flash-in $W/tret_win.sav --flash-out $W/bilibin_cave.sav"
  "bilibin_ice|5100|2571,3000,3568,4080,4300,4800,5100||$R/vale_day1_continue.keys,$R/bilibin_ice.keys,$R/bilibin_ice_save.keys||--flash-in $W/bilibin_cave.sav --flash-out $W/bilibin_ice.sav"
  "bilibin_exit|4900|2810,2923,3300,3500,4068,4600,4900||$R/vale_day1_continue.keys,$R/bilibin_exit.keys,$R/bilibin_exit_save.keys||--flash-in $W/bilibin_ice.sav --flash-out $W/bilibin_exit.sav"
  "imil|15100|5363,5786,6300,6740,8000,10400,12500,13300,14177,14800,15100||$R/vale_day1_continue.keys,$R/imil.keys,$R/imil_save.keys||--flash-in $W/bilibin_exit.sav --flash-out $W/imil.sav"
  "lizard_man|14300|2615,3067,4100,5000,6400,7900,8080,9935,10382,11015,12978,13500,14000,14300||$R/vale_day1_continue.keys,$R/lizard_man.keys,$R/lizard_man_save.keys||--flash-in $W/imil.sav --flash-out $W/lizard_man.sav"
  "ml_lower|3800|2176,2567,2849,3100,3500,3800||$R/vale_day1_continue.keys,$R/ml_lower.keys,$R/ml_lower_save.keys||--flash-in $W/lizard_man.sav --flash-out $W/ml_lower.sav"
  "mia_joins|6200|2256,2560,3150,3600,4350,4880,5120,5850,6200||$R/vale_day1_continue.keys,$R/mia_joins.keys,$R/mia_joins_save.keys||--flash-in $W/ml_lower.sav --flash-out $W/mia_joins.sav"
  "ml_ply|20800|3169,6640,8244,12740,14400,16779,17153,17800,18600,19500,20800||$R/vale_day1_continue.keys,$R/ml_ply.keys,$R/ml_ply_save.keys||--flash-in $W/mia_joins.sav --flash-out $W/ml_ply.sav"
  "ml_pipes|11600|2675,3359,4400,5500,7198,7683,7940,8704,9516,10070,10400,11600||$R/vale_day1_continue.keys,$R/ml_pipes.keys,$R/ml_pipes_save.keys||--flash-in $W/ml_ply.sav --flash-out $W/ml_pipes.sav"
  "ml_upper|24400|2254,3116,3863,4136,7450,8700,10650,13604,14765,16600,16683,18960,19034,20300,20574,21097,23550,24400||$R/vale_day1_continue.keys,$R/ml_upper.keys,$R/ml_upper_save.keys||--flash-in $W/ml_pipes.sav --flash-out $W/ml_upper.sav"
  "ml_sleet|9800|2126,2500,4000,5016,6288,7732,8100,8540,9480,9800||$R/vale_day1_continue.keys,$R/ml_sleet.keys,$R/ml_sleet_save.keys||--flash-in $W/ml_upper.sav --flash-out $W/ml_sleet.sav"
  "ml_aerie|26300|7900,8951,10715,11466,12400,13786,14900,16000,17793,18063,19000,19450,24000,26300||$R/vale_day1_continue.keys,$R/ml_aerie.keys,$R/ml_aerie_save.keys||--flash-in $W/ml_sleet.sav --flash-out $W/ml_aerie.sav"
  "ml_saturos_loss|20500|2447,5000,8000,12446,12600,13300,14600,15100,16000,17000,18000,19300,19500,20500||$R/vale_day1_continue.keys,$R/ml_saturos_loss.keys||--flash-in $W/ml_aerie.sav"
  "imil_rest|32600|12446,19500,21600,24200,27916,29300,30600,32300||$R/vale_day1_continue.keys,$R/ml_saturos_loss.keys,$R/imil_rest.keys,$R/imil_rest_save.keys||--flash-in $W/ml_aerie.sav --flash-out $W/imil_rest.sav"
  "imil_grind1|176560|2600,20000,60000,100000,140000,172886,173600,176400||$R/vale_day1_continue.keys,$R/imil_grind1.keys,$R/imil_grind1_save.keys||--flash-in $W/imil_rest.sav --flash-out $W/imil_grind1.sav"
  "imil_grind2|403823|2600,50000,150000,250000,350000,400000,400830,403700||$R/vale_day1_continue.keys,$R/imil_grind2.keys,$R/imil_grind2_save.keys||--flash-in $W/imil_grind1.sav --flash-out $W/imil_grind2.sav"
  "ml_upper_return|13100|2600,2953,3484,4355,8936,9028,9890,12092,13000||$R/vale_day1_continue.keys,$R/ml_upper_return.keys,$R/ml_upper_return_save.keys||--flash-in $W/imil_grind2.sav --flash-out $W/ml_upper_return.sav"
  "ml_aerie_lv15|28200|4000,8000,12238,14589,16652,17497,19783,20948,21490,25767,27116,28100||$R/vale_day1_continue.keys,$R/ml_aerie_lv15.keys,$R/ml_aerie_lv15_save.keys||--flash-in $W/ml_upper_return.sav --flash-out $W/ml_aerie_lv15.sav"
  "ml_saturos_win|58100|12446,14000,17000,20000,30000,42169,42412,46000,50000,54000,58000||$R/vale_day1_continue.keys,$R/ml_saturos_win.keys,$R/ml_saturos_win_save.keys||--flash-in $W/ml_aerie_lv15.sav --flash-out $W/ml_saturos_win.sav"
  "zoom_edges_most|10800|2700,3800,5132,5400,9100,10000,10650,10800|JIT_FROM=1990 JIT_TO=10800|$R/vale_day1_continue.keys,$R/kolima_glade.keys|$P/zoomjitter.cjs|--flash-in $W/kolima_grind.sav --opt 2=2@0"
  "zoom_edges_more|5100|2571,3000,3568,4080,4300,4800,5100|JIT_FROM=1990 JIT_TO=5100|$R/vale_day1_continue.keys,$R/bilibin_ice.keys|$P/zoomjitter.cjs|--flash-in $W/bilibin_cave.sav --opt 2=1@0"
  "zoom_menus_field|3950|2002,2004,2080,2180,2400,2600,3100,3250,3900|WARP_AT=3450 MJ_FROM=1990 MJ_TO=3949 DIGEST_FULL=1|$R/vale_day1_continue.keys,$R/menus_field.keys|$P/warp.cjs,$P/menujitter.cjs|--flash-in $W/kolima_forest.sav --opt 2=2@0"
  "zoom_menus_shop|13330|5980,6100,12300,12530,12900,13250|MJ_FROM=2000 MJ_TO=13329 DIGEST_FULL=1|$R/vale_day1_continue.keys,$R/imil.keys|$P/menujitter.cjs|--flash-in $W/bilibin_exit.sav --opt 2=2@0"
)
# the case that writes each save a later case starts from (made first when only the later case is asked for)
maker() { case "$1" in $W/vale_day1.sav) echo vale_day1_save;; $W/sol_sanctum.sav) echo sol_sanctum_save;; $W/sol_jewels.sav) echo sol_jewels;; $W/sol_star_room.sav) echo sol_star_room;; $W/mt_aleph.sav) echo mt_aleph;; $W/vault.sav) echo vault;; $W/vault_inn.sav) echo vault_inn;; $W/vault_crate.sav) echo vault_crate;; $W/vault_grind.sav) echo vault_grind;; $W/vault_thieves.sav) echo vault_thieves;; $W/goma_entrance.sav) echo goma_entrance;; $W/goma_ivan.sav) echo goma_ivan;; $W/goma_pillar.sav) echo goma_pillar;; $W/goma_forge.sav) echo goma_forge;; $W/bilibin.sav) echo bilibin;; $W/mccoy.sav) echo mccoy;; $W/kolima.sav) echo kolima;; $W/kolima_forest.sav) echo kolima_forest;; $W/kolima_grind.sav) echo kolima_grind;; $W/kolima_glade.sav) echo kolima_glade;; $W/kolima_cliff.sav) echo kolima_cliff;; $W/kolima_floodgate.sav) echo kolima_floodgate;; $W/tret_tree.sav) echo tret_tree;; $W/tret_battle.sav) echo tret_battle;; $W/tret_grind.sav) echo tret_grind;; $W/tret_win.sav) echo tret_win;; $W/bilibin_cave.sav) echo bilibin_cave;; $W/bilibin_ice.sav) echo bilibin_ice;; $W/bilibin_exit.sav) echo bilibin_exit;; $W/imil.sav) echo imil;; $W/lizard_man.sav) echo lizard_man;; $W/ml_lower.sav) echo ml_lower;; $W/mia_joins.sav) echo mia_joins;; $W/ml_ply.sav) echo ml_ply;; $W/ml_pipes.sav) echo ml_pipes;; $W/ml_upper.sav) echo ml_upper;; $W/ml_sleet.sav) echo ml_sleet;; $W/ml_aerie.sav) echo ml_aerie;; $W/imil_rest.sav) echo imil_rest;; $W/imil_grind1.sav) echo imil_grind1;; $W/imil_grind2.sav) echo imil_grind2;; $W/ml_upper_return.sav) echo ml_upper_return;; $W/ml_aerie_lv15.sav) echo ml_aerie_lv15;; esac; } # bash 3.2: no associative arrays
flash_out() { [[ "$1" =~ --flash-out\ ([^ ]+) ]] && echo "${BASH_REMATCH[1]}"; }
case_of() { local c; for c in "${CASES[@]}"; do [ "${c%%|*}" = "$1" ] && echo "$c"; done; }
premake() { # the save this case starts from, written by its maker case (and that one's own first), unless selected
  [[ "$1" =~ --flash-in\ ([^ ]+) ]] || return 0
  local f=${BASH_REMATCH[1]}; local m; m=$(maker "$f")
  [ -z "$m" ] && return 0; want "$m" && return 0
  [ -n "${REUSE:-}" ] && [ -f "$f" ] && return 0 # REUSE=1: keep a save an earlier run made (same build)
  local n fr a e k p x; IFS='|' read -r n fr a e k p x <<< "$(case_of "$m")"
  premake "$x"; rm -f "$f"
  perl -e "alarm ${LIMIT:-240}; exec @ARGV" node tests/boot.cjs $BIN/game.js "$ROM" "$fr" --keys-file "$k" --quiet --out $W/shots $x > $W/$m.pre.log 2>&1
}
want() { [ $# -eq 0 ] && return 0; local c; for c in "${SEL[@]}"; do [ "$c" = "$1" ] && return 0; done; return 1; }
SEL=("$@")
if [ $quick = 1 ]; then # --quick (GS17): the core probe cases + the newest QUICK_N (3) story cases, saves reused
  export REUSE=1
  SEL=(prologue_save soft_reset battle_fight battle_summon field_psynergy worldmap)
  story=(); for c in "${CASES[@]}"; do [[ "$c" == *--flash-in* && "$c" != zoom_* ]] && story+=("${c%%|*}"); done
  n=${#story[@]}; for ((i = n - ${QUICK_N:-3}; i < n; i++)); do [ $i -ge 0 ] && SEL+=("${story[$i]}"); done
fi
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
  grep '^CHECK FAIL' "$log" && { echo "$name: CHECK FAIL (see $log)"; fail=1; } # a probe's own test (GS31: zoomjitter.cjs)
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
