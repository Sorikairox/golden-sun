/* The link cable at the game's serial API (G6, orchestrator D21, docs/LINK.md section 6): the vendor's
 * multiplayer-SIO driver (system/system/serial.c) is replaced through port/fn_overrides.tsv by a message
 * channel to the other console (port/pc/link_transport.h). Everything above serial.c's API (Battle Arena lobby,
 * party exchange, battle handshakes and timeouts) is the vendor's code, unchanged.
 *
 * - Per VBlank (Serial_ExchangePayloads) each console sends its 24-byte gSerialTransfer on the unreliable
 *   channel and takes the newest frame the peer sent into gSerialPeerPayloads[peer]; its own payload goes to its
 *   own slot (on the cable each console hears itself). "Both heard" (gLinkStatus bits 0-1) stays set while the
 *   newest peer frame is younger than LINK_FRESH_FRAMES local frames: a lost or late packet is invisible to the
 *   game (the lobby and battle states are monotonic, so the latest value is what counts), a longer silence drops
 *   the bits and the game's own missed-frame counters take over.
 * - Bulk data (Serial_StartSend: party records, Djinn table, turn actions) goes whole on the reliable channel at
 *   once; the receiver queues it and hands it over in one piece when the game asks (Serial_StartReceive), at a
 *   VBlank with the link fresh, as the original's last block would. The send completes when the peer's frames
 *   report it consumed (rxDone), as the original waits for the receiver's DONE flag.
 * - Epochs: each Serial_Initialize starts a new sender epoch; the peer drops queued bulks of an older epoch.
 *   While the transport is not connected the peer is forgotten (GS10), so a new link session (the partner
 *   reloaded or restarted its game, whose epochs start again at 1) is accepted whatever its epoch.
 * - SIOCNT keeps plausible id bits (4-5), SD and SI, because game code reads them directly (LINK.md section 2).
 * No serial or timer-3 IRQ is used; Serial_HandleTransferInterrupt is never installed.
 *
 * The Lost Age (TLA8, PORT_GAME_TLA): TLA's driver (src/system/serial) has the same globals and layouts
 * (include/system/serial.h) and the same entry points; there Serial_Initialize is the raw Func_08016180 and
 * Serial_StepBlockTransfer the raw Func_08016990 (port/tla/hw/pc_binds.tsv), the C ones are replaced through
 * port/tla/fn_overrides.tsv. Its receive buffer global is named gSerialReceiveDest, and its bulks are larger: the
 * clear data's cable transfer is GS1's whole save part, 4100 bytes (Func_02000b24 receives it). */
#include <string.h>

#include "gba.h"
#include "link_transport.h"

#ifdef PORT_GAME_TLA
#define gSerialReceiveDestination gSerialReceiveDest
#endif

/* game data (bound to their GBA addresses by tools/wasm/bind.py; layouts from include/system/serial.h) */
extern u8 gSerialTransfer[24];        /* struct SerialTransferState */
extern u8 gSerialWork[0x160];         /* struct SerialWork */
extern u8 gSerialPeerPayloads[4][24];
extern u16 gSerialExchangeActive;
extern s32 gSerialSendSource;
extern volatile u16 gSerialSendSize;
extern s32 gSerialReceiveDestination;
extern volatile u16 gSerialReceivedSize;
extern volatile u8 gSerialBlockNumber;
extern u8 gLinkExchangeState;

#define W_MODE 0x00
#define W_PHASE 0x01
#define W_RECEIVED_MASK 0x02
#define W_CURRENT_MASK 0x03
#define W_TRANSFER_ERROR 0x09
#define W_PACKET_NUMBER 0x0B
#define W_SEND_INDEX 0x14
#define T_ACTIVE 0
#define T_STATUS 1
#define T_FLAGS 2
#define T_PEER_FLAGS 3

#define SIO_MULTI_MODE 0x2000
#define SIO_INTR_ENABLE 0x4000
#define SIO_115200_BPS 3
#define SIO_MULTI_SI 0x0004
#define SIO_MULTI_SD 0x0008
#define R_SIOCNT 0x128
#define R_RCNT 0x134
#define MODE_CLOCKING SIO_MULTI_SD

/* Frames without a new peer frame before "both heard" drops. The original drops it at once; the game then
 * counts 24 (LINK_MAX_MISSED_FRAMES) more before it gives up. Settable by the host (online: e.g. 300). */
static int freshFrames = 12;
void Port_LinkSetFreshFrames(int frames) { freshFrames = frames > 0 ? frames : 1; }

/* messages (little-endian, packed by hand) */
enum { MSG_FRAME = 1, MSG_BULK = 2 };
#define FRAME_BYTES 36 /* type, epoch, rxEpoch, 0, rxDone u16, 0 u16, frame u32, payload[24] */
#define BULK_HEADER 8  /* type, epoch, seq u16, size u32 */
#ifdef PORT_GAME_TLA
#define BULK_MAX 4352 /* TLA: Func_02000b24 receives GS1's 4100-byte save part */
#else
#define BULK_MAX 4096
#endif
#define QUEUE_LEN 8

static u8 myEpoch;        /* bumped by each Serial_Initialize */
static u16 sendSeq;       /* bulks sent in this epoch */
static u16 pendingSeq;    /* the bulk whose consumption we wait for, 0 none */
static u32 myFrame;       /* frames sent */
static int peerKnown;     /* a message of the peer was seen */
static u8 peerEpoch;      /* the peer's sender epoch, from its newest message */
static u16 rxDone;        /* bulks of peerEpoch handed to the game */
static u32 peerFrame;     /* the newest peer frame number taken */
static u8 peerPayload[24];
static u8 peerRxEpoch;    /* from the newest peer frame: which of our epochs it acknowledges */
static u16 peerRxDone;
static int sinceHeard = 1 << 20;

static struct { u16 size; u8 data[BULK_MAX]; } queue[QUEUE_LEN];
static int qHead, qCount;

static u32 statsFrames, statsLate, statsBulkIn, statsBulkOut;

static int MyId(void) { return port_link_player_id() & 1; }

/* SIOCNT as multiplayer hardware shows it: SD set once all consoles are there, SI set on the child, id bits */
static void WriteSiocnt(void) {
  u16 v = SIO_MULTI_MODE | SIO_INTR_ENABLE | SIO_115200_BPS;
  if (port_link_connected()) {
    v |= SIO_MULTI_SD | (MyId() << 4);
    if (MyId())
      v |= SIO_MULTI_SI;
  }
  IO16(R_SIOCNT) = v;
}

static u16 Rd16(const u8 *p) { return p[0] | p[1] << 8; }
static u32 Rd32(const u8 *p) { return p[0] | p[1] << 8 | p[2] << 16 | (u32)p[3] << 24; }
static void Wr16(u8 *p, u16 v) { p[0] = v; p[1] = v >> 8; }
static void Wr32(u8 *p, u32 v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }

/* A message of peer epoch e: a newer epoch drops what was queued of the old one; returns 0 for a stale one */
static int AcceptEpoch(u8 e) {
  if (!peerKnown || (s8)(e - peerEpoch) > 0) {
    peerKnown = 1;
    peerEpoch = e;
    rxDone = 0;
    qHead = qCount = 0;
    peerFrame = 0;
    return 1;
  }
  return e == peerEpoch;
}

/* GS10: no link session = no known peer; the next session's first message sets the peer epoch afresh */
static void ForgetPeerIfDisconnected(void) {
  if (!port_link_connected())
    peerKnown = 0;
}

static void Drain(void) {
  static u8 buf[BULK_HEADER + BULK_MAX];
  int n;
  int heard = 0;
  ForgetPeerIfDisconnected();
  while ((n = port_link_recv(LINK_CH_BULK, buf, sizeof buf)) >= 0) {
    u32 size;
    if (n < BULK_HEADER || buf[0] != MSG_BULK || !AcceptEpoch(buf[1]))
      continue;
    size = Rd32(buf + 4);
    if (size > BULK_MAX || (int)size + BULK_HEADER > n || qCount == QUEUE_LEN)
      continue; /* cannot happen with the game's transfers (largest 340 bytes, at most 4 queued) */
    queue[(qHead + qCount) % QUEUE_LEN].size = size;
    memcpy(queue[(qHead + qCount) % QUEUE_LEN].data, buf + BULK_HEADER, size);
    qCount++;
    statsBulkIn++;
  }
  while ((n = port_link_recv(LINK_CH_FRAME, buf, sizeof buf)) >= 0) {
    u32 f;
    if (n < FRAME_BYTES || buf[0] != MSG_FRAME || !AcceptEpoch(buf[1]))
      continue;
    f = Rd32(buf + 8);
    if (f <= peerFrame) {
      statsLate++;
      continue; /* older than what we hold: newest wins */
    }
    peerFrame = f;
    peerRxEpoch = buf[2];
    peerRxDone = Rd16(buf + 4);
    memcpy(peerPayload, buf + 12, 24);
    heard = 1;
  }
  sinceHeard = heard ? 0 : sinceHeard + 1;
}

static void ResetTransferGlobals(void) {
  gSerialTransfer[T_STATUS] = 0x80;
  gSerialSendSource = 0;
  gSerialSendSize = 0;
  gSerialReceiveDestination = 0;
  gSerialTransfer[T_PEER_FLAGS] = 0;
  gSerialTransfer[T_FLAGS] = 0;
  gSerialReceivedSize = 0;
}

void Serial_Initialize(void) {
  memset(gSerialWork, 0, sizeof gSerialWork);
  *(s32 *)(gSerialWork + W_SEND_INDEX) = -1;
  IO16(R_RCNT) = 0; /* SIO mode */
  WriteSiocnt();
  gSerialExchangeActive = 1;
  gLinkExchangeState = 0;
  ResetTransferGlobals(); /* the original's field clears and LinkBattle_ResetTransferState */
  myEpoch++;
  sendSeq = 0;
  pendingSeq = 0;
  sinceHeard = 1 << 20;
}

static s32 Status(void) {
  s32 status = gSerialWork[W_CURRENT_MASK] | gSerialWork[W_RECEIVED_MASK] << 8;
  if (gSerialWork[W_MODE] == MODE_CLOCKING)
    status |= 0x80; /* LINK_STATUS_CLOCKING */
  return status;
}

/* Once a frame from wait(): the partner search. Connected = the transport is; the parent "clocks". */
s32 Serial_PollStatus(void) {
  WriteSiocnt();
  ForgetPeerIfDisconnected();
  if (gSerialWork[W_PHASE] == 0) {
    if (port_link_connected()) {
      gSerialWork[W_MODE] = MyId() == 0 ? MODE_CLOCKING : 0;
      gSerialWork[W_PHASE] = 1;
    }
    gSerialWork[W_PACKET_NUMBER]++;
  }
  return Status();
}

/* VBlank: trade the 24-byte payloads */
s32 Serial_ExchangePayloads(void *send, void *receive) {
  u8 msg[FRAME_BYTES];
  u8 *slots = receive;
  int me = MyId(), fresh;
  if (gSerialWork[W_PHASE] != 1)
    return Status();
  Drain();
  memset(msg, 0, sizeof msg);
  msg[0] = MSG_FRAME;
  msg[1] = myEpoch;
  msg[2] = peerEpoch;
  Wr16(msg + 4, rxDone);
  Wr32(msg + 8, ++myFrame);
  memcpy(msg + 12, send, 24);
  port_link_send(LINK_CH_FRAME, msg, sizeof msg);
  statsFrames++;
  fresh = port_link_connected() && peerFrame != 0 && sinceHeard < freshFrames;
  memcpy(slots + me * 24, send, 24);
  if (fresh && sinceHeard == 0)
    memcpy(slots + (me ^ 1) * 24, peerPayload, 24);
  gSerialWork[W_CURRENT_MASK] = fresh ? 3 : 1 << me;
  gSerialWork[W_RECEIVED_MASK] |= gSerialWork[W_CURRENT_MASK];
  gSerialWork[W_TRANSFER_ERROR] = 0;
  gSerialWork[W_PACKET_NUMBER]++;
  return Status();
}

s32 Serial_StartSend(void *source, s32 size) {
  static u8 buf[BULK_HEADER + BULK_MAX];
  if (gSerialSendSource != 0)
    return -1;
  gSerialTransfer[T_STATUS] = 0x80;
  gSerialSendSource = (s32)(uintptr_t)source;
  gSerialSendSize = size;
  gSerialBlockNumber = 0;
  gSerialTransfer[T_ACTIVE] = 1;
  if (size < 0 || size > BULK_MAX)
    size = 0;
  buf[0] = MSG_BULK;
  buf[1] = myEpoch;
  Wr16(buf + 2, ++sendSeq);
  Wr32(buf + 4, size);
  memcpy(buf + BULK_HEADER, source, size);
  port_link_send(LINK_CH_BULK, buf, BULK_HEADER + size);
  pendingSeq = sendSeq;
  statsBulkOut++;
  return 0;
}

s32 Serial_StartReceive(void *destination) {
  if (gSerialReceiveDestination != 0)
    return -1;
  gSerialTransfer[T_STATUS] = 0x81;
  gSerialReceiveDestination = (s32)(uintptr_t)destination;
  gSerialReceivedSize = 0;
  gSerialTransfer[T_ACTIVE] = 1;
  gSerialBlockNumber = 0;
  return 0;
}

/* VBlank, after the exchange: finish sends the peer has consumed, hand a queued bulk to a waiting receive */
void Serial_StepBlockTransfer(void) {
  if ((gSerialWork[W_CURRENT_MASK] & 3) != 3)
    return;
  if (pendingSeq) {
    if (gSerialSendSource == 0) {
      pendingSeq = 0; /* zeroed under us (Serial_ResetTransferState): cancelled */
    } else if (peerRxEpoch == myEpoch && (s16)(peerRxDone - pendingSeq) >= 0) {
      gSerialSendSource = 0;
      gSerialSendSize = 0;
      gSerialTransfer[T_PEER_FLAGS] = 0;
      gSerialTransfer[T_ACTIVE] = 1;
      pendingSeq = 0;
    }
  }
  if (gSerialReceiveDestination != 0 && qCount > 0) {
    memcpy((void *)(uintptr_t)gSerialReceiveDestination, queue[qHead].data, queue[qHead].size);
    gSerialReceivedSize = queue[qHead].size;
    gSerialReceiveDestination = 0;
    gSerialTransfer[T_FLAGS] = 0;
    gSerialTransfer[T_STATUS] = 0;
    qHead = (qHead + 1) % QUEUE_LEN;
    qCount--;
    rxDone++;
  }
}

/* For the host's link panel and tests: frames sent, late/duplicate frames dropped, bulks in/out, queue length */
u32 Port_LinkStat(int which) {
  switch (which) {
  case 0: return statsFrames;
  case 1: return statsLate;
  case 2: return statsBulkIn;
  case 3: return statsBulkOut;
  case 4: return qCount;
  case 5: return sinceHeard;
  default: return 0;
  }
}
