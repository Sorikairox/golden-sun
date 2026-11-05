/* RTW2 (docs/RTW.md section 7): online link battles of the retrowser.app build through the host (retrowser standard
 * 1.2, spec section 4.12, model "link", 2 players). Included by port/rtw/rtw.c for GS1 only; the web build never
 * compiles it (its port/web/net.js stays as it is).
 *
 * port/pc/link.c is unchanged: it calls the link transport of port/pc/link_transport.h, which the web build gets from
 * port/web/port_lib.js (Module.linkTransport) and this build gets from the C functions below (a C definition wins
 * over the JS library's, so port_lib.js's are left out of the link). The host owns the room, the WebRTC connection,
 * the build/ROM check (net.js's hello and refuse), the role (session index 0 = the room host = link parent, net.js's
 * role check), the leave/close notice (net.js's bye) and the silence watchdog (net.js's 4 s / 20 s: the host's
 * rtw_net_peer states 2 "silent" after 3 s and 0 "gone" after 15 s).
 *
 *   port_link_connected() = a session whose other peer (1 - me) is in state 1, or in state 2 (silent: it may come
 *                           back): link.c's own 900-frame hold (Port_LinkSetFreshFrames, net.js FRESH_FRAMES_ONLINE)
 *                           decides when the game sees the link drop, as on the page; state 0 (gone) = unplugged.
 *   port_link_player_id() = me (0 = parent).
 *   port_link_send(ch)    = rtw_net_send(1 - me, ch == LINK_CH_FRAME ? 0 : 1, ...): link.c's 36-byte frames on the
 *                           unreliable channel 0, its bulk messages (<= 4360 bytes) on the reliable channel 1.
 *   port_link_recv(ch)    = pops the queues rtw_net_recv fills (only packets from peer 1 - me; lengths checked).
 *
 * Link epoch: link.c forgets its peer (peerKnown = 0, so the next message sets the peer's epoch afresh) whenever the
 * transport reports "not connected" when it looks. So at rtw_net_session, and when the peer comes back (2 -> 1) after
 * the game already saw the link drop (link.c silent for longer than its hold), port_link_connected() reports 0 for the
 * next FORGET_CALLS calls: every entry point of link.c reaches its ForgetPeerIfDisconnected within 3 calls. A peer
 * that comes back within the hold keeps its epoch (the battle resumes, as a short network drop does on the page).
 *
 * Desync guard (net.js's per-turn hash, moved into C): at each turn boundary of a link battle (a change of
 * gBattleRandomSeed, which the parent sends each turn) each side hashes its own party unit and the enemy unit (the
 * partner's, mirrored) and sends {battle, turn, seed, own, enemy} on channel 1 behind the tag NET_TAG_HASH (link.c's
 * bulk messages start with 2, MSG_BULK). Mine.own must equal theirs.enemy. Agreements and mismatches are counted
 * (port_rtw_net_info) and a mismatch is logged. */
#include <stdio.h>
#include <string.h>

/* host imports (standard 1.2; port/rtw/library_rtw.js) */
extern int rtw_net_send(int peer, int channel, const void *p, int len);
extern int rtw_net_stat(int peer, int kind);
/* port/pc/link.c */
void Port_LinkSetFreshFrames(int frames);
u32 Port_LinkStat(int which);

#define NET_FRESH_FRAMES 900 /* net.js FRESH_FRAMES_ONLINE (GS10): a network drop up to ~10 s resumes the battle */
#define FORGET_CALLS 6
#define NET_TAG_HASH 0xA7
#define NET_FRAME_MAX 64      /* link.c's frames are 36 bytes */
#define NET_BULK_MAX 4360     /* link.c: BULK_HEADER 8 + BULK_MAX 4352 */
#define NET_FRAMES_Q 16
#define NET_BULK_Q 16
#define HASH_KEEP 16
enum { PEER_GONE = 0, PEER_CONNECTED = 1, PEER_SILENT = 2 };

static u8 sNetRx[65536];
static int sNetOn, sNetMe, sNetPeer, sNetPeerState, sForget;
static struct { u16 len; u8 data[NET_FRAME_MAX]; } sFrameQ[NET_FRAMES_Q];
static int sFrameHead, sFrameCount;
static struct { u16 len; u8 data[NET_BULK_MAX]; } sBulkQ[NET_BULK_Q];
static int sBulkHead, sBulkCount;
static u32 sSent[2], sRecv[2], sRefused, sDropped, sBad, sResets, sSessions;

/* per-turn hashes */
struct TurnHash { u16 battle, turn; u32 seed, own, enemy; };
static struct TurnHash sMine[HASH_KEEP], sTheirs[HASH_KEEP];
static int sMineN, sTheirsN;
static int sInBattle, sBattle, sTurn;
static u32 sLastSeed, sHashOk, sHashBad, sFirstBad, sHpOwn, sHpEnemy;

static void net_clear_queues(void) { sFrameHead = sFrameCount = sBulkHead = sBulkCount = 0; }

int port_link_connected(void) {
  if (!sNetOn || (sNetPeerState != PEER_CONNECTED && sNetPeerState != PEER_SILENT))
    return 0;
  if (sForget > 0) {
    sForget--;
    return 0;
  }
  return 1;
}
int port_link_player_id(void) { return sNetMe & 1; }
void port_link_send(int channel, const void *data, int length) {
  int ch = channel == 0 ? 0 : 1, r;
  if (!port_link_connected() || length <= 0)
    return;
  r = rtw_net_send(sNetPeer, ch, data, length);
  if (r == 0)
    sSent[ch]++;
  else if (r == -1)
    sRefused++;
}
int port_link_recv(int channel, void *buf, int max) {
  int n;
  if (channel == 0) {
    if (!sFrameCount)
      return -1;
    n = sFrameQ[sFrameHead].len;
    memcpy(buf, sFrameQ[sFrameHead].data, n < max ? n : max);
    sFrameHead = (sFrameHead + 1) % NET_FRAMES_Q;
    sFrameCount--;
    return n;
  }
  if (!sBulkCount)
    return -1;
  n = sBulkQ[sBulkHead].len;
  memcpy(buf, sBulkQ[sBulkHead].data, n < max ? n : max);
  sBulkHead = (sBulkHead + 1) % NET_BULK_Q;
  sBulkCount--;
  return n;
}

/* ---------------- the desync guard ---------------- */
#define A_SEED 0x020023a8u
#define A_ENEMY 0x03001f28u
#define A_PARTY (0x02000240u + 0x2c0u)
static u32 rd32(const u8 *p) { return p[0] | p[1] << 8 | p[2] << 16 | (u32)p[3] << 24; }
static void wr32(u8 *p, u32 v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
static u32 unit_hash(u32 a) { /* net.js unitHash: FNV-1a over unit bytes 15..331 without 0x12a (the side byte) */
  const u8 *H = (const u8 *)(uintptr_t)a;
  u32 h = 0x811c9dc5u;
  int k;
  for (k = 15; k < 332; k++)
    if (k != 0x12a)
      h = (h ^ H[k]) * 0x01000193u;
  return h;
}
static struct TurnHash *find_hash(struct TurnHash *list, int n, int battle, int turn) {
  int i;
  for (i = 0; i < n; i++)
    if (list[i].battle == battle && list[i].turn == turn)
      return &list[i];
  return 0;
}
static void keep_hash(struct TurnHash *list, int *n, const struct TurnHash *h) {
  if (*n == HASH_KEEP) {
    memmove(list, list + 1, (HASH_KEEP - 1) * sizeof *list);
    (*n)--;
  }
  list[(*n)++] = *h;
}
static void drop_hash(struct TurnHash *list, int *n, struct TurnHash *h) {
  int i = (int)(h - list);
  memmove(list + i, list + i + 1, (*n - i - 1) * sizeof *list);
  (*n)--;
}
static void compare_hash(int battle, int turn) {
  struct TurnHash *a = find_hash(sMine, sMineN, battle, turn), *b = find_hash(sTheirs, sTheirsN, battle, turn), x, y;
  if (!a || !b)
    return;
  x = *a, y = *b;
  drop_hash(sMine, &sMineN, a);
  drop_hash(sTheirs, &sTheirsN, find_hash(sTheirs, sTheirsN, battle, turn));
  if (x.seed == y.seed && x.own == y.enemy && x.enemy == y.own) {
    sHashOk++;
    return;
  }
  sHashBad++;
  if (!sFirstBad)
    sFirstBad = (u32)battle << 16 | (u32)turn;
  printf("[net] DESYNC at battle.turn %d.%d: mine seed %08x units %08x/%08x, partner seed %08x units %08x/%08x\n", battle, turn,
         (unsigned)x.seed, (unsigned)x.own, (unsigned)x.enemy, (unsigned)y.seed, (unsigned)y.own, (unsigned)y.enemy);
}
static void net_frame(void) { /* once per game frame (port_rtw_frame) */
  u32 eu, seed;
  struct TurnHash h;
  u8 msg[20];
  if (!sNetOn || sNetPeerState == PEER_GONE)
    return;
  eu = *(const u32 *)(uintptr_t)A_ENEMY;
  if (!eu || eu < 0x02000000u || eu >= 0x03008000u) {
    sInBattle = 0;
    return;
  }
  if (!sInBattle) {
    sInBattle = 1;
    sBattle++;
    sTurn = 0;
    sLastSeed = 0;
  }
  seed = *(const u32 *)(uintptr_t)A_SEED;
  if (seed == sLastSeed)
    return;
  sLastSeed = seed;
  h.battle = (u16)sBattle;
  h.turn = (u16)++sTurn;
  h.seed = seed;
  h.own = unit_hash(A_PARTY);
  h.enemy = unit_hash(eu);
  sHpOwn = *(const u16 *)(uintptr_t)(A_PARTY + 0x38);
  sHpEnemy = *(const u16 *)(uintptr_t)(eu + 0x38);
  keep_hash(sMine, &sMineN, &h);
  msg[0] = NET_TAG_HASH;
  msg[1] = 0;
  msg[2] = h.battle, msg[3] = h.battle >> 8, msg[4] = h.turn, msg[5] = h.turn >> 8;
  wr32(msg + 6, h.seed);
  wr32(msg + 10, h.own);
  wr32(msg + 14, h.enemy);
  if (rtw_net_send(sNetPeer, 1, msg, 18) == 0)
    sSent[1]++;
  compare_hash(h.battle, h.turn);
}
static void net_hash_in(const u8 *p, int len) {
  struct TurnHash h;
  if (len < 18) {
    sBad++;
    return;
  }
  h.battle = p[2] | p[3] << 8;
  h.turn = p[4] | p[5] << 8;
  h.seed = rd32(p + 6);
  h.own = rd32(p + 10);
  h.enemy = rd32(p + 14);
  if (find_hash(sTheirs, sTheirsN, h.battle, h.turn))
    return;
  keep_hash(sTheirs, &sTheirsN, &h);
  compare_hash(h.battle, h.turn);
}

/* ---------------- the standard's exports (1.2) ---------------- */
RTW int rtw_net_session(int players, int me) {
  if (players != 2 || me < 0 || me > 1) {
    printf("[net] session of %d players (me %d) refused: the link cable joins 2\n", players, me);
    sNetOn = 0;
    return 0;
  }
  sNetOn = 1;
  sNetMe = me;
  sNetPeer = 1 - me;
  sNetPeerState = PEER_GONE; /* rtw_net_peer follows at once */
  sForget = FORGET_CALLS;    /* a new partner: its epochs start again at 1 */
  sSessions++;
  net_clear_queues();
  sMineN = sTheirsN = 0;
  sInBattle = sBattle = sTurn = 0;
  sLastSeed = 0;
  Port_LinkSetFreshFrames(NET_FRESH_FRAMES);
  printf("[net] linked as player %d (%s): go to the Battle Arena (File Screen > Battle)\n", me + 1, me ? "guest" : "room host, link parent");
  return 0;
}

RTW int rtw_net_peer(int peer, int state) {
  int was = sNetPeerState;
  if (!sNetOn || peer != sNetPeer || state < 0 || state > 2)
    return 0;
  sNetPeerState = state;
  if (state == PEER_CONNECTED && was == PEER_SILENT) {
    if ((int)Port_LinkStat(5) >= NET_FRESH_FRAMES) { /* the game already saw the link drop: a fresh link epoch */
      sForget = FORGET_CALLS;
      sResets++;
      net_clear_queues();
      printf("[net] the partner answers again (the link had dropped: it starts afresh)\n");
    } else
      printf("[net] the partner answers again\n");
  } else if (state == PEER_SILENT)
    printf("[net] partner not responding (the game holds the link %d frames, then ends a battle)\n", NET_FRESH_FRAMES);
  else if (state == PEER_GONE && was != PEER_GONE) {
    net_clear_queues();
    printf("[net] partner left: a battle in progress ends (\"The link was disconnected.\")\n");
  }
  return 0;
}

RTW int rtw_net_buffer(int size) { return size > 0 && size <= (int)sizeof sNetRx ? (int)(uintptr_t)sNetRx : 0; }

/* only stores the packet (the game runs on at its next frame; nothing is resumed from here) */
RTW int rtw_net_recv(int peer, int channel, int len) {
  if (!sNetOn || peer != sNetPeer || len <= 0 || len > (int)sizeof sNetRx) {
    sBad++;
    return 0;
  }
  if (channel == 0) {
    int i;
    if (len > NET_FRAME_MAX) {
      sBad++;
      return 0;
    }
    if (sFrameCount == NET_FRAMES_Q) { /* nobody drains (not in the lobby): the oldest goes, newest wins anyway */
      sFrameHead = (sFrameHead + 1) % NET_FRAMES_Q;
      sFrameCount--;
    }
    i = (sFrameHead + sFrameCount++) % NET_FRAMES_Q;
    sFrameQ[i].len = (u16)len;
    memcpy(sFrameQ[i].data, sNetRx, len);
    sRecv[0]++;
    return 0;
  }
  if (channel == 1) {
    int i;
    sRecv[1]++;
    if (sNetRx[0] == NET_TAG_HASH) {
      net_hash_in(sNetRx, len);
      return 0;
    }
    if (len > NET_BULK_MAX) {
      sBad++;
      return 0;
    }
    if (sBulkCount == NET_BULK_Q) {
      sDropped++;
      return 0;
    }
    i = (sBulkHead + sBulkCount++) % NET_BULK_Q;
    sBulkQ[i].len = (u16)len;
    memcpy(sBulkQ[i].data, sNetRx, len);
    return 0;
  }
  sBad++;
  return 0;
}

/* tests/rtw_net_e2e.mjs (through rtw_glue.js __rtwGs.net()) */
RTW int port_rtw_net_info(int k) {
  switch (k) {
  case 0: return sNetOn;
  case 1: return sNetMe;
  case 2: return sNetPeerState;
  case 3: return sNetOn && (sNetPeerState == PEER_CONNECTED || sNetPeerState == PEER_SILENT) && sForget == 0;
  case 4: return (int)sHashOk;
  case 5: return (int)sHashBad;
  case 6: return (int)sSent[0];
  case 7: return (int)sSent[1];
  case 8: return (int)sRecv[0];
  case 9: return (int)sRecv[1];
  case 10: return (int)sRefused;
  case 11: return (int)sDropped;
  case 12: return (int)sBad;
  case 13: return sBattle;
  case 14: return sTurn;
  case 15: return (int)sHpOwn;
  case 16: return (int)sHpEnemy;
  case 17: return (int)sFirstBad;
  case 18: return (int)sResets;
  case 19: return (int)sSessions;
  case 20: return rtw_net_stat(sNetPeer, 0);
  case 21: return (int)Port_LinkStat(5); /* link.c: frames since the newest peer frame */
  case 22: return (int)Port_LinkStat(2); /* bulks in */
  case 23: return (int)Port_LinkStat(3); /* bulks out */
  default: return 0;
  }
}
