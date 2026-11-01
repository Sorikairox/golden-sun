/* The m4a (MusicPlayer2000) sequencer assembly of vendor src/sound/clear_buffer.s, hand-ported to C (D6, session
 * GS-audio): the track commands (ply_*), MPlayMain, TrackStop, ply_note, ply_endtie, m4aSoundVSync. Written from
 * the routines' own instructions, field by field at the byte offsets they use (MusicPlayerInfo, MusicPlayerTrack
 * 80 bytes, SoundChannel/CgbChannel 64 bytes, SoundInfo at *0x03007FF0); tests/arm/diff.cjs proves each one
 * against the ROM's code. chk_adr_r2 (clears a pointer below the command table in the BIOS area) never fires on
 * the game's data (ROM or RAM addresses), so it is kept only where it can matter (none). */
#include "gba.h"

#define U8(p, o) (*(volatile u8 *)((uintptr_t)(p) + (o)))
#define S8(p, o) (*(volatile s8 *)((uintptr_t)(p) + (o)))
#define U16(p, o) (*(volatile u16 *)((uintptr_t)(p) + (o)))
#define U32(p, o) (*(volatile u32 *)((uintptr_t)(p) + (o)))
#define SOUND_INFO() (*(volatile u32 *)(uintptr_t)0x03007FF0u)
#define ID_NUMBER 0x68736D53u

typedef void (*Fn3)(u32, u32, u32);
typedef u32 (*FnR3)(u32, u32, u32);
typedef void (*Fn1)(u32);

/* vendor C (driver.c/audio.c) */
void ClearChain(void *note);
void Clear64byte(void *block);
void FadeOutBody(void *player);
void TrkVolPitSet(void *player, void *track);
s32 MidiKeyToFreq(void *wave, u8 key, u8 pitch);
void RealClearChain(void *channel);
extern u8 gClockTable[];

#define CALL3(f, a, b, c) ((Fn3)(uintptr_t)(f))((u32)(a), (u32)(b), (u32)(c))
#define CALLR3(f, a, b, c) ((FnR3)(uintptr_t)(f))((u32)(a), (u32)(b), (u32)(c))

/* ld_r3_tp_adr_i: the next command byte of the track (track+64 = command pointer) */
static u32 next_byte(u32 track) {
  u32 p = U32(track, 64);
  U32(track, 64) = p + 1;
  return U8(p, 0);
}

/* ---------------- commands (player in r0, track in r1) ---------------- */

void ply_fine(u32 player, u32 track) {
  u32 ch = U32(track, 32);
  (void)player;
  while (ch) {
    u8 st = U8(ch, 0);
    if (st & 0xC7)
      U8(ch, 0) = st | 0x40;
    RealClearChain((void *)(uintptr_t)ch);
    ch = U32(ch, 52);
  }
  U8(track, 0) = 0;
}

static void goto_jump(u32 track) {
  u32 p = U32(track, 64);
  U32(track, 64) = U8(p, 0) | U8(p, 1) << 8 | U8(p, 2) << 16 | (u32)U8(p, 3) << 24;
}

void ply_goto(u32 player, u32 track) {
  (void)player;
  goto_jump(track);
}

void ply_patt(u32 player, u32 track) {
  u32 level = U8(track, 2);
  if (level >= 3) {
    ply_fine(player, track);
    return;
  }
  U32(track + level * 4, 68) = U32(track, 64) + 4;
  U8(track, 2) = (u8)(level + 1);
  goto_jump(track);
}

void ply_pend(u32 player, u32 track) {
  u32 level = U8(track, 2);
  (void)player;
  if (level == 0)
    return;
  level--;
  U8(track, 2) = (u8)level;
  U32(track, 64) = U32(track + level * 4, 68);
}

void ply_rept(u32 player, u32 track) {
  u32 p = U32(track, 64), n, count;
  (void)player;
  if (U8(p, 0) == 0) {
    U32(track, 64) = p + 1;
    goto_jump(track);
    return;
  }
  n = (u8)(U8(track, 3) + 1);
  U8(track, 3) = (u8)n;
  count = next_byte(track); /* r2 = p, pointer now p + 1 */
  if (n < count) {
    goto_jump(track);
    return;
  }
  U8(track, 3) = 0;
  U32(track, 64) = p + 5;
}

void ply_prio(u32 player, u32 track) {
  (void)player;
  U8(track, 29) = (u8)next_byte(track);
}

void ply_tempo(u32 player, u32 track) {
  u32 t = next_byte(track) << 1;
  U16(player, 28) = (u16)t;
  U16(player, 32) = (u16)((t * U16(player, 30)) >> 8);
}

void ply_keysh(u32 player, u32 track) {
  (void)player;
  U8(track, 10) = (u8)next_byte(track);
  U8(track, 0) |= 12;
}

void ply_voice(u32 player, u32 track) {
  u32 p = U32(track, 64), v;
  v = U8(p, 0);
  U32(track, 64) = p + 1;
  v = v * 12 + U32(player, 48);
  U32(track, 36) = U32(v, 0);
  U32(track, 40) = U32(v, 4);
  U32(track, 44) = U32(v, 8);
}

void ply_vol(u32 player, u32 track) {
  (void)player;
  U8(track, 18) = (u8)next_byte(track);
  U8(track, 0) |= 3;
}

void ply_pan(u32 player, u32 track) {
  (void)player;
  U8(track, 20) = (u8)(next_byte(track) - 64);
  U8(track, 0) |= 3;
}

void ply_bend(u32 player, u32 track) {
  (void)player;
  U8(track, 14) = (u8)(next_byte(track) - 64);
  U8(track, 0) |= 12;
}

void ply_bendr(u32 player, u32 track) {
  (void)player;
  U8(track, 15) = (u8)next_byte(track);
  U8(track, 0) |= 12;
}

void ply_lfodl(u32 player, u32 track) {
  (void)player;
  U8(track, 27) = (u8)next_byte(track);
}

void ply_modt(u32 player, u32 track) {
  u32 v = next_byte(track);
  (void)player;
  if (U8(track, 24) != v) {
    U8(track, 24) = (u8)v;
    U8(track, 0) |= 15;
  }
}

void ply_tune(u32 player, u32 track) {
  (void)player;
  U8(track, 12) = (u8)(next_byte(track) - 64);
  U8(track, 0) |= 12;
}

void ply_port(u32 player, u32 track) {
  u32 p = U32(track, 64);
  u32 reg = 0x04000060u + U8(p, 0);
  (void)player;
  U32(track, 64) = p + 2;
  *(volatile u8 *)(uintptr_t)reg = U8(p, 1);
}

static void clear_modM(u32 track) {
  U8(track, 22) = 0;
  U8(track, 26) = 0;
  U8(track, 0) |= U8(track, 24) ? 3 : 12;
}

void ply_lfos(u32 player, u32 track) {
  u32 v = next_byte(track);
  (void)player;
  U8(track, 25) = (u8)v;
  if (!v)
    clear_modM(track);
}

void ply_mod(u32 player, u32 track) {
  u32 v = next_byte(track);
  (void)player;
  U8(track, 23) = (u8)v;
  if (!v)
    clear_modM(track);
}

void ply_endtie(u32 player, u32 track) {
  u32 p = U32(track, 64), key, ch;
  (void)player;
  key = U8(p, 0);
  if (key < 128) {
    U8(track, 5) = (u8)key;
    U32(track, 64) = p + 1;
  } else
    key = U8(track, 5);
  for (ch = U32(track, 32); ch; ch = U32(ch, 52)) {
    u8 st = U8(ch, 0);
    if ((st & 131) && !(st & 64) && U8(ch, 17) == key) {
      U8(ch, 0) = st | 64;
      return;
    }
  }
}

/* ChnVolSetAsm: channel volumes from its velocity/rhythm pan and the track's volMR/volML */
static void chn_vol_set(u32 ch, u32 track) {
  u32 vel = U8(ch, 18);
  s32 pan = S8(ch, 20);
  u32 v = ((u32)(128 + pan) * vel * U8(track, 16)) >> 14;
  U8(ch, 2) = (u8)(v > 255 ? 255 : v);
  v = ((u32)(127 - pan) * vel * U8(track, 17)) >> 14;
  U8(ch, 3) = (u8)(v > 255 ? 255 : v);
}

void TrackStop(u32 player, u32 track) {
  u32 ch;
  (void)player;
  if (!(U8(track, 0) & 0x80))
    return;
  for (ch = U32(track, 32); ch; ch = U32(ch, 52)) {
    if (U8(ch, 0)) {
      u32 kind = U8(ch, 1) & 7;
      if (kind)
        ((Fn1)(uintptr_t)U32(SOUND_INFO(), 44))(kind); /* cgbMute(kind) (r0 = kind) */
      U8(ch, 0) = 0;
    }
    U32(ch, 44) = 0;
  }
  U32(track, 32) = 0;
}

void ply_note(u32 cmd, u32 player, u32 track) {
  u32 si = SOUND_INFO();
  u32 p, b, tone, key, rhythmPan = 0, prio, kind, ch = 0;
  U8(track, 4) = gClockTable[cmd];
  p = U32(track, 64);
  b = U8(p, 0);
  if (b < 128) {
    U8(track, 5) = (u8)b;
    p++;
    b = U8(p, 0);
    if (b < 128) {
      U8(track, 6) = (u8)b;
      p++;
      b = U8(p, 0);
      if (b < 128) {
        U8(track, 4) = (u8)(U8(track, 4) + b);
        p++;
      }
    }
    U32(track, 64) = p;
  }
  {
    u32 t = U8(track, 36);
    if (t & 0xC0) {
      u32 idx = U8(track, 5);
      if (t & 0x40)
        idx = U8(U32(track, 44) + idx, 0);
      tone = idx * 12 + U32(track, 40);
      if (U8(tone, 0) & 0xC0)
        return;
      if (t & 0x80) {
        u32 pan = U8(tone, 3);
        if (pan & 0x80)
          rhythmPan = (pan - 192) << 1;
        key = U8(tone, 1);
      } else
        key = U8(track, 5);
    } else {
      tone = track + 36;
      key = U8(track, 5);
    }
  }
  prio = U8(track, 29) + U8(player, 9);
  if (prio > 255)
    prio = 255;
  kind = U8(tone, 0) & 7;
  if (kind) {
    u32 st;
    ch = U32(si, 28);
    if (!ch)
      return;
    ch += (kind - 1) << 6;
    st = U8(ch, 0);
    if ((st & 0xC7) && !(st & 0x40)) {
      u32 cp = U8(ch, 19);
      if (cp > prio)
        return;
      if (cp == prio && U32(ch, 44) < track)
        return;
    }
  } else {
    u32 bestPrio = prio, bestTrack = track, n = U8(si, 6), c = si + 80, found = 0;
    int stopped = 0;
    ch = 0;
    for (;; c += 64) { /* do-while: subs r3, #1; bgt */
      u32 st = U8(c, 0);
      if (!(st & 0xC7)) {
        ch = c;
        found = 1;
        break;
      }
      if (st & 0x40) {
        if (!stopped) {
          stopped = 1;
          bestPrio = U8(c, 19);
          bestTrack = U32(c, 44);
          ch = c;
          goto scan_next;
        }
      } else if (stopped)
        goto scan_next;
      /* compare */
      {
        u32 cp = U8(c, 19);
        if (cp < bestPrio) {
          bestPrio = cp;
          bestTrack = U32(c, 44);
          ch = c;
        } else if (cp == bestPrio) {
          u32 ct = U32(c, 44);
          if (ct > bestTrack) {
            bestTrack = ct;
            ch = c;
          } else if (ct == bestTrack)
            ch = c;
        }
      }
    scan_next:
      if ((s32)--n <= 0)
        break;
    }
    if (!found && !ch)
      return;
  }
  /* take the channel */
  ClearChain((void *)(uintptr_t)ch);
  U32(ch, 48) = 0;
  U32(ch, 52) = U32(track, 32);
  if (U32(track, 32))
    U32(U32(track, 32), 48) = ch;
  U32(track, 32) = ch;
  U32(ch, 44) = track;
  U8(track, 28) = U8(track, 27);
  if (U8(track, 27))
    clear_modM(track);
  TrkVolPitSet((void *)(uintptr_t)player, (void *)(uintptr_t)track);
  U32(ch, 16) = U32(track, 4);
  U8(ch, 19) = (u8)prio;
  U8(ch, 8) = (u8)key;
  U8(ch, 20) = (u8)rhythmPan;
  U8(ch, 1) = U8(tone, 0);
  U32(ch, 36) = U32(tone, 4);
  U32(ch, 4) = U32(tone, 8);
  U16(ch, 12) = U16(track, 30);
  chn_vol_set(ch, track);
  {
    s32 k = (s32)U8(ch, 8) + S8(track, 8);
    u32 freq;
    if (k < 0)
      k = 0;
    if (kind) {
      u32 sw = U8(tone, 3);
      U8(ch, 30) = U8(tone, 2);
      if ((sw & 0x80) || !(sw & 0x70))
        sw = 8;
      U8(ch, 31) = (u8)sw;
      freq = CALLR3(U32(si, 48), kind, k, U8(track, 9));
    } else
      freq = (u32)MidiKeyToFreq((void *)(uintptr_t)U32(tone, 4), (u8)k, U8(track, 9));
    U32(ch, 32) = freq;
  }
  U8(ch, 0) = 0x80;
  U8(track, 0) &= 0xF0;
}

/* ---------------- MPlayMain ---------------- */

void MPlayMain(u32 player) {
  u32 si, track, n, bits, active;
  if (U32(player, 52) != ID_NUMBER)
    return;
  U32(player, 52) = ID_NUMBER + 1;
  if (U32(player, 56))
    ((Fn1)(uintptr_t)U32(player, 56))(U32(player, 60));
  if ((s32)U32(player, 4) < 0)
    goto done;
  si = SOUND_INFO();
  FadeOutBody((void *)(uintptr_t)player);
  if ((s32)U32(player, 4) < 0)
    goto done;
  {
    u32 c = (u32)U16(player, 34) + U16(player, 32);
    while ((U16(player, 34) = (u16)c, c >= 150)) {
      n = U8(player, 8);
      track = U32(player, 44);
      bits = 1;
      active = 0;
      for (;;) {
        if (U8(track, 0) & 0x80) {
          u32 ch;
          active |= bits;
          for (ch = U32(track, 32); ch; ch = U32(ch, 52)) {
            u8 st = U8(ch, 0);
            if (st & 0xC7) {
              u8 g = U8(ch, 16);
              if (g) {
                g--;
                U8(ch, 16) = g;
                if (!g)
                  U8(ch, 0) = st | 0x40;
              }
            } else
              ClearChain((void *)(uintptr_t)ch);
          }
          if (U8(track, 0) & 0x40) {
            Clear64byte((void *)(uintptr_t)track);
            U8(track, 0) = 0x80;
            U8(track, 15) = 2;
            U8(track, 19) = 64;
            U8(track, 25) = 22;
            U8(track, 36) = 1;
          }
          for (;;) {
            u32 w = U8(track, 1);
            if (w) {
              u32 lfo;
              U8(track, 1) = (u8)(w - 1);
              lfo = U8(track, 25);
              if (lfo && U8(track, 23)) {
                if (U8(track, 28)) {
                  U8(track, 28) = (u8)(U8(track, 28) - 1);
                } else {
                  u32 c26 = U8(track, 26) + lfo; /* the full sum (up to 510), stored as a byte */
                  s32 m;
                  U8(track, 26) = (u8)c26;
                  if ((s32)((c26 - 64) << 24) < 0)
                    m = (s8)c26;
                  else
                    m = 128 - (s32)c26;
                  m = (s32)(U8(track, 23) * m) >> 6;
                  if ((u8)(U8(track, 22) ^ m)) {
                    U8(track, 22) = (u8)m;
                    U8(track, 0) |= U8(track, 24) ? 3 : 12;
                  }
                }
              }
              break;
            }
            {
              u32 p = U32(track, 64), cmd = U8(p, 0);
              if (cmd < 128)
                cmd = U8(track, 7);
              else {
                U32(track, 64) = p + 1;
                if (cmd >= 189)
                  U8(track, 7) = (u8)cmd;
              }
              if (cmd >= 207) {
                CALL3(U32(si, 56), cmd - 207, player, track);
              } else if (cmd > 176) {
                u32 f;
                U8(player, 10) = (u8)(cmd - 177);
                f = U32(U32(si, 52) + (cmd - 177) * 4, 0);
                ((void (*)(u32, u32))(uintptr_t)f)(player, track);
                if (U8(track, 0) == 0)
                  goto next_track;
              } else {
                U8(track, 1) = gClockTable[cmd - 128];
              }
            }
          }
        }
      next_track:
        if (--n == 0 || (s32)n < 0)
          break;
        track += 80;
        bits <<= 1;
      }
      U32(player, 12) = U32(player, 12) + 1;
      if (!active) {
        U32(player, 4) = 0x80000000u;
        goto done;
      }
      U32(player, 4) = active;
      c = (u32)U16(player, 34) - 150;
    }
  }
  n = U8(player, 8);
  track = U32(player, 44);
  for (;;) {
    u32 f = U8(track, 0);
    if ((f & 0x80) && (f & 15)) {
      u32 ch;
      TrkVolPitSet((void *)(uintptr_t)player, (void *)(uintptr_t)track);
      for (ch = U32(track, 32); ch; ch = U32(ch, 52)) {
        u32 kind;
        if (!(U8(ch, 0) & 0xC7)) {
          ClearChain((void *)(uintptr_t)ch);
          continue;
        }
        kind = U8(ch, 1) & 7;
        if (U8(track, 0) & 3) {
          chn_vol_set(ch, track);
          if (kind)
            U8(ch, 29) |= 1;
        }
        if (U8(track, 0) & 12) {
          s32 k = (s32)U8(ch, 8) + S8(track, 8);
          if (k < 0)
            k = 0;
          if (kind) {
            U32(ch, 32) = CALLR3(U32(si, 48), kind, k, U8(track, 9));
            U8(ch, 29) |= 2;
          } else
            U32(ch, 32) = (u32)MidiKeyToFreq((void *)(uintptr_t)U32(ch, 36), (u8)k, U8(track, 9));
        }
      }
      U8(track, 0) &= 0xF0;
    }
    if ((s32)--n <= 0)
      break;
    track += 80;
  }
done:
  U32(player, 52) = ID_NUMBER;
}

/* ---------------- m4aSoundVSync ---------------- */

void Port_ApuDmaRestart(int ch); /* apu.c: the FIFO DMA was restarted (its source register re-read) */

void m4aSoundVSync(void) {
  u32 si = SOUND_INFO();
  s32 c;
  if (U32(si, 0) - ID_NUMBER > 1)
    return;
  c = (s32)U8(si, 4) - 1;
  U8(si, 4) = (u8)c;
  if (c > 0)
    return;
  U8(si, 4) = U8(si, 11);
  if (IO32(0x0BC + 8) & (1u << 25))
    IO32(0x0BC + 8) = 0x84400004u;
  if (IO32(0x0BC + 20) & (1u << 25))
    IO32(0x0BC + 20) = 0x84400004u;
  IO16(0x0BC + 10) = 0x0400;
  IO16(0x0BC + 22) = 0x0400;
  IO16(0x0BC + 10) = 0xB600;
  IO16(0x0BC + 22) = 0xB600;
  Port_ApuDmaRestart(1);
  Port_ApuDmaRestart(2);
}
