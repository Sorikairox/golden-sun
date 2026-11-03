/* Forced first include of the TLA wasm build (tools/wasm/build.py --game tla). TLA's headers differ from tbs's
 * (other include guards, other inline asm), so TLA has its own shim directory; it shares the PC layer's API
 * (port/shim/port_api.h). Replaced vendor headers are listed in port/tla/overrides.tsv. */
#ifndef PORT_TLA_SHIM_PRELUDE_H
#define PORT_TLA_SHIM_PRELUDE_H

#include "../../shim/port_api.h"
#include "system/port_dma.h"
#include "system/port_transform.h"

/* GCC 2.9x takes `extern const struct X name[];` with X incomplete; clang does not. The scene tables' formats come
 * first (their own header, guarded), and SceneRegion, which no vendor file defines (its arrays are only named, never
 * indexed), gets an opaque definition. gScene_CueRuleTable's declaration moves next to its struct (c_rules.tsv). */
#include "scene_tables.h"
struct SceneRegion {
  u8 port_opaque;
};

/* Fixed addresses: the identity memory map (D5) makes the plain form right, as in GS1's prelude. */
#undef FIXED_ADDRESS
#undef FIXED_OFFSET
#define FIXED_ADDRESS(type, address, linked) (type address)
#define FIXED_OFFSET(value, linked, from) value

/* wasm has no return address (GS1's prelude: FAKEMATCH devices only). */
#define __builtin_return_address(level) ((void *)0)

#endif
