/* PC replacement for TLA's include/system/dma.h (same API; guard GUARD_DMA_H, TLA's name for it). The GBA's
 * Dma_Set stores the three words with one stmia of registers pinned to r0-r3 (source, destination, control in
 * register order); here they go to the same registers of the identity-mapped I/O page (D5) and the PC layer runs
 * the transfer (port/pc/hw.c Port_DmaWritten), as GS1's port/shim/system/port_dma.h does. */
#ifndef PORT_TLA_DMA_H
#define PORT_TLA_DMA_H
#define GUARD_DMA_H 1 /* the vendor header's guard: it is skipped from now on */

#include "io_reg.h"
#include "types.h"

struct DmaRegisters {
  u32 source;
  u32 destination;
  u32 control;
};

void Port_DmaWritten(volatile u32 *channel);

static inline void Dma_Set(const volatile void *source, volatile void *destination, u32 control,
                           volatile u32 *channel) {
  channel[0] = (u32)source;
  channel[1] = (u32)destination;
  channel[2] = control;
  Port_DmaWritten(channel);
}

#define Dma_Fill16(value, destination, size)                                                                \
  {                                                                                                         \
    volatile u16 fill_ = (value);                                                                           \
    Dma_Set((const void *)&fill_, (destination), (DMA_ENABLE | DMA_SRC_FIXED) << 16 | ((size) / 2),         \
            REG_DMA3);                                                                                      \
  }

#define Dma_Fill32(value, destination, size)                                                                \
  {                                                                                                         \
    volatile u32 fill_ = (value);                                                                           \
    Dma_Set((const void *)&fill_, (destination),                                                            \
            (DMA_ENABLE | DMA_32BIT | DMA_SRC_FIXED) << 16 | ((size) / 4), REG_DMA3);                       \
  }

#define Dma_Fill32Cell(cell, value, destination, size)                                                      \
  {                                                                                                         \
    (cell) = (value);                                                                                       \
    Dma_Set((const void *)&(cell), (destination),                                                           \
            (DMA_ENABLE | DMA_32BIT | DMA_SRC_FIXED) << 16 | ((size) / 4), REG_DMA3);                       \
  }

#define Cpu_Fill32(value, destination, size)                                                                \
  {                                                                                                         \
    volatile u32 fill_ = (value);                                                                           \
    Bios_CpuSet((const void *)&fill_, (destination), CPU_SET_32BIT | CPU_SET_SRC_FIXED | ((size) / 4));     \
  }

#endif
