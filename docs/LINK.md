# Link battle: survey and transport design (GS6)

Survey of the Battle Arena link battle path in alchemy tbs (`vendor/alchemy/games/tbs`, pinned `24b72a32`) and a
proposal for G6/G7 (orchestrator section 6, option B'). Sections 1-6 are the GS6 research; section 7 is the G6
implementation (GS7) and what G7 needs. Paths are
relative to `vendor/alchemy/games/tbs/` unless they start with `port/`. Vendor code is described, not copied.
Anything not checked against the source is marked **unconfirmed**.

## 1. Call graph

```
File Screen (scene/file_screen.c, menu "Battle")
  -> Event_SetDestination(SceneId_BattleArena, BATTLE_ARENA_FROM_FILE_SCREEN); gSleepDisabled = 1
Battle Arena overlay (scene/battle_arena.c)
  round-result / arrival handler (end of file, the BATTLE_ARENA_FROM_FILE_SCREEN branch)
    -> Serial_Initialize                      system/system/serial.c (far call, Serial_InitializeFar)
    -> BattleArena_WriteSlotValue(SIGNATURE, IDLE)   lobby words into gSerialTransfer.payload
    -> Task_AddFrame(BattleArena_PollPeerReady)      every frame: BattleArena_PeerSlotMatches
  talk to attendant: BattleArena_ChooseBattleMode
    -> BattleArena_PeerSlotMatches (twice, a frame apart); no partner -> BattleArena_InitializeSerial
       (Serial_RemoveIrqHandlers + Serial_Initialize) and the monster-battle offer
    -> yes: FLAG_LINK_BATTLE, FLAG_LINK_BATTLE_ARRANGED, publish LOBBY_SLOT_ASKED
  LOBBY_EVENT_PROMPT: BattleArena_PromptToParticipate; LOBBY_EVENT_DISCONNECTED: BattleArena_ReportDisconnection
  step trigger 10 (circle): BattleArena_EnterBattle
    -> publish LOBBY_SLOT_IN_CIRCLE, wait for the partner's IN_CIRCLE
    -> Task_Remove(BattleArena_PollPeerReady)
    -> BattleArena_ExchangePartyRecords
         -> BattleArena_SendPartyRecords / BattleArena_ReceivePartyRecords
              -> Serial_StartSend / Serial_StartReceive / Serial_GetActiveTransfers   (serial.c)
    -> payload[0..7] = "EXEC"; copy enemy units to gMapGridCellBuffer+0x8000 (gActorSpriteSlots)
    -> Field_RequestBattleFromEncounterTable
Battle (main image, battle/battle/*.c)
  Battle_Run (run.c): seed gBattleRandomSeed = 0; wait for LINK_BOTH_CONNECTED; linkSide = SIO id;
                      copies the opponent's units back; Task_Add(BattleCamera_Update) (setup.c, link watchdog)
    per turn: Battle_GatherActions (turn.c)
      -> Battle_BuildUnitActions -> Battle_CollectPartyCommandsFar (window/screens/battle_party_commands.c)
           "VSST" / "EDVS" handshake; UpdateLinkSessionCountdown (window/screens/link_timer.c)
      -> Battle_AppendLinkedActions (turn.c; nested LinkBattle_SendActions / LinkBattle_ReceiveActions)
           -> Serial_StartSend / Serial_StartReceive / Serial_GetActiveTransfers; Battle_RandomFar
      -> LinkBattle_WaitSync (link.c)          "EXEC", 30-frame window
    per action and at turn end: LinkBattle_SyncTurn (link.c)   "ex"/"TU"/"rn"/"EXEC"/"tu"/"RN"
    exit: Battle_ClearSerialTransferPayload (link.c); failure path in Battle_AppendLinkedActions:
          LinkBattle_ResetTransferState + Serial_RemoveIrqHandlers; abort sets FLAG_AREA_TEMP_E8
Frame layer (system/system/frame.c)
  wait(): after VBlankIntrWait, if gSerialExchangeActive -> Serial_PollStatus; mode != 0 -> transferEnabled = 1
  System_VBlankHandler (IRQ): if gSerialExchangeActive ->
      gLinkStatus = Serial_ExchangePayloads(&gSerialTransfer, gSerialPeerPayloads); Serial_StepBlockTransfer()
Serial IRQ / timer 3 IRQ: Serial_HandleTransferInterrupt (serial.c), installed by Serial_Initialize
```

Other users of the same layer, out of scope: the File Screen's cable "Send" to The Lost Age (file_screen.c:
`Serial_Initialize`, partner greeting in payload, `Serial_StartSend(gSaveBuffer, 4100)`, 10 frames without link =
error); `SerialTest_Run` (unreachable); `Serial_PollAndTransfer` (only from an unused Tret Tree callback);
`LinkBattle_SendParty` / `LinkBattle_ReceiveParty` (link.c, never called; the Arena has its own copies).

## 2. Partner detection and the hardware path

| Item | Value / behaviour | Where |
|---|---|---|
| RCNT | written GPIO (0x8000) then SIO mode (0) | `Serial_Initialize` |
| SIOCNT | 32-bit mode, then `SIO_MULTI_MODE` (0x2000) + `SIO_INTR_ENABLE` (0x4000) + 115200 bps (3) | `Serial_Initialize` |
| IRQs | handler `Serial_HandleTransferInterrupt` set for IRQ_SERIAL and IRQ_TIMER3; IE ends with SERIAL only | `Serial_Initialize` |
| Parent test | SIOCNT `SD` (bit 3) set, `START` (bit 7) clear, `SI` (bit 2) clear, and `sendIndex == -1` | `Serial_PollStatus` |
| Parent action | IE: SERIAL off, TIMER3 on; clear `SIO_INTR_ENABLE`; `REG_TM3CNT = 0xC963` (stopped); `mode = SD (8)` = `SERIAL_MODE_CLOCKING` | `Serial_PollStatus` |
| Child | SD set but SI set: phase becomes CONNECTED, mode stays 0, keeps the serial IRQ | `Serial_PollStatus` |
| Player id | SIOCNT bits 4-5 (`(SIOCNT << 26) >> 30`): 0 parent, 1 child | read by StepBlockTransfer, WaitForStatusMask, `SIO_MULTI_PLAYER_ID()` (run.c, setup.c), `BattleArena_PeerSlotMatches`, file_screen.c |
| Error | SIOCNT bit 6 copied to `transferError` each transfer; packets heard meanwhile refused; `LINK_STATUS_ERROR` (0x1000) | IRQ handler |
| Extra console | id >= 2 adds `LINK_STATUS_EXTRA_CONSOLE` (0x2000); nothing outside serial.c reads it | exchanges |

Clocking: timer 3 reload 0xC963 = 13,981 cycles per halfword, ~20.09 transfers per 280,896-cycle frame. On each
timer-3 IRQ the parent's handler reads SIOMULTI0-3 (one 64-bit load of 0x04000120), writes the next outgoing
halfword to 0x0400012A, sets `SIO_START`, and restarts timer 3. The child's handler runs on the serial IRQ at the
end of each transfer and only loads its next halfword. `Serial_PrepareSendPacket` (at VBlank) stops timer 3, resets
`sendIndex = -1` and restarts the timer if `transferEnabled` (set by `wait()` once a mode is known).

Contexts:

| Context | Code |
|---|---|
| Serial / timer-3 IRQ | `Serial_HandleTransferInterrupt` (per halfword) |
| VBlank IRQ | `Serial_ExchangePayloads` (-> `Serial_CollectReceivedPayloads`, `Serial_PrepareSendPacket`), `Serial_StepBlockTransfer`, writes `gLinkStatus` |
| Main loop, once per frame in `wait()` | `Serial_PollStatus` (partner search), `transferEnabled = 1` |
| Main loop (game code) | `Serial_StartSend/StartReceive`, `Serial_GetActiveTransfers`, all signature writes/reads and timeouts |

`IwramIrqMain` (system/irq.s) re-enables IRQs inside every handler with IE masked to 0x20C0 (timer 3, serial,
gamepak), so transfer interrupts nest inside the VBlank handler. `Serial_CollectReceivedPayloads` clears IME around
its buffer swap for that reason.

## 3. What is exchanged

### Per-VBlank packet (wire)
14 halfwords, `struct SerialPacket` (include/system/serial.h): `packetNumber` u8, `missingMask` u8 (receivedMask ^
currentMask), `checksum` u16 (complement of the sum of the 14 halfwords taken with it 0), `payload[24]`. Framing:
idle halfword 0xFEFE, then halfwords 0-13; `sendIndex` then sticks at 15 and sends tail filler until the next VBlank.
So ~15 useful transfers of ~20 per frame. Each console hears every console including itself (SIOMULTI holds all ids).
A packet is accepted when it completed since the last VBlank, no error flag was seen, and the sum is 0xFFFF; the
accepted buffer's `missingMask` is complemented so it is never taken twice.

`gLinkStatus` bits: 0-1 consoles heard this frame (3 = `LINK_STATUS_HEARD_BOTH` = `LINK_BOTH_CONNECTED` =
`LOBBY_LINK_READY_MASK`), 7 clocking, 8-9 heard since link start, 12 error, 13 extra console. Game code tests only
bits 0-1.

### The 24-byte payload: `gSerialTransfer` (`struct SerialTransferState`)
`gSerialTransfer` (EWRAM 0x02002220) is sent; peers land in `gSerialPeerPayloads[id]` (0x02002020, 24 bytes per
console). `gLinkPeerSignatures` (0x02002024) is the same memory offset by 4, i.e. each peer's 20-byte `payload`.

| Bytes | Field | Use |
|---|---|---|
| 0 | `active` | block number (low 7 bits); receiver sets bit 7 = rewind request |
| 1 | `status` | 0x80 running (+1 receive), receiver counts blocks |
| 2 | `flags` | receive state: 0 idle, 1 active, 2 done |
| 3 | `peerFlags` | send state: 0 idle, 1 more, 2 last |
| 4-23 | `payload[20]` | one bulk block, OR the state words below (shared memory!) |

State words in `payload` (u16 index i = bytes 4+2i): Arena lobby: s32 word 0 = signature (`'SGMC'` in English; other
languages differ, `gBattleArena_SlotValues`), word 1 = state (`'0123'` asked, `'ABC1'` in circle, `'EFG3'` idle).
Battle: halfwords 0-3 = "EXEC" (or "ex" + "EC"), 4-7 = "VSST"/"EDVS" (commands) or 4-5 "TU"/"tu" + 6-7 "rn"/"RN"
(SyncTurn). A running block transfer overwrites these bytes with data.

### Bulk transfers (`Serial_StartSend`, `Serial_StartReceive`, `Serial_StepBlockTransfer`)
Sizes must be multiples of 20. The sender streams one 20-byte block per VBlank in which both consoles were heard and
the peer shows `flags == 1`, without waiting for acks; the receiver stores a block only if its number matches, else
requests a rewind (bit 7) and the sender backs up. Send ends when the peer shows `flags == 2` after our LAST block
(`gSerialSendSource = 0`); receive ends (`gSerialReceiveDestination = 0`) once the peer stops showing LAST.
`gSerialReceivedSize` grows 20 per block; callers poll it for overrun and exact size.

| Transfer | Bytes | Blocks | Order |
|---|---|---|---|
| Party member record (Unit 332 + 8), side byte at 0x12A: 2 member, 0 padding | 340 x 3 | 17 x 3 | parent sends first (after `wait(5)`), child receives first, then `wait(10)` and sends |
| Djinn recovery table (268 + 52), unit ids remapped to 128+slot | 320 | 16 | after the 3 records |
| Turn header `BattleLinkedActionState` (count, check, seed) | 20 | 1 | parent: send hdr, send actions, recv hdr, recv actions; child: recv, recv, send, send |
| Actions (`struct BattleAction`, 16 each), rounded up to 20 | 20*ceil(16n/20) | | as above |

### Handshakes and RNG
- Command entry (`Battle_CollectPartyCommands`): write "VSST" at 4-7; wait for the peer's "VSST" or "EDVS" while the
  peer shows "EXEC" at 0-3 (otherwise fail at once). After choosing: "EDVS"; wait for the peer's "EDVS". The peer's
  "EDVS" starts our 15 s countdown (`UpdateLinkSessionCountdown`, 900 frames).
- RNG: both consoles set `gBattleRandomSeed = 0` in `Battle_Run`. Each turn the parent sends `check` = its next
  `Battle_RandomFar()` and `seed` = `gRandomSeed`, and adopts that seed; the child, after its send, compares its own
  `Battle_RandomFar()` with `check` (mismatch = link failure) and adopts `seed`. Built-in RNG desync check.
- `LinkBattle_WaitSync`: shows "EXEC", up to 30 frames for the peer's halfwords 2-3 to read "EC".
- `LinkBattle_SyncTurn` (after each action and at turn end): ex+TU, rn, EXEC, tu, RN; each step waits for the peer to
  show it, fails if the peer shows a different previous step. Monotonic states: safe under latest-value sampling.
- End: no final handshake. Win/loss is computed locally (last action) before the per-action SyncTurn. Exits call
  `Battle_ClearSerialTransferPayload` (clears payload 0-15). Abort sets `FLAG_AREA_TEMP_E8`; the Arena then reports
  the disconnection, waits 20 frames and re-runs `BattleArena_InitializeSerial`.
- Disconnect: `BattleCamera_Update` sets `linkPaused` (never cleared during the battle) after 24 frames without both
  heard or if the SIO id changes; every link wait then returns -1.

### Sequence (connect to battle end)

```mermaid
sequenceDiagram
  participant P as Parent (id 0)
  participant C as Child (id 1)
  Note over P,C: Serial_Initialize on both; Serial_PollStatus: SD set -> CONNECTED; parent arms timer 3
  loop every VBlank
    P->>C: packet(n, missingMask, sum, 24-byte payload)
    C->>P: packet(n, missingMask, sum, 24-byte payload)
  end
  P-->>C: lobby words SIGNATURE + ASKED / IN_CIRCLE
  C-->>P: lobby words SIGNATURE + ASKED / IN_CIRCLE
  P->>C: 3 x 340-byte unit records (17 blocks each, peer acks via flags)
  P->>C: 320-byte Djinn table
  C->>P: 3 x 340 + 320 (after wait(10))
  Note over P,C: both publish "EXEC", enter Battle_Run (seed 0)
  P-->>C: "VSST" ... "EDVS" (C likewise)
  P->>C: header {count, check, seed} + actions
  C->>P: header {count} + actions; C checks Battle_RandomFar == check
  Note over P,C: LinkBattle_WaitSync "EXEC" (30 frames)
  loop each action, then turn end
    P-->>C: SyncTurn ex/TU, rn, EXEC, tu, RN (C likewise)
  end
  Note over P,C: last action decides; Battle_ClearSerialTransferPayload; back to Arena (WIN/LOSS entrance)
```

## 4. Timeouts and timing assumptions

| Limit (frames) | Meaning | Where |
|---|---|---|
| 24 (`LINK_MAX_MISSED_FRAMES`) | consecutive frames without both heard -> fail / pause | setup.c `BattleCamera_Update` (pause, permanent), run.c `Battle_Run` start wait, link.c WaitSync/SyncTurn, turn.c send/receive |
| 24 (literal) | same, command entry waits | battle_party_commands.c `Battle_CollectPartyCommands` |
| 30 | WaitSync window for peer "EC" | link.c `LinkBattle_WaitSync` |
| none | SyncTurn has no overall timeout (only missed frames) | link.c `LinkBattle_SyncTurn` |
| 300 (`LINK_TRANSFER_TIMEOUT`) | header + actions per direction, shared counter | turn.c nested `LinkBattle_SendActions/ReceiveActions` |
| 600 / 600 / 900 | Arena: 3 records sent / table sent / all 4 received | battle_arena.c `LOBBY_SEND_TIMEOUT_FRAMES`, `LOBBY_RECEIVE_TIMEOUT_FRAMES` |
| 24 (`LOBBY_TRANSFER_RETRY_LIMIT`) | Arena: frames past timeout or without link before a record fails | Send/ReceivePartyRecords |
| 25 (`LOBBY_PEER_WAIT_FRAMES`) | Arena: no link (PollPeerReady clears peer payloads) / partner not asking (EnterBattle) | battle_arena.c |
| 300 calls | Arena attendant re-asks | `BattleArena_PromptToParticipate` |
| 900 | 15 s command countdown after peer "EDVS" | link_timer.c |
| 600,000 | `SERIAL_TRANSFER_TIMEOUT_FRAMES` (`Serial_WaitFor*`), file-screen send cap | serial.c, file_screen.c |
| 10 | file-screen send: frames without link -> error | file_screen.c |

No retries beyond the block rewind; failures abort to the Arena. Sub-frame / hardware timing assumptions:

1. `Serial_HandleTransferInterrupt` (parent, timer 3): reads SIOMULTI of the transfer started one tick earlier without
   checking `SIO_START` busy: assumes a multiplayer transfer finishes within 13,981 cycles.
2. Child: its serial IRQ must load SIOMLT_SEND before the parent's next start (same window).
3. A packet (15 halfwords) must fit in the ~20 ticks between two VBlanks; `Serial_PrepareSendPacket` stops/restarts
   timer 3 at the parent's VBlank (stop and restart in the same instant: reload on re-enable).
4. The two consoles' VBlanks are not synchronized; the child resets `sendIndex` at its own VBlank, so a child packet is
   sometimes cut short and that frame counts as missed. The game is built to tolerate this (asynchronous consoles).
5. Nested IRQs: serial/timer-3 preempt the VBlank handler; the IME window in `Serial_CollectReceivedPayloads`.
6. `Serial_PollStatus` arms the clock only when `sendIndex == -1` (between packets) and on an SD/START/SI snapshot.
7. Main loop vs VBlank: `gSerialSendSize`, `gSerialReceivedSize`, `gSerialBlockNumber`, `gLinkStatus` are volatile and
   `Serial_StartSend/StartReceive` lock IRQs; `Serial_ResetTransferState` (static inline in serial.h, inlined into
   `BattleArena_ExchangePartyRecords` and `LinkBattle_ResetTransferState`) zeroes the transfer globals directly.

No busy-wait on `SIO_START` was found (grep of `SIO_START`/`REG_SIOCNT` outside serial.c).

## 5. PC layer today (port/pc)

| Piece | State | Gap |
|---|---|---|
| SIO registers (0x04000120-0x0400012A, RCNT 0x04000134) | plain memory; nothing reads or drives them | SIOCNT read-only bits (SI, SD, id, error, START clear on completion), SIOMULTI fill, none emulated |
| Serial IRQ (IF bit 7) | in `IRQ_ORDER` (hw.c `dispatch`) but never raised | needs a source (in-memory SIO) or no use (B') |
| Timer 3 IRQ | generic: `timers_step` raises IF bit 6 on overflow with bit 0x40 | sampled at line events (272/960 cycles); a stop+restart within one step is not seen as a reload |
| IRQ dispatch | IwramIrqMain's order, handlers only inside `Port_BiosHalt` / `Port_ReadVCount`, not nested | no nesting of timer 3/serial inside VBlank |
| Frame driver | `port_frame_ready` at line 160 (main.c only boots) | no link/transport hooks; no second instance plumbing in port/web |
| Overrides | `port/fn_overrides.tsv` drops vendor bodies (bind.py); port_src.py marks them noinline | works for main-image C (serial.c, link.c, turn.c); overlay functions (battle_arena.c) **unconfirmed** |

`gSerialPeerPayloads` and `gLinkPeerSignatures` alias only if both are bound at their GBA addresses (D5/D19): both are
EWRAM symbols in `port/symbols/tbs-en.tsv`; binding of RAM symbols at those addresses **unconfirmed** in a build.

## 6. Proposed design (B')

### Cut point
Keep everything above `serial.c`'s API (Arena, battle, handshakes, timeouts) as vendor code; replace in `port/pc/link.c`
via `port/fn_overrides.tsv`:

| Vendor function | Ours |
|---|---|
| `Serial_Initialize` | reset link state, bump the session epoch, write SIOCNT = multi mode + SD + id bits (+SI for the child), RCNT = SIO; clear the transfer globals like the original; `gSerialExchangeActive = 1`; install no IRQ handlers |
| `Serial_PollStatus` | if the transport is connected: phase CONNECTED, mode = 8 for the parent (room host) else 0; return status bits |
| `Serial_ExchangePayloads` | each VBlank: send our 24 bytes (frame number, unreliable/unordered channel, newest wins); copy the latest peer payload into `gSerialPeerPayloads[peerId]` and ours into our slot; status bits 0-1 set while the link is "fresh" |
| `Serial_StartSend` / `Serial_StartReceive` / `Serial_StepBlockTransfer` | bulk out of band, whole messages on a reliable ordered channel (below) |
| `LinkBattle_WaitSync` (optional) | same logic, window 30 frames offline, setting-controlled online |

`Serial_GetActiveTransfers`, `Serial_WaitFor*`, `Serial_RemoveIrqHandlers` stay vendor (they only use globals and
handler slots). `Serial_HandleTransferInterrupt` is never installed. SIOCNT must keep plausible id bits because game
code reads them directly (table in section 2); only `Serial_Initialize` and `Serial_PollStatus` write SIOCNT, both ours.

### Messages
| Type | Channel | Content |
|---|---|---|
| `frame` | unreliable, unordered | sender frame number, epoch, 24-byte payload with bytes 0-3 reused as bulk state: receive ticket (StartReceive count), consumed bulk seq |
| `bulk` | reliable, ordered | epoch, seq, size, bytes (copied at `Serial_StartSend`) |
| `hash` | reliable | turn number, side-normalized battle-state hash |
| `hello/bye` | reliable | role, ROM/build id, settings (timeouts) |

Bulk: `Serial_StartSend` sets the vendor globals (`gSerialSendSource/Size`), queues the message; ours posts it once the
peer's frame shows a receive ticket covering it (the original also waits for the peer's receive-active flag); the send
completes (`gSerialSendSource = 0`) when the peer's frame shows the seq consumed. `Serial_StartReceive` takes the next
queued bulk of the current epoch when it arrives: copy all bytes, `gSerialReceivedSize = size`,
`gSerialReceiveDestination = 0`. A transfer costs ~1 RTT instead of 17 frames + resends; party exchange ~8 RTT total.
Our StepBlockTransfer runs only when both are heard (as the original) and treats globals zeroed under it
(`Serial_ResetTransferState`) as a cancel.

"No packet this frame": with bulk out of band the payload is pure state, so delivering the latest value is correct
(handshakes are monotonic, section 3). Bits 0-1 stay set while the newest peer frame is younger than the link-loss
window (default ~24 frames offline-equivalent, online setting e.g. 5 s); after that both bits drop and the game's own
24-frame counters run, giving the original disconnect messages. Jitter below the window is invisible to the game.

Timeouts: the remaining fixed windows are WaitSync 30 frames (needs RTT below ~400 ms; widen via the override), turn
transfers 300 frames, Arena 600/900 frames, all generous at 1-2 RTT per transfer. Widening is an optional setting,
off by default offline, documented in the page.

Desync guard: our `LinkBattle_WaitSync` runs once per turn, after the action exchange and before execution, when both
sides hold equal state. Hash party units 0-7 vs enemy units 128-131 mirrored per side (exclude names, which get the
"Enemy" prefix, and the side byte) plus `gBattleRandomSeed`; send `hash`, compare asynchronously, report the first
differing turn. The game's own `check` RNG test already aborts on seed drift.

### G6 offline harness
Two wasm instances in one page wired by an in-memory implementation of the same transport interface (not SIO
registers): a message sent in frame f is delivered at the peer's VBlank of frame f+d (d fixed, 0-2), the page steps
both instances one frame each alternately, inputs recorded per frame. Deterministic and replayable, and it exercises
exactly the G7 code path; netsim can be layered on it. A register-level in-memory SIO (PLAN G6 wording) would need
line-level lockstep of two instances, SIOCNT/SIOMULTI/serial IRQ emulation and timer-3 cross-wiring, and would only
validate vendor serial.c that G7 replaces: suggested as optional/later. The PLAN wording should be revisited by the
orchestrator.

### Risks and open questions
- Memory: two instances x ~225 MB linear memory (D5) in one page for G6; fine on desktop, likely not on iOS.
- Stale bulk after a failed exchange: `BattleArena_ExchangePartyRecords` resets only via the inlined
  `Serial_ResetTransferState` (no `Serial_Initialize`); the epoch/ticket scheme must not consume an old message.
  Needs a test of failure + retry.
- `Battle_AppendLinkedActions`' timeout is inside GCC nested functions (rewritten to blocks by port_src.py) and cannot
  be overridden alone; 300 frames should suffice. Override the whole function only if needed.
- `BattleCamera_Update`'s permanent pause makes any link drop > window fatal (same as hardware).
- Language: lobby signature words differ per language; only English (tbs-en) players can meet. Region/ROM check in `hello`.
- Online replay determinism: arrival frames differ run to run; record inbound messages per frame per side.
- Battle determinism between two browsers relies on identical code and inputs; any port-only nondeterminism inside
  battle code (uninitialized memory, host-dependent paths) would desync: hash guard catches it.
- Overlay function overrides (battle_arena.c) unconfirmed; the design needs none.
- The File Screen's GS2 send would run on the same layer; untested and out of scope.

## 7. G6 implementation and results (GS7)

Implemented as section 6 proposes (coordinator decision D21). Nothing of the vendor's above serial.c changed.

| Piece | File |
|---|---|
| Serial_Initialize, Serial_PollStatus, Serial_ExchangePayloads, Serial_StartSend, Serial_StartReceive, Serial_StepBlockTransfer | `port/pc/link.c` (via `port/fn_overrides.tsv`) |
| Transport interface: `connected()`, `playerId()`, `send(ch, bytes)`, `recv(ch)`; ch 0 frames (unreliable), ch 1 bulk (reliable, ordered) | `port/pc/link_transport.h`, `port/web/port_lib.js` (`Module.linkTransport`) |
| In-memory transport pair: delay (frames), drop (ch 0), jitter (ch 0 reorder), seeded PRNG | `port/web/link_loopback.js` |
| Two-instance runner (node): lockstep A then B each frame, per-instance inputs/flash, mirror check, RAM digest, side-by-side sheets | `tests/link2.cjs`, `tools/link2.sh`, routes `tests/routes/link_{arena,lobby,fight}.keys` |

Wire format (little-endian): frame = `1, epoch, rxEpoch, 0, rxDone u16, 0 u16, frame u32, payload[24]` (36 bytes);
bulk = `2, epoch, seq u16, size u32, bytes`. A send completes when a peer frame shows `rxEpoch == our epoch` and
`rxDone >= seq`. A bulk is handed to a waiting `Serial_StartReceive` at a VBlank with the link fresh. "Both heard" stays
set for `Port_LinkSetFreshFrames(n)` frames (default 12) after the newest peer frame. LinkBattle_WaitSync was not
overridden (not needed up to 3 frames of delay + jitter 3).

Test save: the File Screen offers Battle only for a file whose summary counts a Djinn flag; link2.cjs makes
`port_work/g7/flash_battle.sav` from GS4's prologue save with that count set to 1 (sector checksum fixed). Test only.
Both players are prologue Isaac (Lv 1, HP 30, no Psynergy): the other's Isaac appears as "EnemyIsaac".

What runs (node, 5200 lockstep frames in ~3.6 s, ~1450 pair-frames/s):

| Stage | Frame (d=0) | Evidence |
|---|---|---|
| Title, File Screen, Battle, file 1 | 1000-1400 | |
| Battle Arena lobby, link up (both heard), `SGMC`/`EFG3` | 1510 | watch log |
| Attendant: explanation, "Would you like to apply?" Yes -> `0123` both, call into the circle | 1970 | |
| Circle (step trigger 10): `ABC1` both -> party exchange 3 x 340 + 320 each way (4 bulks each) | 2353-2427 | |
| `EXEC`, "EnemyIsaac appeared!" on both | ~2490 | |
| 4 turns, both Attack; 12 bulks each way in all (4 party + 4 x header/actions) | 2700-3830 | 20 seed-change checkpoints, units mirror |
| Parent's Isaac goes down: a "Isaac goes down in defeat...", b "You felled EnemyIsaac!"; back to the Arena, win tally a 000 / b 001, "Battle results were saved." | 3830-4060 | |

Network-like runs (`tools/link2.sh ARGS`): every one reaches the end with **all checkpoints agreeing and the same
winner** (b): `--delay 1`, `--delay 2`, `--delay 3`, `--drop 0.2` (1257 frames dropped), `--delay 2 --drop 0.3
--jitter 2` (1834 dropped, ~160 late/out-of-order frames discarded per side), `--delay 3 --drop 0.5 --jitter 3
--seed 7` (3696 of 7380 frame messages dropped; slower, so the fight route taps A until f4900). Deterministic: the same
arguments give the same RAM digests of both instances run to run. No desync seen.

Not tested: a link loss mid-battle (BattleCamera_Update pause), failure + retry of a party exchange (stale bulk risk,
section 6), Psynergy/Djinn/summons in a link battle (no party has them), three-member parties.

### What G7 (online) needs

1. A WebRTC transport object with this interface per page: two data channels on one RTCPeerConnection, `frame`
   (`ordered: false, maxRetransmits: 0`) and `bulk` (reliable, ordered); `recv` pops from per-channel queues filled by
   `onmessage`; `connected()` = both channels open; `playerId()` = 0 for the room host, 1 for the guest. link.c is
   unchanged.
2. Signaling and rooms: reuse the GoldenEye/Conker pattern read-only as reference (`~/goldeneye/port/web/net.js`,
   `port/netlify/functions/room/{core.mjs,room.mjs}` on Netlify Blobs, local `scripts/web/roomserver.mjs` for tests,
   copy-paste codes as fallback, STUN only: D15). Unlike GoldenEye there is **no input lockstep**: each page runs its own
   game at full speed; only the link messages cross. A `hello` on the bulk channel before the game connects: build id
   (wasm hash), ROM SHA-1, English edition (the lobby signature is per language), settings.
3. Timing: online the newest peer frame can be 5-10 frames old. Set `Port_LinkSetFreshFrames` to ~300 (5 s) online so
   jitter never drops "both heard"; check the fixed windows (WaitSync 30 frames; turn transfers 300; Arena 600/900)
   against real RTTs; override LinkBattle_WaitSync with a wider window if a 150 ms+ RTT trips it.
4. The page must keep stepping the game while its tab is hidden (rAF stops; the peer would see a link loss after the
   fresh window): a timer fallback (check how the GoldenEye/Conker pages handle it).
5. Desync guard: tests/link2.cjs checks the mirror from outside; online, send a per-turn hash (party units vs the
   mirrored enemy units + gBattleRandomSeed) on the bulk channel as a separate message type and report the first
   difference (needs a hook at a turn boundary, e.g. a LinkBattle_WaitSync override).
6. Each player needs only their own save (the partner's party arrives in the exchange). The page's Battle entry needs
   a file with a Djinn found; for testing without one, a test-only save patch as link2.cjs's.
7. Netsim in the page (`?netsim=lat:MS,jit:MS,loss:PCT`) can wrap the WebRTC transport the way link_loopback.js wraps
   the in-memory one; the G7 exit test (two pages in one headless Chrome via a local room server) should replay the
   routes above.
