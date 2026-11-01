/* Functions of the PC layer (port/pc) that replaced vendor asm or hardware access calls. Declared here so the
 * transformed vendor files (tools/wasm/port_src.py, port/asm_rules.tsv) see prototypes. */
#ifndef PORT_API_H
#define PORT_API_H

void Port_BiosHalt(void);             /* swi 2: wait for an interrupt; the frame driver yields here (D8) */
void Port_BiosStop(void);             /* swi 3: sleep mode */
void *Port_FrameWaitStackTop(void);   /* wait()'s stack-depth trick: report sp at the fixed top, so no copy */

unsigned int Port_ReadVCount(void); /* a scanline read in a busy-wait: advances the display (port/c_rules.tsv) */

#endif
