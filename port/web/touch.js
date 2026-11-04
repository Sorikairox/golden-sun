// Golden Sun web port: on-screen touch controls (orchestrator rule 11; design from the GoldenEye / Conker ports).
//
// A GBA pad for phones and tablets: an 8-way D-pad (one zone: the finger may slide between directions, diagonals
// included), A, B, L, R, Start, Select, plus a page-menu button. Every control follows its own finger (pointer events +
// pointer capture), so a direction and buttons work together. The pad's bits are GBA KEYINPUT bits; main.js ORs
// GSTouch.keys() into the same key state the keyboard feeds (one Port_SetKeys per frame), so the game sees one input.
//
// Layout (layout(), from the window size): upright (portrait) the 3:2 picture sits at the top at full width and the
// controls take the space below; turned (landscape) the picture is centred and the controls lie on both sides. Every
// resize / rotation re-runs the layout; a rotation, touchcancel, blur or hidden page releases every key (no stuck keys).
//
// Setting "Touch controls": Auto (default: on for touch devices) / On / Off. Only an explicit On / Off is stored
// (localStorage gs-touch, in try/catch); Auto stores nothing. Dev / test override: ?touch=1 / ?touch=0 (not stored).
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const K = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
  const LS = 'gs-touch';
  const Q = new URLSearchParams(location.search);
  const UA = navigator.userAgent;
  const IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const detected = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
    ((navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && (IOS || /Android|Mobi/i.test(UA)));
  const lsGet = () => { try { return localStorage.getItem(LS); } catch (e) { return null; } };
  const lsSet = (v) => { try { if (v) localStorage.setItem(LS, v); else localStorage.removeItem(LS); } catch (e) { /* private mode */ } };
  const setting = () => { const v = lsGet(); return v === 'on' || v === 'off' ? v : 'auto'; };
  const wanted = () => {
    if (Q.has('touch')) return Q.get('touch') !== '0';
    const s = setting(); return s === 'on' || (s === 'auto' && detected);
  };

  // phones: bigger tap targets; iOS greys out files whose extension it does not know (.gba), so no type filter there
  // (the ROM is checked by size + SHA-1 anyway)
  if (detected) {
    document.body.classList.add('touchdev');
    const f = $('file'); if (f) f.removeAttribute('accept');
  }

  const t = { on: false, playing: false, menu: false, btn: new Map(), dpad: new Map(), portrait: null };
  const tplay = () => t.on && t.playing && !t.menu;
  const bits = () => {
    let b = 0;
    for (const v of t.btn.values()) b |= v;
    for (const v of t.dpad.values()) b |= v;
    return b;
  };

  // ---- release / show -----------------------------------------------------------------------------
  function paint() {
    const b = tplay() ? bits() : 0;
    for (const el of document.querySelectorAll('#touch .tb[data-k]')) el.classList.toggle('on', !!(b & K[el.dataset.k]));
    const arms = { u: K.UP, d: K.DOWN, l: K.LEFT, r: K.RIGHT };
    for (const a in arms) $('tk-dpad').querySelector('.' + a).classList.toggle('on', !!(b & arms[a]));
  }
  function release() { t.btn.clear(); t.dpad.clear(); paint(); }
  function apply() {
    const show = tplay();
    $('touch').hidden = !show;
    $('tk-back').hidden = !(t.on && t.playing && t.menu);
    document.body.classList.toggle('tplay', show);
    document.body.classList.toggle('tmenu', t.on && t.playing && t.menu);
    if (!show) release();
    layout();
    const st = $('opt-touch-state');
    if (st) st.textContent = Q.has('touch') ? `(?touch=${Q.get('touch')} in the address)` :
      setting() === 'auto' ? (detected ? '(touch screen found: on)' : '(no touch screen found: off)') : '';
  }

  // ---- layout -------------------------------------------------------------------------------------
  function safe() {
    const cs = getComputedStyle($('tk-safe'));
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }
  function put(id, cx, cy, w, h = w) {
    const s = $(id).style;
    s.left = Math.round(cx - w / 2) + 'px'; s.top = Math.round(cy - h / 2) + 'px';
    s.width = Math.round(w) + 'px'; s.height = Math.round(h) + 'px';
  }
  function layout() {
    const cv = $('screen');
    if (!tplay()) { cv.style.left = cv.style.top = cv.style.width = cv.style.height = ''; return; }
    const W = innerWidth, H = innerHeight, sa = safe();
    if (W < 50 || H < 50) return;
    const portrait = H >= W;
    if (t.portrait !== null && t.portrait !== portrait) release();   // rotated mid-press: nothing stays held
    t.portrait = portrait;
    let pic;
    const ar = 1.5;   // GS29: the picture's box is always 3:2 (Map zoom frames are 3:2 too), so nothing moves
    if (portrait) {
      let w = W - sa.l - sa.r, h = w / ar;
      if (h > (H - sa.t) * 0.5) { h = (H - sa.t) * 0.5; w = h * ar; }
      pic = { x: (W - w) / 2, y: sa.t, w, h };
    } else {
      const side = Math.max(150, W * 0.2);   // room for a thumb's controls on each side
      let h = H - sa.t - sa.b, w = h * ar;
      if (w > W - 2 * side) { w = Math.max(W - 2 * side, W * 0.5); h = w / ar; }
      pic = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    }
    Object.assign(cv.style, { left: pic.x + 'px', top: pic.y + 'px', width: pic.w + 'px', height: pic.h + 'px' });
    const R = W - sa.r, B = H - sa.b, Lx = sa.l;
    if (portrait) {
      const A0 = pic.y + pic.h, area = B - A0;
      const k = Math.max(0.7, Math.min(1.5, W / 390, area / 400));
      put('tk-L', Lx + 52 * k, A0 + 30 * k, 88 * k, 38 * k);
      put('tk-R', R - 52 * k, A0 + 30 * k, 88 * k, 38 * k);
      put('tk-menu', W / 2, A0 + 30 * k, 44 * k);
      const cy = Math.min(A0 + Math.max(150 * k, area * 0.5), B - 180 * k);   // low enough for the thumbs
      put('tk-dpad', Lx + 100 * k, cy, 164 * k);
      put('tk-A', R - 50 * k, cy - 30 * k, 74 * k);
      put('tk-B', R - 134 * k, cy + 26 * k, 74 * k);
      const sy = Math.min(B - 30 * k, cy + 140 * k);
      put('tk-SELECT', W / 2 - 52 * k, sy, 84 * k, 34 * k);
      put('tk-START', W / 2 + 52 * k, sy, 84 * k, 34 * k);
    } else {
      const k = Math.max(0.65, Math.min(1.4, H / 390));
      const sideW = pic.x - Lx;
      const lx = Lx + Math.max(86 * k, sideW / 2), rx = R - Math.max(86 * k, sideW / 2);
      put('tk-L', Lx + 52 * k, sa.t + 28 * k, 88 * k, 38 * k);
      put('tk-R', R - 52 * k, sa.t + 28 * k, 88 * k, 38 * k);
      put('tk-menu', Lx + 26 * k, B - 26 * k, 40 * k);
      put('tk-dpad', lx, H / 2 + 14 * k, 160 * k);
      put('tk-A', rx + 40 * k, H / 2 - 10 * k, 70 * k);
      put('tk-B', rx - 40 * k, H / 2 + 44 * k, 70 * k);
      put('tk-SELECT', lx + 10 * k, B - 26 * k, 80 * k, 32 * k);
      put('tk-START', rx, B - 26 * k, 80 * k, 32 * k);
    }
  }

  // ---- controls -----------------------------------------------------------------------------------
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or gone */ } };
  const buzz = () => { if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) { /* not allowed */ } };
  for (const el of document.querySelectorAll('#touch .tb[data-k]')) {
    const bit = K[el.dataset.k];
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); capture(el, e);
      t.btn.set(e.pointerId, bit); paint(); buzz();
    });
    const up = (e) => { if (t.btn.delete(e.pointerId)) paint(); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
  }
  {
    // D-pad: the direction from the pad's centre, 8 sectors of 45 degrees, a small dead centre; the finger keeps
    // steering after it leaves the pad (pointer capture)
    const pad = $('tk-dpad');
    const SECT = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
    const dir = (e) => {
      const r = pad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.12) return 0;
      const a = Math.atan2(dy, dx);   // y grows downwards: +90 degrees = down
      return SECT[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); capture(pad, e);
      t.dpad.set(e.pointerId, dir(e)); paint(); buzz();
    });
    pad.addEventListener('pointermove', (e) => {
      if (!t.dpad.has(e.pointerId)) return;
      const d = dir(e);
      if (d !== t.dpad.get(e.pointerId)) { t.dpad.set(e.pointerId, d); paint(); }
    });
    const end = (e) => { if (t.dpad.delete(e.pointerId)) paint(); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, end);
  }
  // page menu: the normal page (setting, key list) with a "Back to the game" button; the pad is idle meanwhile
  $('tk-menu').addEventListener('pointerup', (e) => { e.preventDefault(); t.menu = true; apply(); scrollTo(0, 0); });
  const back = (e) => { e.preventDefault(); if (!t.menu) return; t.menu = false; apply(); };
  for (const ev of ['pointerup', 'click']) $('tk-back').addEventListener(ev, back);
  // GS-deploy: the menu opens on pointerup, so the tap's compatibility click landed on whatever option was now under
  // the finger (a taller menu put "GBA screen colours" there); cancelling touchend suppresses that click
  const noGhost = (e) => { if (e.cancelable) e.preventDefault(); };
  for (const id of ['tk-menu', 'tk-back']) $(id).addEventListener('touchend', noGhost, { passive: false });

  // ---- no zoom / scroll / callouts while playing ---------------------------------------------------
  const block = (e) => { if (tplay()) e.preventDefault(); };
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu']) document.addEventListener(ev, block, { passive: false });
  document.addEventListener('touchmove', block, { passive: false });
  let lastEnd = 0;   // iOS: a quick second tap zooms even with touch-action; swallow it on the picture
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    if (tplay() && now - lastEnd < 350 && e.cancelable && !e.target.closest('#touch')) e.preventDefault();
    lastEnd = now;
  }, { passive: false });

  // ---- no stuck keys ------------------------------------------------------------------------------
  document.addEventListener('touchcancel', release);
  addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  addEventListener('orientationchange', () => { release(); setTimeout(layout, 250); });
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', release);
  addEventListener('resize', layout);
  if (window.visualViewport) visualViewport.addEventListener('resize', layout);

  // ---- setting ------------------------------------------------------------------------------------
  const sel = $('opt-touch');
  sel.value = setting();
  sel.addEventListener('change', () => { lsSet(sel.value === 'auto' ? null : sel.value); t.on = wanted(); apply(); });

  window.GSTouch = {
    started() { t.playing = true; apply(); },              // main.js, when the game starts
    back() { if (t.menu) { t.menu = false; apply(); } },   // main.js: close the page menu (after "Return to title")
    keys: () => (tplay() ? bits() : 0),                     // main.js ORs this into the keyboard's key state
    state: () => ({ on: t.on, playing: t.playing, menu: t.menu, keys: tplay() ? bits() : 0, w: innerWidth, h: innerHeight }),
    layout,
  };
  t.on = wanted();
  apply();
})();
