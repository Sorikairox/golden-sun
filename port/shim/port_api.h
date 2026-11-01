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

#endif
