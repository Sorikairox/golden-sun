// Online link battle (G7, docs/LINK.md section 8): the link transport of port/pc/link_transport.h over WebRTC, plus
// rooms, the hello check, the per-turn hash guard and the page panel. No input lockstep: each page runs its own
// game at full speed; only link.c's messages cross (orchestrator section 6, option B').
//
// One RTCPeerConnection, two negotiated data channels:
//   'frame' (id 1) ordered:false, maxRetransmits:0  -> transport channel 0 (link.c's 36-byte frames, newest wins)
//   'bulk'  (id 2) reliable, ordered                 -> transport channel 1 (link.c's bulk messages, binary) and,
//                                                      as text (JSON), our own control messages: hello / refuse /
//                                                      hash / bye
// playerId 0 = the room host (link parent), 1 = the guest. connected() is true only once both channels are open and
// both hellos matched (same build id, same ROM SHA-1, English edition); until then link.c sees no link.
// Signaling: room codes on a small server (port/netlify/functions/room, local copy tools/roomserver.mjs), or
// copy-paste codes (the offer/answer SDPs, deflated) when no server is reachable. STUN only, no TURN (D15).
// Test aids (URL): ?roomapi=URL a room server; ?stun=none host candidates only (local tests);
//   ?netsim=DELAY,DROP,JITTER (ms, fraction 0..1 or percent, ms) or ?netsim=lat:MS,jit:MS,loss:PCT delays this page's
//   outgoing link messages (bulk keeps its order), drops and reorders its frames, like port/web/link_loopback.js.
'use strict';
(function () {
  const Q = new URLSearchParams(location.search);
  const ROM_SHA1 = '5c4695205413df7db52b9a184815a07783999971';
  const EDITION = 'en';                 // the lobby signature words are per language: only tbs-en players can meet
  // link.c: "both heard" held 15 s after the newest peer frame (offline 12). GS10 (docs/LINK.md section 9): with 900 a
  // network drop of up to ~10 s anywhere in a battle resumes it (tests/link2.cjs --silence); a longer one ends it
  // with the game's own "The link was disconnected." A partner who leaves or closes the tab is seen at once (bye /
  // channel close -> connected() false), so the window only delays the verdict on a silent network.
  const FRESH_FRAMES_ONLINE = 900;
  const STUN = Q.get('stun') === 'none' ? [] : [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const CODE_TAG = 'GS1.';

  const N = window.GSNet = {
    roomApi: Q.get('roomapi') || '/api/room',
    buildId: (window.GS_BUILD || '0000000000000000'),
    module: null,                      // the game module (main.js sets it)
    stats: { sent: [0, 0], recv: [0, 0], simDropped: 0, hashOk: 0, hashBad: 0, firstBad: null, rtt: 0 },
  };
  const S = { role: null, pc: null, dc: [null, null], helloSent: false, peerHello: null, ready: false, left: false,
    queues: [[], []], room: null, myHashes: new Map(), peerHashes: new Map(), battle: 0, turn: 0, lastSeed: 0, inBattle: false };
  const log = (s) => console.log('[net] ' + s);

  // ---- netsim
  const SIM = { lat: 0, jit: 0, loss: 0 };
  {
    const v = Q.get('netsim');
    if (v) {
      if (v.includes(':')) for (const kv of v.split(',')) { const [k, x] = kv.split(':'); SIM[k] = +x || 0; }
      else { const [d, p, j] = v.split(',').map(Number); SIM.lat = d || 0; SIM.loss = p > 1 ? p : (p || 0) * 100; SIM.jit = j || 0; }
      log(`netsim: delay ${SIM.lat} ms + 0..${SIM.jit} ms, ${SIM.loss} % of frames dropped`);
    }
  }
  const simOn = SIM.lat || SIM.jit || SIM.loss;
  let bulkAt = 0;   // netsim: bulk keeps its order

  // ---- the transport (Module.linkTransport)
  function rawSend(ch, data) {
    const dc = S.dc[ch];
    if (!dc || dc.readyState !== 'open') return;
    try { dc.send(data); } catch (e) { log('send failed: ' + e.message); }
  }
  // netsim queue: due messages go out from every game frame (N.onFrame, which runs from the worker ticks while the
  // page is hidden) and from a timer; a hidden page's timers alone are throttled to ~1 s and would distort the delay
  const simQ = [];
  let simTimer = 0;
  function simPump() {
    const now = performance.now();
    while (simQ.length && simQ[0].at <= now) { const e = simQ.shift(); rawSend(e.ch, e.data); }
    clearTimeout(simTimer);
    if (simQ.length) simTimer = setTimeout(simPump, Math.max(0, simQ[0].at - now));
  }
  function simSend(ch, data) {
    if (!simOn) return rawSend(ch, data);
    const now = performance.now();
    let at;
    if (ch === 0) {
      if (SIM.loss && Math.random() * 100 < SIM.loss) { N.stats.simDropped++; return; }
      at = now + SIM.lat + Math.random() * SIM.jit;
    } else at = bulkAt = Math.max(bulkAt, now + SIM.lat);
    let i = simQ.length;
    while (i > 0 && simQ[i - 1].at > at) i--;
    simQ.splice(i, 0, { at, ch, data });
    if (i === 0) simPump();
  }
  N.transport = {
    connected: () => S.ready,
    playerId: () => (S.role === 'guest' ? 1 : 0),
    send(ch, bytes) { if (!S.ready) return; N.stats.sent[ch]++; simSend(ch, bytes); },
    recv(ch) { const q = S.queues[ch]; return q.length ? q.shift() : null; },
  };
  const ctl = (obj) => simSend(1, JSON.stringify(obj));

  // ---- events for the panel
  N.on = {};
  const emit = (ev, ...a) => { if (N.on[ev]) try { N.on[ev](...a); } catch (e) { log(ev + ' handler: ' + e); } };
  const status = (s, cls) => { N.state = s; emit('status', s, cls || ''); log(s); };
  N.active = () => !!S.role && !S.left;
  N.ready = () => S.ready;
  N.role = () => S.role;

  // ---- the peer connection
  function newPeer() {
    if (S.pc) try { S.pc.close(); } catch (e) { /* closed */ }
    const pc = S.pc = new RTCPeerConnection({ iceServers: STUN });
    S.dc[0] = pc.createDataChannel('frame', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    S.dc[1] = pc.createDataChannel('bulk', { negotiated: true, id: 2 });
    for (const ch of [0, 1]) {
      const dc = S.dc[ch];
      dc.binaryType = 'arraybuffer';
      dc.onopen = () => { if (S.dc[0].readyState === 'open' && S.dc[1].readyState === 'open') opened(); };
      dc.onclose = () => { if (S.pc === pc) partnerLeft('the connection closed'); };
      dc.onmessage = (e) => {
        S.heardAt = performance.now();
        if (typeof e.data === 'string') return onCtl(e.data);
        N.stats.recv[ch]++;
        if (S.ready) S.queues[ch].push(new Uint8Array(e.data));
      };
    }
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      log('ICE ' + s);
      if (s === 'failed' && S.pc === pc) partnerLeft(S.ready ? 'the network path failed' : 'no direct connection (both networks block it; there is no relay server)');
    };
    return pc;
  }
  function gathered(pc, ms = 8000) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, ms);   // use what was gathered so far
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  async function makeOffer() {
    const pc = newPeer();
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return pc.localDescription.sdp;
  }
  async function takeOffer(sdp) {
    const pc = newPeer();
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return pc.localDescription.sdp;
  }
  async function takeAnswer(sdp) {
    if (!S.pc || S.pc.signalingState !== 'have-local-offer') throw new Error('no open invitation (make a new code)');
    await S.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  function opened() {
    if (S.helloSent) return;
    S.helloSent = true;
    status('connected: checking the other player\'s game…');
    ctl({ t: 'hello', v: 1, build: N.buildId, rom: N.romSha1, edition: EDITION, role: S.role, fresh: FRESH_FRAMES_ONLINE });
    if (S.peerHello) checkHello();
    S.heardAt = performance.now();
    S.pingTimer = setInterval(() => { ctl({ t: 'ping', at: performance.now() }); watchdog(); }, 2000);
  }
  function checkHello() {
    const h = S.peerHello;
    let why = '';
    if (h.rom !== N.romSha1) why = 'the other player\'s ROM is not Golden Sun (USA, Europe)';
    else if (h.edition !== EDITION) why = `the other player runs another language edition (${h.edition}); the Battle Arena only links the same edition`;
    else if (h.build !== N.buildId) why = 'the other player runs another version of this page: both reload the page, then try again';
    else if (h.role === S.role) why = 'both pages think they are the ' + S.role;
    if (why) {
      ctl({ t: 'refuse', why: 'refused by the other player: ' + why.replace('the other player', 'your partner') });
      refuse(why);
      return;
    }
    S.ready = true;
    N.clearNote();
    if (N.module && N.module._Port_LinkSetFreshFrames) N.module._Port_LinkSetFreshFrames(FRESH_FRAMES_ONLINE);
    if (S.room && !S.room.guest) roomStop(true);
    status(`linked as player ${S.role === 'host' ? '1 (host)' : '2 (guest)'}: go to the Battle Arena (File Screen > Battle)`, 'ok');
    emit('ready');
    if (document.hidden) N.background(true);
  }
  function refuse(why) {
    S.ready = false; S.left = true;
    status('link refused: ' + why, 'bad');
    setTimeout(() => { try { S.pc.close(); } catch (e) { /* closed */ } }, 300);
  }
  function partnerLeft(why) {
    if (S.left) return;
    const was = S.ready;
    S.ready = false; S.left = true;
    clearInterval(S.pingTimer);
    // the game sees no link at once: a battle ends with "The link was disconnected." and the Battle Arena lobby
    if (was) {
      status(`partner left (${why}). A battle in progress ends ("The link was disconnected.") and you are back in the Battle Arena lobby. Host or Join to link again, or Return to title.`, 'bad');
      note('Link partner left. Menu: Link battle online');
    } else status('could not connect: ' + why, 'bad');
    emit('left');
  }
  // a short notice in the page's status line (shown over the bottom edge while the touch pad is up); tap clears it
  function note(s) { const el = document.getElementById('status'); if (el) { el.textContent = s; el.dataset.net = s ? '1' : ''; } }
  N.clearNote = () => { const el = document.getElementById('status'); if (el && el.dataset.net) { el.textContent = ''; el.dataset.net = ''; } };
  // GS10: a partner whose tab was closed (or whose network went away) may never close the channels: the frames stop.
  // Silent 4 s -> the status says so (the game holds the link 15 s, FRESH_FRAMES_ONLINE); silent 20 s -> the session is
  // over (partner left), past the game's own window, so a drop the game can still resume is never cut short here.
  const SILENT_SAY_MS = 4000, SILENT_END_MS = 20000;
  function watchdog() {
    if (!S.ready) return;
    const quiet = performance.now() - (S.heardAt || 0);
    if (quiet > SILENT_END_MS) partnerLeft(`no answer for ${Math.round(quiet / 1000)} s: tab closed or network lost`);
    else if (quiet > SILENT_SAY_MS) { S.quiet = true; status(`partner not responding for ${Math.round(quiet / 1000)} s (the game waits up to 15 s, then ends a battle)…`, 'bad'); }
    else if (S.quiet) { S.quiet = false; status(`linked as player ${S.role === 'host' ? '1 (host)' : '2 (guest)'}: the partner answers again`, 'ok'); }
  }
  // closing or reloading the tab: tell the partner at once (where the browser still lets us send)
  addEventListener('pagehide', () => { if (S.ready && S.dc[1] && S.dc[1].readyState === 'open') try { S.dc[1].send(JSON.stringify({ t: 'bye' })); } catch (e) { /* closing */ } });
  function onCtl(text) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    switch (m.t) {
      case 'hello': S.peerHello = m; if (S.helloSent) checkHello(); break;
      case 'refuse': if (!S.left) refuse(m.why || 'refused'); break;
      case 'bye': partnerLeft('they left'); break;
      case 'ping': ctl({ t: 'pong', at: m.at }); break;
      case 'pong': N.stats.rtt = Math.round(performance.now() - m.at); emit('rtt', N.stats.rtt); break;
      case 'hash': S.peerHashes.set(m.key, m); compareHash(m.key); break;
    }
  }

  // ---- per-turn hash (desync guard). Turn boundary = a change of gBattleRandomSeed (the parent sends each turn's seed,
  // both adopt it), the checkpoint tests/link2.cjs uses. Each side hashes its own party unit and the enemy unit (the
  // partner's, mirrored); names (the "Enemy" prefix) and the side byte are left out. Mine.own must equal theirs.enemy.
  const A_SEED = 0x020023a8, A_ENEMY = 0x03001f28, A_PARTY = 0x02000240 + 0x2c0;
  function unitHash(H, a) { let h = 0x811c9dc5; for (let k = 15; k < 332; k++) if (k !== 0x12a) h = Math.imul(h ^ H[a + k], 0x01000193); return (h >>> 0).toString(16).padStart(8, '0'); }
  const u32 = (H, a) => (H[a] | H[a + 1] << 8 | H[a + 2] << 16 | H[a + 3] << 24) >>> 0;
  N.onFrame = function (m) {
    if (simQ.length) simPump();
    if (!S.ready) return;
    const H = m.HEAPU8, eu = u32(H, A_ENEMY);
    if (!eu || eu < 0x02000000 || eu >= 0x03008000) { S.inBattle = false; return; }
    if (!S.inBattle) { S.inBattle = true; S.battle++; S.turn = 0; S.lastSeed = 0; }
    const seed = u32(H, A_SEED);
    if (seed === S.lastSeed) return;
    S.lastSeed = seed;
    const key = `${S.battle}.${++S.turn}`;
    const mine = { t: 'hash', key, seed, own: unitHash(H, A_PARTY), enemy: unitHash(H, eu) };
    S.myHashes.set(key, mine);
    N.last = { key, hp: [H[A_PARTY + 0x38] | H[A_PARTY + 0x39] << 8, H[eu + 0x38] | H[eu + 0x39] << 8] };   // tests
    ctl(mine);
    compareHash(key);
  };
  function compareHash(key) {
    const a = S.myHashes.get(key), b = S.peerHashes.get(key);
    if (!a || !b) return;
    S.myHashes.delete(key); S.peerHashes.delete(key);
    if (a.seed === b.seed && a.own === b.enemy && a.enemy === b.own) { N.stats.hashOk++; return; }
    N.stats.hashBad++;
    const msg = `DESYNC at battle.turn ${key}: mine seed ${a.seed.toString(16)} units ${a.own}/${a.enemy}, partner seed ${b.seed.toString(16)} units ${b.own}/${b.enemy}`;
    console.log('[net] ' + msg);
    if (!N.stats.firstBad) { N.stats.firstBad = msg; emit('desync', msg); }
  }

  // ---- copy-paste codes
  async function packCode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    let s = ''; for (let i = 0; i < z.length; i += 32768) s += String.fromCharCode.apply(null, z.subarray(i, i + 32768));
    return CODE_TAG + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function unpackCode(code) {
    code = String(code).replace(/\s+/g, '');
    if (!code.startsWith(CODE_TAG)) throw new Error('not a connection code (it starts with ' + CODE_TAG + ')');
    const b = atob(code.slice(CODE_TAG.length).replace(/-/g, '+').replace(/_/g, '/'));
    const z = Uint8Array.from(b, (c) => c.charCodeAt(0));
    const raw = await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(raw));
  }
  const fresh = () => {
    if (S.role && !S.left) throw new Error(S.role === 'host' && S.room && !S.ready ? `you are already hosting room ${S.room.code}: give that code to the other player, or Leave first` : 'already in a link session (Leave first)');
    if (S.pc) { const pc = S.pc; S.pc = null; try { pc.close(); } catch (e) { /* closed */ } }   // the ended session's connection
    reset();
  };
  function reset() {
    S.role = null; S.helloSent = false; S.peerHello = null; S.ready = false; S.left = false; S.queues = [[], []];
    S.myHashes.clear(); S.peerHashes.clear(); S.inBattle = false; S.room = null; S.battle = 0; S.quiet = false;   // hash keys count battles per session
  }
  N.manualHost = async function () {   // host: the offer code
    fresh(); S.role = 'host';
    status('making the connection code…');
    const code = await packCode({ t: 'o', sdp: await makeOffer() });
    status('send this code to the other player, then paste their answer code', 'ok');
    return code;
  };
  N.manualJoin = async function (code) {   // guest: the host's offer code -> the answer code
    const o = await unpackCode(code);
    if (o.t !== 'o') throw new Error('this is not an offer code (paste the code the host made)');
    fresh(); S.role = 'guest';
    status('gathering network addresses…');
    const a = await packCode({ t: 'a', sdp: await takeOffer(o.sdp) });
    status('send this answer code to the host, then wait', 'ok');
    return a;
  };
  N.manualAccept = async function (code) {   // host: the guest's answer code
    const a = await unpackCode(code);
    if (a.t !== 'a') throw new Error('this is not an answer code (paste the code the other player sent back)');
    await takeAnswer(a.sdp);
    status('connecting…');
  };

  // ---- rooms (POST N.roomApi)
  const ROOM_POLL_MS = 1000, ROOM_GUEST_WAIT_MS = 120000;
  async function roomCall(body) {
    let r, j = null;
    try { r = await fetch(N.roomApi, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }); }
    catch (e) { throw new Error('the room server cannot be reached (check the connection, or use the manual codes)'); }
    try { j = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok || !j || j.error) { const e = new Error((j && j.error) || `room server error ${r.status} (try the manual codes)`); e.code = j && j.code; throw e; }
    return j;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function roomStop(close) {
    const R = S.room; if (!R || R.closed) return;
    R.closed = true; if (R.timer) clearInterval(R.timer);
    if (close && R.secret) roomCall({ op: 'close', code: R.code, secret: R.secret }).then(() => log(`room ${R.code} closed`), (e) => log('room close: ' + e.message));
  }
  N.roomCreate = async function () {
    fresh();
    const j = await roomCall({ op: 'create', build: N.buildId, rom: N.romSha1, max: 2 });
    S.role = 'host';
    const R = S.room = { code: j.code, secret: j.secret, gen: 0, accepted: false, fails: 0 };
    status(`room ${j.code} is open: tell the other player this code (they press Join, not Host)`, 'ok');
    R.timer = setInterval(roomHostPoll, ROOM_POLL_MS); roomHostPoll();
    return j.code;
  };
  async function roomHostPoll() {
    const R = S.room; if (!R || R.closed || R.busy) return;
    if (S.ready) return roomStop(true);
    R.busy = true;
    try {
      const j = await roomCall({ op: 'host', code: R.code, secret: R.secret });
      const s = j.slots[0];
      if (s && !R.closed) {
        if (R.gen !== s.gen) {   // a guest joined: make its offer (ICE gathering)
          R.gen = s.gen; R.accepted = false;
          status('the other player joined: making the connection offer…');
          const sdp = await makeOffer();
          await roomCall({ op: 'offer', code: R.code, secret: R.secret, ch: 1, gen: s.gen, sdp });
          status(`room ${R.code}: waiting for the other player's answer…`, 'ok');
        } else if (s.answer && !R.accepted) {
          R.accepted = true;
          await takeAnswer(s.answer);
          status('connecting…');
        }
      }
      R.fails = 0;
    } catch (e) {
      if (e.code === 'unknown') { roomStop(false); S.left = true; status(`room ${R.code} has expired (rooms last 10 minutes): press Host again for a new room`, 'bad'); emit('left'); }
      else if (e.code === 'gone') log('room: ' + e.message);
      else if (++R.fails === 5) status('room server: ' + e.message, 'bad');
      else log('room poll: ' + e.message);
    } finally { R.busy = false; }
  }
  // the room server's refusals in the player's words (codes from port/netlify/functions/room/core.mjs)
  function roomError(e, code) {
    if (e.code === 'full') return new Error(`${e.message} Ask the host to make a new room (Leave, then Host).`);
    return e;
  }
  // a failed join ends the attempt (no half-open session: Host and Join work again at once)
  N.roomJoin = async function (code) {
    try { return await roomJoin(code); }
    catch (e) { if (!S.ready && S.role === 'guest') { if (S.room) S.room.closed = true; S.left = true; } throw e; }
  };
  async function roomJoin(code) {
    fresh();
    code = String(code || '').toUpperCase().replace(/[\s-]+/g, '');
    if (!code) throw new Error('type the room code the host gave you');
    status(`joining room ${code}…`);
    let j;
    try { j = await roomCall({ op: 'join', code, build: N.buildId, rom: N.romSha1 }); }
    catch (e) { S.room = null; throw roomError(e, code); }
    S.role = 'guest';
    const R = S.room = { code, token: j.token, guest: true };
    status(`in room ${code}: waiting for the host…`, 'ok');
    let offer = null;
    for (const t0 = Date.now(); !offer; await sleep(ROOM_POLL_MS)) {
      if (R.closed) throw new Error('left the room');
      if (Date.now() - t0 > ROOM_GUEST_WAIT_MS) throw new Error('the host did not answer (is the host page still open?)');
      try { offer = (await roomCall({ op: 'guest', code, ch: 1, token: j.token })).offer; }
      catch (e) { if (['unknown', 'token'].includes(e.code)) throw e; log('room poll: ' + e.message); }
    }
    status('gathering network addresses…');
    const sdp = await takeOffer(offer);
    await roomCall({ op: 'answer', code, ch: 1, token: j.token, sdp });
    R.closed = true;
    status('connecting to the host…', 'ok');
  }
  N.leave = function () {
    if (S.room && !S.room.guest) roomStop(true); else if (S.room) S.room.closed = true;
    if (S.dc[1] && S.dc[1].readyState === 'open') try { S.dc[1].send(JSON.stringify({ t: 'bye' })); } catch (e) { /* closed */ }
    const pc = S.pc; S.pc = null;
    clearInterval(S.pingTimer);
    setTimeout(() => { try { pc && pc.close(); } catch (e) { /* closed */ } }, 150);
    reset();
    N.background(false);
    status('left the link session');
    emit('left');
  };

  // ---- a hidden page: rAF stops and timers drop to ~1 Hz, the partner would see a link loss after the fresh window.
  // While hidden (and in a session) a Worker posts a message every 4 ms (worker timers are not throttled); main.js's
  // frame wait runs from those ticks (as the GoldenEye port does).
  let ticker = null;
  N.tickers = [];
  N.background = function (hidden) {
    if (hidden && N.active() && !ticker) {
      ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 4);'], { type: 'text/javascript' })));
      ticker.onmessage = () => { for (const f of N.tickers) f(); };
      log('page hidden: the game keeps running from a worker timer');
    } else if (!hidden && ticker) { ticker.terminate(); ticker = null; log('page visible again'); }
  };
  document.addEventListener('visibilitychange', () => N.background(document.hidden));

  // ---- the panel (index.html #net): Host / Join / status / Leave, manual codes
  const $ = (id) => document.getElementById(id);
  function panel() {
    const box = $('net'); if (!box) return;
    const st = $('net-status'), err = (e) => { status(e.message || String(e), 'bad'); busy(N.active()); };   // a refused second Host keeps the first room
    const busy = (b) => { for (const id of ['net-host', 'net-join']) $(id).disabled = b; $('net-leave').hidden = !b; };
    N.on.status = (s, cls) => { st.textContent = s; st.className = cls; };
    N.on.left = () => { busy(false); $('net-leave').hidden = !S.left; $('net-rtt').textContent = ''; };
    N.on.rtt = (ms) => { $('net-rtt').textContent = S.ready ? `round trip ${ms} ms` : ''; };
    N.on.desync = (msg) => { const w = $('net-warn'); w.hidden = false; w.textContent = 'Warning: the two games differ (' + msg + '). The battle may end differently on each screen.'; };
    $('net-host').onclick = async () => {
      busy(true);
      try { const code = await N.roomCreate(); $('net-code-show').textContent = code; $('net-code-show').hidden = false; } catch (e) { err(e); }
    };
    $('net-join').onclick = async () => { busy(true); try { await N.roomJoin($('net-code').value); } catch (e) { err(e); } };
    $('net-leave').onclick = () => { N.leave(); busy(false); $('net-code-show').hidden = true; $('net-leave').hidden = true; };
    $('net-m-host').onclick = async () => { busy(true); try { $('net-m-out').value = await N.manualHost(); } catch (e) { err(e); } };
    $('net-m-join').onclick = async () => { busy(true); try { $('net-m-out').value = await N.manualJoin($('net-m-in').value); } catch (e) { err(e); } };
    $('net-m-accept').onclick = async () => { try { await N.manualAccept($('net-m-in').value); } catch (e) { err(e); } };
    $('net-m-copy').onclick = () => { $('net-m-out').select(); try { navigator.clipboard.writeText($('net-m-out').value); } catch (e) { /* select is enough */ } };
    // GS-deploy offline play: with no network the room server cannot be reached; say so plainly and disable
    // Host/Join (the game and the manual codes, which need no server, still work)
    const net = () => {
      const off = navigator.onLine === false;
      $('net-offline').hidden = !off;
      if (!N.active()) for (const id of ['net-host', 'net-join']) $(id).disabled = off;
    };
    addEventListener('online', net); addEventListener('offline', net); net();
    box.hidden = false;
  }
  N.enable = function (romSha1) { N.romSha1 = romSha1; panel(); };
  N.romSha1 = ROM_SHA1;
})();
