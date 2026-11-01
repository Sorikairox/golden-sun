/* Common definitions of the PC layer (port/pc): GBA integer types, the identity-mapped regions (orchestrator D5)
 * and the I/O registers the layer reads and writes. The vendor headers are not used here: port/pc is compiled
 * with emscripten's libc headers and names game data by extern declarations, which tools/wasm/bind.py binds to
 * their GBA addresses. */
#ifndef PORT_GBA_H
#define PORT_GBA_H

#include <stdint.h>

typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef uint64_t u64;
typedef int8_t s8;
typedef int16_t s16;
typedef int32_t s32;
typedef int64_t s64;

#define EWRAM_BASE 0x02000000u
#define IWRAM_BASE 0x03000000u
#define IO_BASE 0x04000000u
#define PALETTE_BASE 0x05000000u
#define VRAM_BASE 0x06000000u
#define OAM_BASE 0x07000000u
#define ROM_BASE 0x08000000u
#define FLASH_BASE_ADDR 0x0E000000u

/* wasm function pointers are table indices from PORT_TABLE_BASE (link.py: --table-base): the game keeps code
 * addresses and message ids in the same words and tells them apart by size (TRIGGER_RESULT_MESSAGE_END is
 * 65536), so a function pointer must not look like a message id. Emscripten's own data and stack start at
 * 0x20000 (GLOBAL_BASE), so [0x10000, 0x20000) holds table indices only (fewer than 65536 functions). */
#define PORT_TABLE_BASE 0x10000u
#define PORT_TABLE_END 0x20000u
#define PORT_IS_TABLE_INDEX(a) ((u32)(a) >= PORT_TABLE_BASE && (u32)(a) < PORT_TABLE_END)

#define IO16(offset) (*(volatile u16 *)(uintptr_t)(IO_BASE + (offset)))
#define IO32(offset) (*(volatile u32 *)(uintptr_t)(IO_BASE + (offset)))
#define GBA_PTR(type, address) ((type *)(uintptr_t)(address))

/* I/O register offsets */
#define R_DISPCNT 0x000
#define R_DISPSTAT 0x004
#define R_VCOUNT 0x006
#define R_BG0CNT 0x008
#define R_BG0HOFS 0x010
#define R_BG2PA 0x020
#define R_BG2X 0x028
#define R_BG3PA 0x030
#define R_BG3X 0x038
#define R_WIN0H 0x040
#define R_WIN1H 0x042
#define R_WIN0V 0x044
#define R_WIN1V 0x046
#define R_WININ 0x048
#define R_WINOUT 0x04A
#define R_MOSAIC 0x04C
#define R_BLDCNT 0x050
#define R_BLDALPHA 0x052
#define R_BLDY 0x054
#define R_SOUNDBIAS 0x088
#define R_DMA0SAD 0x0B0
#define R_TM0CNT_L 0x100
#define R_KEYINPUT 0x130
#define R_KEYCNT 0x132
#define R_IE 0x200
#define R_IF 0x202
#define R_IME 0x208

#endif
