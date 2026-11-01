// In-memory link transport pair (G6, orchestrator D21): two objects with the interface of
// port/pc/link_transport.h (connected, playerId, send, recv), wired to each other. The host advances time with
// pair.tick() once per lockstep frame; a message sent at tick T is delivered from tick T + delay on. Channel 0
// (frames) is unreliable: each message is dropped with probability `drop` (deterministic PRNG from `seed`) and
// may be held back an extra `jitter` ticks (so frames can arrive out of order); channel 1 (bulk) is reliable and
// ordered, delayed only. Used by tests/link2.cjs (node) and, later, a two-instance page; G7 replaces it with
// WebRTC data channels behind the same interface.
'use strict';
(function (root) {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createLoopbackPair(opt = {}) {
    const delay = opt.delay | 0, drop = +opt.drop || 0, jitter = opt.jitter | 0;
    const rnd = mulberry32(opt.seed >>> 0 || 1);
    let now = 0, up = opt.connected !== false;
    const stats = { sent: [0, 0], dropped: 0 };
    // inbox[player][channel]: [{at, bytes}]
    const inbox = [[[], []], [[], []]];
    const make = (id) => ({
      connected: () => up,
      playerId: () => id,
      send(ch, bytes) {
        if (!up) return;
        stats.sent[ch]++;
        let at = now + delay;
        if (ch === 0) {
          if (drop && rnd() < drop) { stats.dropped++; return; }
          if (jitter) at += Math.floor(rnd() * (jitter + 1));
        }
        inbox[id ^ 1][ch].push({ at, bytes });
      },
      recv(ch) {
        const q = inbox[id][ch];
        if (ch === 1) return q.length && q[0].at <= now ? q.shift().bytes : null; // ordered
        const i = q.findIndex((m) => m.at <= now);                               // unordered
        return i < 0 ? null : q.splice(i, 1)[0].bytes;
      },
    });
    return {
      ends: [make(0), make(1)],
      tick() { now++; },
      setConnected(v) { up = !!v; },
      stats,
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createLoopbackPair };
  else root.GSLinkLoopback = { createLoopbackPair };
})(typeof self !== 'undefined' ? self : this);
