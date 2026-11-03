/* Test runtime for the asm2c output (TLA3, D20): the register file, and calls out of translated code go to the
   test interpreter (tests/arm/tla/diff_tla.cjs runs the ROM's own routine there). Test-only, never shipped. */
#include <stdint.h>
typedef uint32_t u32;
typedef struct { u32 r[16]; u32 n, z, c, v; } A2cRegs;
A2cRegs a2c_r;
static u32 cur_overlay;
extern void a2c_js_call(u32 addr);
void a2c_call(u32 addr) { a2c_js_call(addr); }
u32 a2c_overlay_current(void) { return cur_overlay; }
void a2c_set_overlay(u32 o) { cur_overlay = o; }
u32 a2c_regs_addr(void) { return (u32)(uintptr_t)&a2c_r; }
void a2c_badreturn(u32 a, u32 e) { (void)e; a2c_js_call(a); }
extern void a2c_js_trace(u32 addr);
void a2c_trace(u32 addr) { a2c_js_trace(addr); }
