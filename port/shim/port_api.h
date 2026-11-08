/* Functions of the PC layer (port/pc) that replaced vendor asm or hardware access calls. Declared here so the
 * transformed vendor files (tools/wasm/port_src.py, port/asm_rules.tsv) see prototypes. */
#ifndef PORT_API_H
#define PORT_API_H

void Port_BiosHalt(void);             /* swi 2: wait for an interrupt; the frame driver yields here (D8) */
void Port_BiosStop(void);             /* swi 3: sleep mode */
void *Port_FrameWaitStackTop(void);   /* wait()'s stack-depth trick: report sp at the fixed top, so no copy */

unsigned int Port_ReadVCount(void); /* a scanline read in a busy-wait: advances the display (port/c_rules.tsv) */

/* BattleEffect_BuildBlitter wrote a blitter at gba (port/c_rules.tsv): port/pc/blitter.c draws for it */
void Port_BlitterBuilt(unsigned int gba, int widthShift, int heightShift, int flags, unsigned int mode);

/* A wasm function pointer as the game sees it: a table index in [0x10000, 0x20000) (port/pc/gba.h
 * PORT_IS_TABLE_INDEX, trap 26). Field_ExamineCell tells an event routine from a search result by bits 27-24 of the
 * value (set in every GBA code address); a table index has none of them (port/c_rules.tsv, trap 40). */
#define PORT_IS_CODE_INDEX(a) ((unsigned int)(a) - 0x10000u < 0x10000u)

/* port/pc/codemap.c: is a table index a scene overlay's function? Task_SuspendOverlayTasks/ResumeOverlayTasks pick
 * overlay tasks by the routine's top byte 0x02 (port/c_rules.tsv; code-range audit port/tools/code_range_audit.tsv,
 * GS14, trap 41). */
int Port_CodeIsOverlay(unsigned int fn);

/* GS27 port/pc/options.c: the port's in-game "Extra settings" screen (R on the Pause menu or in Change settings;
 * port/c_rules.tsv). PORT_PAUSE_EXTRA_SETTINGS is the Pause menu's result for it (past every real entry). */
#define PORT_PAUSE_EXTRA_SETTINGS 0x40
struct Window;
void Port_ExtraSettings_Run(int seMove, int seConfirm, int seCancel);
void Port_ExtraSettings_Hint(struct Window *help, int message, int windowWidth);
void Port_ExtraSettings_HintClose(void);
/* GS29 Map zoom (replaces GS27's Wide view): pixels the frame shows past each side of the GBA screen this frame
 * (0 at Normal and off the field; the field's actor culling and Sprite_Draw use them), and the field-map stamps for
 * the renderer (port/pc/ppu.c) */
extern int gPortZoomL, gPortZoomR, gPortZoomT, gPortZoomB;
void Port_ZoomFieldStamp(void);
void Port_ZoomFieldSequence(int on);
void Port_RepairRevealLesson(void); /* GS35: port/pc/save_compat.c */
int Port_SettingsMenuResult(int result, int seMove, int seConfirm, int seCancel);

/* GS28 port/pc/save_compat.c: the actor snapshot (saved with the game) holds GBA addresses, not wasm ones
 * (Actor_Snapshot / Actor_Restore, port/c_rules.tsv, trap 85) */
void Port_ActorSnapshotToGba(void);
void *Port_ActorFromSnapshot(void *snapshot);
void Port_ActorSnapshotMigrate(void);

#endif
