/* PC replacement for alchemy's include/system/dma.h (same API). On the GBA, Dma_Set stores three words into a
 * DMA channel's registers with one stmia (inline asm pinned to r0-r3). Here the three words are stored into the
 * same registers in the identity-mapped I/O page (orchestrator D5) and the port layer runs the transfer:
 * immediately when the control word asks for it, or later at VBlank/HBlank/FIFO timing. */
#ifndef PORT_DMA_H
#define PORT_DMA_H
#define ALCHEMY_DMA_H 1 /* the vendor header's guard: it is skipped from now on */

#include "io_reg.h"
#include "types.h"

/* One DMA channel's registers: DMAxSAD, DMAxDAD, DMAxCNT (count low, flags high). Hardware layout. */
struct DmaRegisters {
  u32 source;
  u32 destination;
  u32 control;
};

#define DMA3 ((volatile struct DmaRegisters *)REG_DMA3)

/* Port layer: called after the three registers of `channel` are written (port/pc/dma.c). */
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
