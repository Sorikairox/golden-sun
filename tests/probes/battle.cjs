// TEST-ONLY debug entry into a battle for tests/boot.cjs --probe (G6). No battle logic of ours: at frame
// BATTLE_AT (env, default 5400: free walking in ValePrologue after tests/routes/first_rock.keys) it writes the
// formation of slot BATTLE_SLOT (default 2) of encounter zone BATTLE_ZONE (default 12,
// ENCOUNTER_ZONE_SCRIPTED_VALE_VAULT) into gFieldWork->encounter, which is what the game's own
// Field_RequestBattleFromEncounterTable writes (ValePrologue_FightThirdMonster asks for zone 12 slot 2 on the
// stormy night). The field sequence's loop then takes its own random-encounter path: Actor_Snapshot,
// SEQUENCE_BATTLE, Field_StartEncounterTransition, MainRoutine -> Battle_RunFar(formation). The formation number
// is read from the ROM's gEncounterZones at run time (rate, level, 8 formations: 14 halfwords a zone).
// Battle music is not chosen (Encounter_SelectBattleMusic is skipped; no audio in tests).
'use strict';
const AT = +(process.env.BATTLE_AT || 5400);
const ZONE = +(process.env.BATTLE_ZONE ?? 12), SLOT = +(process.env.BATTLE_SLOT ?? 2);
const FIELD_WORK = 0x03001ebc, ENCOUNTER = 380;   // gFieldWork; FieldWork.encounter (field_work.h)
const ZONES = 0x0809c610;                          // gEncounterZones (port/symbols/tbs-en.tsv)
module.exports = (m, frame) => {
  if (frame !== AT) return;
  const H = m.HEAPU8;
  const u16 = (a) => H[a] | H[a + 1] << 8;
  const fw = (H[FIELD_WORK] | H[FIELD_WORK + 1] << 8 | H[FIELD_WORK + 2] << 16 | H[FIELD_WORK + 3] << 24) >>> 0;
  const formation = u16(ZONES + 2 * (ZONE * 14 + SLOT + 2));
  if (fw < 0x02000000 || fw >= 0x03008000) { console.log(`battle probe f${frame}: no field work`); return; }
  H[fw + ENCOUNTER] = formation & 255; H[fw + ENCOUNTER + 1] = formation >> 8;
  console.log(`battle probe f${frame}: gFieldWork 0x${fw.toString(16)} encounter = formation ${formation} (zone ${ZONE} slot ${SLOT})`);
};
