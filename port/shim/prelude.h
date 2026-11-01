/* Forced first include of the wasm build: -include port/shim/prelude.h (tools/wasm_census.py, later the
 * emscripten build). It includes our PC replacements of the hardware-bound vendor headers and defines their
 * include guards, so when vendor code later includes "dma.h" (found next to it, before any -I path) the vendor
 * header is skipped and ours is what the code sees. Each replacement keeps the vendor header's API (names,
 * types, macro shapes) and implements it in plain C over the port layer (Port_* functions, see port/README
 * once it exists). Overrides are listed in port/overrides.tsv. */
#ifndef PORT_SHIM_PRELUDE_H
#define PORT_SHIM_PRELUDE_H

#include "system/port_dma.h"
#include "system/port_iwram_call.h"
#include "system/port_transform.h"
#include "system/port_mul_q16.h"

/* Fixed addresses: types.h's MODERN form resolves them through linked symbols. The wasm build keeps every GBA
 * region at its real address (orchestrator D5), so the plain form is the right one: the constant itself. */
#undef FIXED_ADDRESS
#undef FIXED_OFFSET
#define FIXED_ADDRESS(type, address, linked) (type address)
#define FIXED_OFFSET(value, linked, from) value

/* Unit_Get (game/units.c) reads its return address only for a FAKEMATCH device: a test that repeats the party
 * return when the caller is NULL, dead in practice. wasm has no return address; NULL takes the same return. */
#define __builtin_return_address(level) ((void *)0)

#endif
