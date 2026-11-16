// Night Watch — steer a boat down a dark river. A helicopter's spotlight shows the way.
// Thumb on the bottom pad steers the boat. Another finger flies the helicopter.
(() => {
  'use strict';

  // Logical game size. The canvas is scaled to fit the screen.
  const W = 360;
  const H = 640;

  // Layout
  const BOAT_Y = 400;        // the boat stays at this height; the river scrolls past it
  const PAD_TOP = 500;       // below this line is the steering pad
  const HELI_OFFSET = 70;    // the helicopter flies this far above your finger
  const STEP = 8;            // world px between river points

  // Difficulty per level
  const LEVEL_LENGTH = 1400;
  function levelParams(level) {
    const n = Math.min(level, 10) - 1;
    const up = save.upgrades;
    return {
      speed: 95 + n * 20,
      lightR: Math.max(60, 105 - n * 5) * (1 + 0.1 * up.spot),
      memory: Math.max(0.45, 1.8 - n * 0.16) * (1 + 0.2 * up.memory),
      ambient: Math.min(0.985, 0.9 + n * 0.012),
      lampR: 48 * (1 + 0.25 * up.lamp),
    };
  }
  const START_WIDTH = 160;
  const MIN_WIDTH = 60;
  const NARROW_RATE = 0.0085;
  const STEER_GAIN = 1.25;
  const LANTERN_EVERY = 360;
  const LANTERN_BONUS = 10;
  const ISLAND_MAX = 46;     // half-width of the island when the river splits
  const FIRST_FORK = 1100;   // world px before the first split

  // ---------- Shop catalogue ----------
  const UPGRADES = [
    { id: 'spot', name: 'Bigger spotlight', desc: '+10% light size', costs: [30, 60, 120] },
    { id: 'memory', name: 'Sharper memory', desc: 'lit spots fade 20% slower', costs: [25, 50, 100] },
    { id: 'lamp', name: 'Brighter boat lamp', desc: '+25% light around the boat', costs: [20, 40, 80] },
  ];
  const JACKET = { name: 'Life jacket', desc: 'saves you from one crash', cost: 40, max: 3 };
  const BOATS = [
    { id: 'wood', name: 'Rowboat', cost: 0, hull: '#8a5a33', deck: '#b07a46', seat: '#6e4626' },
    { id: 'red', name: 'Red runner', cost: 60, hull: '#9e2f2a', deck: '#e8e2d6', seat: '#b8463e' },
    { id: 'canoe', name: 'Forest canoe', cost: 90, hull: '#2f6b4a', deck: '#58a276', seat: '#245338' },
    { id: 'navy', name: 'Patrol boat', cost: 140, hull: '#2c3e66', deck: '#6f8cc0', seat: '#22314f' },
    { id: 'gold', name: 'Golden boat', cost: 250, hull: '#a9801f', deck: '#f2cf5f', seat: '#8a6614' },
  ];

  // ---------- Save data (this device) ----------
  const SAVE_KEY = 'nightwatch.save.v1';
  const save = loadSave();
  function loadSave() {
    const base = {
      coins: 0, best: 0, bestLevel: 1, runs: 0, lanternsTotal: 0,
      upgrades: { spot: 0, memory: 0, lamp: 0 }, jackets: 0,
      boats: ['wood'], boat: 'wood', top: [],
    };
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && typeof s === 'object') {
        return { ...base, ...s, upgrades: { ...base.upgrades, ...(s.upgrades || {}) } };
      }
    } catch { /* ignore */ }
    return base;
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ }
  }

  // ---------- Online leaderboard (only on the web version, when signed in) ----------
  const online = { db: null, user: null, myId: null, rows: null, status: 'off', names: {} };
  (async function connect(tries = 0) {
    try {
      if (!window.claude || !window.claude.use) {
        if (tries < 3) setTimeout(() => connect(tries + 1), 1000); // the web viewer may attach a moment later
        return;
      }
      online.status = 'connecting';
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db) { online.status = 'off'; return; }
      online.db = db;
      online.user = user;
      online.myId = user ? await user.id() : null;
      online.status = 'ready';
    } catch { online.status = 'off'; }
  })();

  async function loadLeaderboard() {
    if (!online.db) return;
    online.rows = null;
    online.status = 'loading';
    const timer = setTimeout(() => { if (online.status === 'loading') online.status = 'timeout'; }, 10000);
    try {
      const snap = await online.db.collection('scores').orderBy('score', 'desc').limit(20).get();
      clearTimeout(timer);
      online.rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      online.status = 'ready';
      if (online.user && online.rows.length) {
        const ps = await online.user.profiles(online.rows.map((r) => r.id));
        for (const r of online.rows) online.names[r.id] = (ps[r.id] && ps[r.id].name) || '';
      }
    } catch {
      clearTimeout(timer);
      online.status = 'error';
    }
  }

  async function submitOnline(score, level) {
    if (!online.db || !online.myId) return;
    try {
      const ref = online.db.collection('scores').doc(online.myId);
      const cur = await ref.get();
      const prev = cur.exists ? (cur.data().score || 0) : 0;
      if (score > prev) await ref.set({ score, level, boat: save.boat, at: Date.now() });
    } catch { /* not allowed to write, or offline: keep the local score only */ }
  }

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas');
  const dctx = dark.getContext('2d');
  let scale = 1, dpr = 1;
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
    canvas.width = dark.width = Math.floor(W * scale * dpr);
    canvas.height = dark.height = Math.floor(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    dctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Sound ----------
  let audio = null;
  function beep(freq, dur, type = 'sine', vol = 0.08, slideTo = null) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const t = audio.currentTime;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur);
    } catch { /* audio not available */ }
  }
  const sfx = {
    start: () => { beep(440, 0.12, 'triangle', 0.06); setTimeout(() => beep(660, 0.15, 'triangle', 0.06), 90); },
    click: () => beep(1400, 0.03, 'square', 0.03),
    buy: () => { beep(660, 0.08, 'triangle', 0.06); setTimeout(() => beep(990, 0.12, 'triangle', 0.06), 70); },
    nope: () => beep(140, 0.15, 'square', 0.04),
    lantern: () => { beep(1046, 0.07, 'sine', 0.06); setTimeout(() => beep(1568, 0.12, 'sine', 0.05), 60); },
    level: () => { beep(392, 0.15, 'triangle', 0.06); setTimeout(() => beep(311, 0.3, 'triangle', 0.06), 150); },
    over: () => beep(160, 0.6, 'sawtooth', 0.08, 40),
    saved: () => { beep(523, 0.1, 'triangle', 0.07); setTimeout(() => beep(784, 0.18, 'triangle', 0.07), 100); },
    warn: () => beep(180, 0.05, 'square', 0.03),
  };
  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
  }

  // ---------- World: river, islands, banks ----------
  // World coordinate w grows upward. A point at w is drawn at screen y = BOAT_Y - (w - distance).
  const river = { pts: [], targetX: W / 2, x: W / 2, fork: null, nextForkW: FIRST_FORK, pendingFork: false };
  let scenery = [], ripples = [], reeds = [], blockers = [];

  function resetWorld() {
    Object.assign(river, { pts: [], targetX: W / 2, x: W / 2, fork: null, nextForkW: FIRST_FORK, pendingFork: false });
    scenery = []; ripples = []; reeds = []; blockers = [];
  }

  const ease = (t) => t * t * (3 - 2 * t);

  function extendRiver(toW) {
    while (river.pts.length * STEP < toW) {
      const w = river.pts.length * STEP;
      const base = Math.max(MIN_WIDTH, START_WIDTH - w * NARROW_RATE);
      let width = base, island = 0;

      // Start a split when one is due and the river is near the middle
      if (!river.fork && w >= river.nextForkW) {
        river.targetX = W / 2;
        if (Math.abs(river.x - W / 2) < 8) {
          const len = 600 + Math.random() * 260;
          const r = Math.random();
          const blocked = r < 0.7 ? (Math.random() < 0.5 ? -1 : 1) : 0;
          river.fork = { start: w, len, blocked };
          if (blocked) blockers.push({ w: w + len * 0.5, side: blocked, seed: Math.random() * 10 });
        }
      }

      if (river.fork) {
        const t = (w - river.fork.start) / river.fork.len;
        if (t >= 1) {
          river.fork = null;
          river.nextForkW = w + 900 + Math.random() * 1100;
        } else {
          const b = t < 0.25 ? ease(t / 0.25) : t > 0.75 ? ease((1 - t) / 0.25) : 1;
          const channel = Math.max(52, base * 0.62);
          island = b * ISLAND_MAX;
          width = base + (2 * channel + 2 * ISLAND_MAX - base) * b;
          river.targetX = W / 2;
        }
      }

      const margin = width / 2 + 20;
      if (w < 300) {
        river.x = river.targetX = W / 2;
      } else {
        if (!river.fork && w < river.nextForkW && Math.abs(river.targetX - river.x) < 4) {
          river.targetX = margin + Math.random() * (W - margin * 2);
        }
        const maxSlope = Math.min(5, 1.5 + w / 3000);
        const dx = Math.max(-maxSlope, Math.min(maxSlope, (river.targetX - river.x) * 0.055));
        river.x = Math.max(margin, Math.min(W - margin, river.x + dx));
      }
      river.pts.push({ x: river.x, width, island });

      if (river.pts.length % 3 === 0) {
        for (const side of [-1, 1]) {
          if (Math.random() < 0.55) {
            const x = river.x + side * (width / 2 + 16 + Math.random() * 120);
            if (x > -30 && x < W + 30) {
              const r = Math.random();
              scenery.push({
                w, x,
                kind: r < 0.55 ? 'tree' : r < 0.85 ? 'bush' : 'rock',
                size: r < 0.55 ? 18 + Math.random() * 16 : 7 + Math.random() * 8,
                hue: 95 + Math.random() * 40,
                seed: Math.random() * 10,
              });
            }
          }
          if (Math.random() < 0.5) reeds.push({ w, side, seed: Math.random() * 10 });
        }
        // Trees on the island
        if (island > 34 && Math.random() < 0.6) {
          scenery.push({ w, x: river.x + (Math.random() - 0.5) * (island - 20), kind: Math.random() < 0.7 ? 'tree' : 'bush',
            size: 12 + Math.random() * 10, hue: 95 + Math.random() * 40, seed: Math.random() * 10 });
        }
      }
      if (Math.random() < 0.3) {
        ripples.push({ w, dx: (Math.random() - 0.5) * 0.8, len: 6 + Math.random() * 10, phase: Math.random() * 6 });
      }
    }
  }

  function riverAt(w) {
    if (w < 0) return { x: W / 2, width: START_WIDTH, island: 0 };
    extendRiver(w + STEP * 2);
    const i = Math.floor(w / STEP);
    const t = (w - i * STEP) / STEP;
    const a = river.pts[i], b = river.pts[i + 1];
    return { x: a.x + (b.x - a.x) * t, width: a.width + (b.width - a.width) * t, island: a.island + (b.island - a.island) * t };
  }
  function pointIndex(w) {
    extendRiver(Math.max(0, w) + STEP * 2);
    return Math.max(0, Math.round(w / STEP));
  }
  // Centre of the left (-1) or right (1) channel at w, or of the river if it isn't split
  function channelCenter(w, side) {
    const p = riverAt(w);
    if (p.island < 2) return p.x;
    return p.x + side * (p.island + (p.width / 2 - p.island) / 2);
  }

  const toScreenY = (w) => BOAT_Y - (w - state.distance);
  const toWorld = (y) => state.distance + (BOAT_Y - y);

  // ---------- Game state ----------
  const state = {
    screen: 'menu', // 'menu' | 'how' | 'shop' | 'scores' | 'play' | 'over'
    scoresTab: 'device',
    distance: 0, speed: 95, level: 1, params: null,
    bonus: 0, lanterns: 0, newBest: false, coinsEarned: 0, jacketsUsed: 0,
    boatX: W / 2, boatTilt: 0, invuln: 0,
    steerId: null, steerLastX: 0,
    lightId: null, finger: null,
    heli: { x: W / 2 + 60, y: 120 },
    marks: [], foam: [], lanternsList: [], nextLanternW: LANTERN_EVERY, popups: [],
    edge: 0, warnTimer: 0, banner: null, reason: '',
    time: 0, overAt: 0, shake: 0, playTime: 0,
    toast: null,
  };
  state.params = levelParams(1);
  window.__nightWatch = { state, riverAt, save, channelCenter, get blockers() { return blockers; } }; // handy for debugging in the browser console

  const score = () => Math.floor(state.distance / 10) + state.bonus;
  const playing = () => state.screen === 'play';

  function startGame() {
    resetWorld();
    const p = levelParams(1);
    Object.assign(state, {
      screen: 'play', distance: 0, level: 1, params: p, speed: p.speed,
      bonus: 0, lanterns: 0, newBest: false, coinsEarned: 0, jacketsUsed: 0,
      boatX: W / 2, boatTilt: 0, invuln: 0, marks: [], foam: [],
      lanternsList: [], nextLanternW: LANTERN_EVERY, popups: [], edge: 0, reason: '', playTime: 0,
      banner: { text: 'Level 1', sub: 'Light the river ahead', age: 0 },
    });
    sfx.start();
    vibrate(30);
  }

  function crash(reason) {
    if (!playing() || state.invuln > 0) return;
    if (save.jackets > 0) {
      // Life jacket: put the boat back in the middle of an open channel
      save.jackets--;
      state.jacketsUsed++;
      persist();
      const w = state.distance;
      let side = state.boatX < riverAt(w).x ? -1 : 1;
      if (blockers.some((b) => b.side === side && b.w > w - 20 && b.w < w + 260)) side = -side;
      state.boatX = channelCenter(w, side);
      state.boatTilt = 0;
      state.invuln = 2;
      state.shake = 8;
      state.banner = { text: 'Life jacket used!', sub: save.jackets ? `${save.jackets} left` : 'That was your last one', age: 0 };
      sfx.saved();
      vibrate([60, 40, 60]);
      return;
    }
    state.screen = 'over';
    state.reason = reason;
    state.overAt = state.time;
    state.shake = 12;
    sfx.over();
    vibrate([100, 60, 140]);

    const s = score();
    state.coinsEarned = state.lanterns + Math.floor(s / 50);
    save.coins += state.coinsEarned;
    save.runs++;
    save.lanternsTotal += state.lanterns;
    save.bestLevel = Math.max(save.bestLevel, state.level);
    if (s > save.best) { save.best = s; state.newBest = true; }
    save.top.push({ score: s, level: state.level, at: Date.now() });
    save.top.sort((a, b) => b.score - a.score);
    save.top = save.top.slice(0, 10);
    persist();
    submitOnline(s, state.level);
  }

  // ---------- Buttons (menus are drawn on the canvas) ----------
  let buttons = [];
  function button(x, y, w, h, label, onTap, opts = {}) {
    buttons.push({ x, y, w, h, onTap, disabled: opts.disabled });
    const primary = opts.primary;
    ctx.save();
    ctx.fillStyle = opts.disabled ? 'rgba(60,70,80,0.6)' : primary ? '#f2c45a' : 'rgba(18,34,48,0.92)';
    ctx.strokeStyle = opts.disabled ? 'rgba(120,130,140,0.4)' : primary ? '#ffe39a' : 'rgba(150,205,235,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 12); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.font = `${opts.weight || 800} ${opts.size || 18}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.disabled ? '#9aa3ab' : primary ? '#2a1d05' : '#e6f1f8';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }

  function go(screen) {
    state.screen = screen;
    sfx.click();
    if (screen === 'scores' && state.scoresTab === 'everyone') loadLeaderboard();
  }

  function toast(msg) { state.toast = { msg, age: 0 }; }

  function buyUpgrade(u) {
    const lvl = save.upgrades[u.id];
    if (lvl >= u.costs.length) return;
    const cost = u.costs[lvl];
    if (save.coins < cost) { sfx.nope(); toast(`You need ${cost - save.coins} more coins`); return; }
    save.coins -= cost;
    save.upgrades[u.id]++;
    persist(); sfx.buy(); vibrate(20);
  }
  function buyJacket() {
    if (save.jackets >= JACKET.max) { sfx.nope(); toast(`You can carry ${JACKET.max} at most`); return; }
    if (save.coins < JACKET.cost) { sfx.nope(); toast(`You need ${JACKET.cost - save.coins} more coins`); return; }
    save.coins -= JACKET.cost;
    save.jackets++;
    persist(); sfx.buy(); vibrate(20);
  }
  function tapBoat(b) {
    if (save.boats.includes(b.id)) { save.boat = b.id; persist(); sfx.click(); return; }
    if (save.coins < b.cost) { sfx.nope(); toast(`You need ${b.cost - save.coins} more coins`); return; }
    save.coins -= b.cost;
    save.boats.push(b.id);
    save.boat = b.id;
    persist(); sfx.buy(); vibrate(20);
  }

  // ---------- Input ----------
  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function onDown(e) {
    e.preventDefault();
    const p = toGame(e);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    if (!playing()) {
      if (state.screen === 'over' && state.time - state.overAt < 0.6) return;
      for (const b of buttons) {
        if (!b.disabled && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { b.onTap(); break; }
      }
      // A fresh run starts in the same tap: let that finger steer or light right away
      if (!playing()) return;
    }

    const isSteer = !hasTouch || e.pointerType === 'mouse' || p.y >= PAD_TOP;
    if (isSteer && state.steerId === null) {
      state.steerId = e.pointerId;
      state.steerLastX = p.x;
    } else if (!isSteer && state.lightId === null) {
      state.lightId = e.pointerId;
      state.finger = p;
      sfx.click();
    }
  }

  function onMove(e) {
    const p = toGame(e);
    if (e.pointerId === state.steerId) {
      if (playing()) {
        const dx = (p.x - state.steerLastX) * STEER_GAIN;
        state.boatX = Math.max(8, Math.min(W - 8, state.boatX + dx));
        state.boatTilt = Math.max(-0.5, Math.min(0.5, state.boatTilt + dx * 0.02));
      }
      state.steerLastX = p.x;
    } else if (e.pointerId === state.lightId) {
      state.finger = p;
    }
  }

  function onUp(e) {
    if (e.pointerId === state.steerId) state.steerId = null; // the boat keeps going straight
    if (e.pointerId === state.lightId) { state.lightId = null; state.finger = null; }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space' && !e.repeat && (state.screen === 'menu' || state.screen === 'over')) startGame();
    if (e.code === 'Escape' && !playing()) go('menu');
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  function spotTarget() {
    if (state.finger) return { x: state.finger.x, y: Math.max(20, state.finger.y - HELI_OFFSET) };
    if (!hasTouch && playing()) return { x: state.boatX, y: BOAT_Y - 140 };
    return null;
  }

  // ---------- Update ----------
  function update(dt) {
    state.time += dt;
    if (state.banner) { state.banner.age += dt; if (state.banner.age > 2.4) state.banner = null; }
    if (state.toast) { state.toast.age += dt; if (state.toast.age > 2) state.toast = null; }

    const target = spotTarget();
    if (target) {
      const k = Math.min(1, dt * 14);
      state.heli.x += (target.x - state.heli.x) * k;
      state.heli.y += (target.y - state.heli.y) * k;
    }

    if (playing()) {
      state.playTime += dt;
      state.invuln = Math.max(0, state.invuln - dt);

      const lvl = 1 + Math.floor(state.distance / LEVEL_LENGTH);
      if (lvl !== state.level) {
        state.level = lvl;
        state.params = levelParams(lvl);
        state.banner = { text: `Level ${lvl}`, sub: 'The night gets darker', age: 0 };
        sfx.level();
        vibrate(40);
      }
      state.speed += (state.params.speed - state.speed) * Math.min(1, dt * 0.8);
      state.distance += state.speed * dt;

      if (keys.ArrowLeft || keys.KeyA) { state.boatX -= 200 * dt; state.boatTilt -= 2 * dt; }
      if (keys.ArrowRight || keys.KeyD) { state.boatX += 200 * dt; state.boatTilt += 2 * dt; }
      state.boatX = Math.max(8, Math.min(W - 8, state.boatX));
      state.boatTilt *= Math.pow(0.02, dt);
      state.boatTilt = Math.max(-0.5, Math.min(0.5, state.boatTilt));

      // In the water? (outer banks and, when the river splits, the island)
      const p = riverAt(state.distance);
      const off = Math.abs(state.boatX - p.x);
      const toOuter = p.width / 2 - off;
      const toIsland = p.island > 2 ? off - p.island : Infinity;
      const gap = Math.min(toOuter, toIsland);
      const chHalf = p.island > 2 ? (p.width / 2 - p.island) / 2 : p.width / 2;
      state.edge = Math.max(0, Math.min(1, 1 - gap / (chHalf * 0.45)));
      if (gap < 6) {
        crash(toIsland < toOuter ? 'Ran aground on the island!' : 'Crashed into the bank!');
      } else {
        const side = state.boatX < p.x ? -1 : 1;
        for (const b of blockers) {
          if (b.side === side && p.island > 10 && Math.abs(b.w - state.distance) < 12) { crash('Hit the rocks!'); break; }
        }
      }
      if (playing() && state.edge > 0.5 && state.invuln <= 0) {
        state.warnTimer -= dt;
        if (state.warnTimer <= 0) { sfx.warn(); vibrate(15); state.warnTimer = 0.2; }
      }

      // Remember where the spotlight shone (in world coordinates, so it moves with the river)
      if (target) {
        const last = state.marks[state.marks.length - 1];
        const mw = toWorld(state.heli.y);
        if (!last || state.time - last.t > 0.04 || Math.hypot(last.x - state.heli.x, last.w - mw) > 10) {
          state.marks.push({ x: state.heli.x, w: mw, r: state.params.lightR, t: state.time });
        }
      }
      state.marks = state.marks.filter((m) => state.time - m.t < state.params.memory);

      if (Math.random() < dt * 40) {
        state.foam.push({ x: state.boatX + (Math.random() - 0.5) * 8, w: state.distance - 16, age: 0, life: 0.9 + Math.random() * 0.5, side: Math.random() < 0.5 ? -1 : 1 });
      }

      // Lanterns, kept out of a blocked channel
      const aheadW = state.distance + BOAT_Y + 40;
      while (state.nextLanternW < aheadW) {
        const lw = state.nextLanternW;
        const fp = riverAt(lw);
        let x;
        if (fp.island > 10) {
          let side = Math.random() < 0.5 ? -1 : 1;
          if (blockers.some((b) => b.side === side && Math.abs(b.w - lw) < 400)) side = -side;
          x = channelCenter(lw, side);
        } else {
          x = fp.x + (Math.random() - 0.5) * fp.width * 0.5;
        }
        state.lanternsList.push({ w: lw, dx: x - fp.x, phase: Math.random() * 6, alive: true });
        state.nextLanternW += LANTERN_EVERY * (0.7 + Math.random() * 0.6);
      }
      for (const ln of state.lanternsList) {
        if (!ln.alive) continue;
        const lx = riverAt(ln.w).x + ln.dx, ly = toScreenY(ln.w);
        if (Math.hypot(lx - state.boatX, ly - BOAT_Y) < 26) {
          ln.alive = false;
          state.bonus += LANTERN_BONUS;
          state.lanterns++;
          state.popups.push({ x: lx, y: ly, age: 0 });
          sfx.lantern();
          vibrate(20);
        }
      }
      state.lanternsList = state.lanternsList.filter((ln) => ln.alive && toScreenY(ln.w) < H + 30);
    } else if (state.screen !== 'over') {
      state.distance += 30 * dt; // gentle drift behind the menus
    }

    for (const f of state.foam) { f.age += dt; f.x += f.side * 22 * dt; }
    state.foam = state.foam.filter((f) => f.age < f.life);

    const minW = state.distance - (H - BOAT_Y) - 60;
    if (scenery.length > 400) scenery = scenery.filter((s) => s.w > minW);
    if (ripples.length > 400) ripples = ripples.filter((s) => s.w > minW);
    if (reeds.length > 400) reeds = reeds.filter((s) => s.w > minW);
    if (blockers.length > 20) blockers = blockers.filter((s) => s.w > minW);

    for (const p of state.popups) { p.age += dt; p.y -= 40 * dt; }
    state.popups = state.popups.filter((p) => p.age < 0.9);
    state.shake = Math.max(0, state.shake - dt * 30);
  }

  // ---------- Draw: world ----------
  const wTop = () => toWorld(-40);
  const wBottom = () => Math.max(0, toWorld(H + 40));

  function riverOutline(extra) {
    const i0 = pointIndex(wBottom()), i1 = pointIndex(wTop());
    const path = new Path2D();
    for (let i = i0; i <= i1; i++) {
      const p = river.pts[i]; if (!p) continue;
      const y = toScreenY(i * STEP);
      if (i === i0) path.moveTo(p.x - p.width / 2 - extra, y); else path.lineTo(p.x - p.width / 2 - extra, y);
    }
    for (let i = i1; i >= i0; i--) {
      const p = river.pts[i]; if (!p) continue;
      path.lineTo(p.x + p.width / 2 + extra, toScreenY(i * STEP));
    }
    path.closePath();
    return path;
  }

  // Islands in view, as separate shapes (there can be more than one on screen)
  function islandShapes(shrink) {
    const i0 = pointIndex(wBottom()), i1 = pointIndex(wTop());
    const shapes = [];
    let run = null;
    for (let i = i0; i <= i1 + 1; i++) {
      const p = river.pts[i];
      const on = p && p.island - shrink > 0.5;
      if (on) { if (!run) run = []; run.push(i); }
      if ((!on || i > i1) && run) {
        const path = new Path2D();
        run.forEach((k, n) => {
          const q = river.pts[k];
          const y = toScreenY(k * STEP);
          if (n === 0) path.moveTo(q.x - (q.island - shrink), y); else path.lineTo(q.x - (q.island - shrink), y);
        });
        for (let n = run.length - 1; n >= 0; n--) {
          const q = river.pts[run[n]];
          path.lineTo(q.x + (q.island - shrink), toScreenY(run[n] * STEP));
        }
        path.closePath();
        shapes.push(path);
        run = null;
      }
    }
    return shapes;
  }

  function drawLand() {
    ctx.fillStyle = '#1e2d1b';
    ctx.fillRect(0, 0, W, H);
    const band = 30;
    const offset = state.distance % (band * 2);
    ctx.fillStyle = '#223320';
    for (let y = -band * 2 + offset; y < H; y += band * 2) ctx.fillRect(0, y, W, band);
  }

  function drawRiver() {
    ctx.fillStyle = '#5a5039';
    ctx.fill(riverOutline(9));
    const water = riverOutline(0);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#1d4c66');
    g.addColorStop(0.5, '#2a6585');
    g.addColorStop(1, '#1d4c66');
    ctx.fillStyle = g;
    ctx.fill(water);

    ctx.save();
    ctx.clip(water);
    ctx.strokeStyle = 'rgba(190,225,240,0.35)';
    ctx.lineWidth = 1.5;
    const lo = wBottom(), hi = wTop();
    for (const r of ripples) {
      if (r.w < lo || r.w > hi) continue;
      const p = riverAt(r.w);
      const x = p.x + r.dx * p.width + Math.sin(state.time * 1.5 + r.phase) * 3;
      const y = toScreenY(r.w);
      ctx.beginPath();
      ctx.moveTo(x - r.len / 2, y);
      ctx.quadraticCurveTo(x, y - 3, x + r.len / 2, y);
      ctx.stroke();
    }
    for (const f of state.foam) {
      const k = 1 - f.age / f.life;
      ctx.fillStyle = `rgba(235,245,250,${0.55 * k})`;
      ctx.beginPath();
      ctx.arc(f.x, toScreenY(f.w), 2 + (1 - k) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Islands where the river splits: muddy edge, then grass
    ctx.fillStyle = '#5a5039';
    for (const s of islandShapes(0)) ctx.fill(s);
    ctx.fillStyle = '#243620';
    for (const s of islandShapes(7)) ctx.fill(s);

    // Rocks blocking one channel
    for (const b of blockers) {
      if (b.w < lo || b.w > hi) continue;
      const p = riverAt(b.w);
      if (p.island < 10) continue;
      const y = toScreenY(b.w);
      const inner = p.x + b.side * p.island, outer = p.x + b.side * p.width / 2;
      const a = Math.min(inner, outer) - 4, z = Math.max(inner, outer) + 4;
      ctx.fillStyle = '#6b3f22'; // fallen log
      ctx.save();
      ctx.translate((a + z) / 2, y);
      ctx.rotate(0.12 * b.side);
      ctx.fillRect(-(z - a) / 2, -5, z - a, 10);
      ctx.restore();
      for (let x = a + 6, k = 0; x < z; x += 13, k++) {
        const r = 7 + ((b.seed * 7 + k * 3) % 4);
        ctx.fillStyle = '#55534d';
        ctx.beginPath(); ctx.ellipse(x, y + ((k % 2) ? 4 : -4), r, r * 0.75, k, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#76736a';
        ctx.beginPath(); ctx.ellipse(x - 2, y + ((k % 2) ? 2 : -6), r * 0.45, r * 0.3, k, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.strokeStyle = '#4f6a33';
    ctx.lineWidth = 1.5;
    for (const r of reeds) {
      if (r.w < lo || r.w > hi) continue;
      const p = riverAt(r.w);
      const x = p.x + r.side * (p.width / 2 + 2), y = toScreenY(r.w);
      for (let k = 0; k < 3; k++) {
        const a = (r.seed + k) * 1.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 7 - r.side * 2, y - 6 - Math.sin(a) * 3);
        ctx.stroke();
      }
    }
  }

  function drawScenery() {
    const lo = wBottom(), hi = wTop();
    for (const s of scenery) {
      if (s.w < lo || s.w > hi) continue;
      const y = toScreenY(s.w);
      if (s.kind === 'tree') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.arc(s.x + 6, y + 6, s.size, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsl(${s.hue},35%,16%)`;
        ctx.beginPath(); ctx.arc(s.x, y, s.size, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsl(${s.hue},38%,22%)`;
        ctx.beginPath(); ctx.arc(s.x - s.size * 0.25, y - s.size * 0.25, s.size * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsl(${s.hue},40%,29%)`;
        ctx.beginPath(); ctx.arc(s.x - s.size * 0.38, y - s.size * 0.38, s.size * 0.28, 0, Math.PI * 2); ctx.fill();
      } else if (s.kind === 'bush') {
        ctx.fillStyle = `hsl(${s.hue},35%,20%)`;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(s.x + Math.cos(s.seed + k * 2.1) * s.size * 0.6, y + Math.sin(s.seed + k * 2.1) * s.size * 0.6, s.size * 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = '#4b4a46';
        ctx.beginPath(); ctx.ellipse(s.x, y, s.size, s.size * 0.7, s.seed, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#62615b';
        ctx.beginPath(); ctx.ellipse(s.x - 2, y - 2, s.size * 0.5, s.size * 0.35, s.seed, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function boatSkin(id) { return BOATS.find((b) => b.id === id) || BOATS[0]; }

  function drawBoat(x, y, tilt, danger, skinId = save.boat, s = 1) {
    const skin = boatSkin(skinId);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(s, s);
    if (state.invuln > 0 && playing() && Math.sin(state.time * 30) > 0) ctx.globalAlpha = 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(3, 4, 11, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = danger > 0.5 ? '#b5452e' : skin.hull;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.quadraticCurveTo(12, -8, 11, 16);
    ctx.lineTo(-11, 16);
    ctx.quadraticCurveTo(-12, -8, 0, -22);
    ctx.fill();
    ctx.fillStyle = skin.deck;
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.quadraticCurveTo(8, -6, 7.5, 13);
    ctx.lineTo(-7.5, 13);
    ctx.quadraticCurveTo(-8, -6, 0, -17);
    ctx.fill();
    ctx.fillStyle = skin.seat;
    ctx.fillRect(-7, -4, 14, 3);
    ctx.fillRect(-7, 6, 14, 3);
    ctx.fillStyle = '#e0b43c';
    ctx.beginPath(); ctx.arc(0, 1, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c6962a';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    if (state.jacketsUsed > 0 || (save.jackets > 0 && playing())) {
      ctx.strokeStyle = '#ff7a2f'; ctx.lineWidth = 1.5; // life jacket on
      ctx.beginPath(); ctx.arc(0, 1, 5.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(0, -18, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawHelicopter() {
    const target = playing() ? spotTarget() : null;
    if (!target) return;
    const { x, y } = state.heli;
    ctx.save();
    ctx.translate(x + 18, y - 22);
    ctx.rotate(-0.35);
    ctx.fillStyle = '#2b3138';
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-1.5, 10, 3, 16);
    ctx.fillRect(-5, 24, 10, 2.5);
    ctx.fillStyle = '#6fa8c8';
    ctx.beginPath(); ctx.ellipse(0, -6, 4.5, 4, 0, 0, Math.PI * 2); ctx.fill();
    const a = state.time * 30;
    ctx.strokeStyle = 'rgba(200,210,220,0.55)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 2; k++) {
      const ang = a + k * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * -20, Math.sin(ang) * -20);
      ctx.lineTo(Math.cos(ang) * 20, Math.sin(ang) * 20);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,210,220,0.08)';
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
    if (Math.sin(state.time * 8) > 0.6) {
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(0, 25, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawDarkness() {
    const amb = playing() ? state.params.ambient : 0.55;
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle = `rgba(2,4,12,${amb})`;
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, strength) => {
      if (strength <= 0.01) return;
      const g = dctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.6, `rgba(0,0,0,${strength * 0.8})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g;
      dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill();
    };
    if (playing()) {
      const mem = state.params.memory;
      for (const m of state.marks) {
        const a = 1 - (state.time - m.t) / mem;
        hole(m.x, toScreenY(m.w), m.r * 0.9, 0.12 * a);
      }
      hole(state.boatX, BOAT_Y - 10, state.params.lampR, 0.8);
      if (spotTarget()) hole(state.heli.x, state.heli.y, state.params.lightR, 1);
    }
    dctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dark, 0, 0);
    ctx.restore();

    if (playing() && spotTarget()) {
      const r = state.params.lightR;
      const { x, y } = state.heli;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(225,240,255,0.16)');
      g.addColorStop(1, 'rgba(225,240,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawLanterns() {
    for (const ln of state.lanternsList) {
      const x = riverAt(ln.w).x + ln.dx + Math.sin(state.time * 1.5 + ln.phase) * 3;
      const y = toScreenY(ln.w);
      const k = 0.75 + 0.25 * Math.sin(state.time * 5 + ln.phase);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
      g.addColorStop(0, `rgba(255,214,120,${0.9 * k})`);
      g.addColorStop(0.35, `rgba(255,170,70,${0.45 * k})`);
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe7a3';
      ctx.fillRect(x - 2.5, y - 3.5, 5, 7);
    }
  }

  // ---------- Draw: UI ----------
  const C = { title: '#cfe8f5', warm: '#ffd98a', soft: '#a9bccb', dim: '#7f95a5', bad: '#ff9b7a', good: '#9fe0c0' };

  function text(str, x, y, size, color = '#fff', align = 'center', weight = '800') {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = 'rgba(2,4,12,0.85)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(8,16,24,0.92)';
    ctx.strokeStyle = 'rgba(150,205,235,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 16); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
  }

  function coin(x, y, r = 7) {
    ctx.fillStyle = '#f2c45a';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b8862a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r - 2.5, 0, Math.PI * 2); ctx.stroke();
  }

  function coinBadge(x, y) {
    const label = String(save.coins);
    ctx.font = '800 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const w = ctx.measureText(label).width + 38;
    ctx.fillStyle = 'rgba(8,16,24,0.9)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w, y - 14, w, 28, 14); else ctx.rect(x - w, y - 14, w, 28);
    ctx.fill();
    coin(x - w + 16, y);
    text(label, x - 10, y + 1, 16, C.warm, 'right');
  }

  function backButton() {
    button(16, 16, 84, 36, '‹ Back', () => go('menu'), { size: 15 });
  }

  function drawMenu() {
    coinBadge(W - 16, 34);
    text('NIGHT', W / 2, 118, 52, C.title);
    text('WATCH', W / 2, 168, 52, C.warm);
    text('River patrol after dark', W / 2, 206, 15, C.soft, 'center', '600');
    if (save.best > 0) text(`High score  ${save.best}`, W / 2, 246, 18, '#fff', 'center', '700');
    button(70, 288, W - 140, 60, 'PLAY', startGame, { primary: true, size: 24 });
    button(70, 362, W - 140, 46, 'Shop', () => go('shop'));
    button(70, 420, W - 140, 46, 'High scores', () => go('scores'));
    button(70, 478, W - 140, 46, 'How to play', () => go('how'));
    if (save.jackets > 0) text(`Life jackets: ${save.jackets}`, W / 2, 552, 13, C.soft, 'center', '600');
  }

  function drawHow() {
    backButton();
    panel(20, 70, W - 40, 470);
    text('How to play', W / 2, 104, 26, C.title);
    const rows = [
      ['Steer the boat', 'Drag your thumb left and right on the bottom pad. Let go and the boat goes straight.'],
      ['Fly the helicopter', 'Touch anywhere above the pad with another finger. Its spotlight shows the river.'],
      ['Remember the river', 'Lit spots stay visible for a moment, so scout ahead, then steer.'],
      ['The river splits', 'Pick a side. Rocks or a fallen log can block one way, so light it first.'],
      ['Lanterns', '+10 points and 1 coin each. You also get 1 coin per 50 points.'],
      ['Levels', 'Every level is darker and faster, with a narrower river and smaller light.'],
    ];
    let y = 142;
    for (const [head, body] of rows) {
      text(head, 40, y, 16, C.warm, 'left', '700');
      y = wrap(body, 40, y + 20, W - 80, 13, C.soft) + 28;
    }
    button(70, 556, W - 140, 50, 'PLAY', startGame, { primary: true, size: 20 });
  }

  function wrap(str, x, y, maxW, size, color) {
    ctx.font = `500 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const words = str.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        text(line, x, y, size, color, 'left', '500');
        line = word; y += size + 5;
      } else line = test;
    }
    if (line) text(line, x, y, size, color, 'left', '500');
    return y;
  }

  function drawShop() {
    backButton();
    coinBadge(W - 16, 34);
    text('Shop', W / 2, 34, 22, C.title);
    const x = 16, w = W - 32;
    let y = 70;
    text('UPGRADES', x, y, 12, C.dim, 'left', '700');
    y += 12;
    for (const u of UPGRADES) {
      const lvl = save.upgrades[u.id];
      const maxed = lvl >= u.costs.length;
      panel(x, y, w, 52);
      text(u.name, x + 12, y + 18, 15, '#fff', 'left', '700');
      text(u.desc, x + 12, y + 36, 12, C.soft, 'left', '500');
      for (let k = 0; k < u.costs.length; k++) {
        ctx.fillStyle = k < lvl ? C.warm : 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 196 + k * 12, y + 14, 9, 9);
      }
      button(x + w - 92, y + 10, 82, 32, maxed ? 'MAX' : `● ${u.costs[lvl]}`, () => buyUpgrade(u), { size: 14, disabled: maxed, primary: !maxed && save.coins >= u.costs[lvl] });
      y += 60;
    }
    y += 8;
    text('ITEMS', x, y, 12, C.dim, 'left', '700');
    y += 12;
    panel(x, y, w, 52);
    text(JACKET.name, x + 12, y + 18, 15, '#fff', 'left', '700');
    text(`${JACKET.desc} · have ${save.jackets}/${JACKET.max}`, x + 12, y + 36, 12, C.soft, 'left', '500');
    button(x + w - 92, y + 10, 82, 32, save.jackets >= JACKET.max ? 'FULL' : `● ${JACKET.cost}`, buyJacket,
      { size: 14, disabled: save.jackets >= JACKET.max, primary: save.jackets < JACKET.max && save.coins >= JACKET.cost });
    y += 68;
    text('BOATS', x, y, 12, C.dim, 'left', '700');
    y += 12;
    const cw = (w - 8 * (BOATS.length - 1)) / BOATS.length;
    BOATS.forEach((b, i) => {
      const bx = x + i * (cw + 8);
      const owned = save.boats.includes(b.id);
      const on = save.boat === b.id;
      ctx.fillStyle = on ? 'rgba(242,196,90,0.18)' : 'rgba(8,16,24,0.92)';
      ctx.strokeStyle = on ? C.warm : 'rgba(150,205,235,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, y, cw, 112, 12); else ctx.rect(bx, y, cw, 112);
      ctx.fill(); ctx.stroke();
      drawBoat(bx + cw / 2, y + 40, 0, 0, b.id, 1.05);
      text(on ? 'In use' : owned ? 'Use' : `● ${b.cost}`, bx + cw / 2, y + 92, 12, on ? C.warm : owned ? '#fff' : (save.coins >= b.cost ? C.warm : C.dim), 'center', '700');
      buttons.push({ x: bx, y, w: cw, h: 112, onTap: () => tapBoat(b) });
    });
    text(boatSkin(save.boat).name, W / 2, y + 130, 13, C.soft, 'center', '600');
    text('Earn coins from lanterns and points in every run.', W / 2, H - 28, 12, C.dim, 'center', '500');
  }

  function drawScores() {
    backButton();
    text('High scores', W / 2, 34, 22, C.title);
    const tabW = (W - 48) / 2;
    button(16, 66, tabW, 36, 'This device', () => { state.scoresTab = 'device'; sfx.click(); },
      { size: 14, primary: state.scoresTab === 'device' });
    button(32 + tabW, 66, tabW, 36, 'Everyone', () => { state.scoresTab = 'everyone'; sfx.click(); loadLeaderboard(); },
      { size: 14, primary: state.scoresTab === 'everyone' });

    panel(16, 116, W - 32, 420);
    const rowH = 38;
    let y = 146;
    if (state.scoresTab === 'device') {
      if (!save.top.length) {
        text('No runs yet. Go play!', W / 2, 300, 16, C.soft, 'center', '600');
      }
      save.top.forEach((r, i) => {
        rankRow(i, y, String(r.score), `Level ${r.level} · ${new Date(r.at).toLocaleDateString()}`, false);
        y += rowH;
      });
    } else {
      if (online.status === 'off' || !online.db) {
        wrap('The online leaderboard works in the web version when you are signed in to Claude. In the phone app it will come with Google Play Games.', 36, 280, W - 72, 14, C.soft);
      } else if (online.status === 'loading' || online.status === 'connecting') {
        text('Loading…', W / 2, 300, 16, C.soft, 'center', '600');
      } else if (online.status === 'error' || online.status === 'timeout') {
        text("Couldn't load the leaderboard.", W / 2, 290, 15, C.bad, 'center', '600');
        button(W / 2 - 60, 316, 120, 36, 'Try again', loadLeaderboard, { size: 14 });
      } else if (online.rows && !online.rows.length) {
        text('No scores yet. Be the first!', W / 2, 300, 16, C.soft, 'center', '600');
      } else if (online.rows) {
        online.rows.slice(0, 10).forEach((r, i) => {
          const me = r.id === online.myId;
          rankRow(i, y, String(r.score || 0), `${me ? 'You' : (online.names[r.id] || 'Player')} · level ${r.level || 1}`, me);
          y += rowH;
        });
      }
    }
    text(`Runs ${save.runs}  ·  Lanterns ${save.lanternsTotal}  ·  Best level ${save.bestLevel}`, W / 2, 560, 12, C.soft, 'center', '600');
    button(70, 580, W - 140, 46, 'PLAY', startGame, { primary: true, size: 18 });
  }

  function rankRow(i, y, scoreStr, sub, highlight) {
    const medal = ['#f2c45a', '#c9d3db', '#d39a5c'][i];
    if (highlight) {
      ctx.fillStyle = 'rgba(242,196,90,0.12)';
      ctx.fillRect(24, y - 16, W - 48, 34);
    }
    if (medal) {
      ctx.fillStyle = medal;
      ctx.beginPath(); ctx.arc(46, y, 11, 0, Math.PI * 2); ctx.fill();
      text(String(i + 1), 46, y + 1, 12, '#1a1a1a', 'center', '800');
    } else {
      text(String(i + 1), 46, y + 1, 14, C.soft, 'center', '700');
    }
    text(sub, 70, y + 1, 13, highlight ? C.warm : C.soft, 'left', '600');
    text(scoreStr, W - 36, y + 1, 18, '#fff', 'right', '800');
  }

  function drawPlayHUD() {
    text(String(score()), W / 2, 46, 40);
    text(`Level ${state.level}`, 14, 30, 14, C.warm, 'left', '700');
    coin(W - 60, 30, 6);
    text(String(state.lanterns), W - 48, 31, 14, C.warm, 'left', '700');
    if (save.jackets > 0) text(`Life jackets ${save.jackets}`, W - 14, 56, 12, C.soft, 'right', '600');
    if (state.banner) {
      const a = Math.min(1, state.banner.age * 4, (2.4 - state.banner.age) * 2);
      ctx.globalAlpha = Math.max(0, a);
      text(state.banner.text, W / 2, 150, 32, C.title);
      text(state.banner.sub, W / 2, 186, 16, '#e6eef4', 'center', '600');
      ctx.globalAlpha = 1;
    }
    // Pad
    if (hasTouch) {
      ctx.fillStyle = state.steerId !== null ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, PAD_TOP, W, H - PAD_TOP);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, PAD_TOP); ctx.lineTo(W, PAD_TOP); ctx.stroke();
      ctx.setLineDash([]);
      if (state.playTime < 6) {
        text('◀  drag here to steer the boat  ▶', W / 2, PAD_TOP + 50, 14, 'rgba(255,255,255,0.75)', 'center', '600');
        text('touch above to fly the helicopter', W / 2, PAD_TOP + 78, 13, 'rgba(255,255,255,0.55)', 'center', '500');
      }
    }
    for (const p of state.popups) {
      ctx.globalAlpha = 1 - p.age / 0.9;
      text(`+${LANTERN_BONUS}`, p.x, p.y, 20, C.warm);
      ctx.globalAlpha = 1;
    }
  }

  function drawOver() {
    panel(30, 110, W - 60, 300);
    text(state.reason, W / 2, 146, 22, C.bad);
    text(`Reached level ${state.level}`, W / 2, 178, 14, C.soft, 'center', '600');
    text('Score', W / 2 - 65, 212, 14, C.soft, 'center', '600');
    text('Best', W / 2 + 65, 212, 14, C.soft, 'center', '600');
    text(String(score()), W / 2 - 65, 246, 38);
    text(String(save.best), W / 2 + 65, 246, 38, C.warm);
    if (state.newBest) text('New high score!', W / 2, 290, 18, C.good, 'center', '700');
    coin(W / 2 - 52, 330);
    text(`+${state.coinsEarned} coins`, W / 2 - 38, 331, 17, C.warm, 'left', '700');
    text(`${state.lanterns} lanterns · ${Math.floor(score() / 50)} from points`, W / 2, 360, 12, C.soft, 'center', '500');
    text(`You have ${save.coins} coins`, W / 2, 386, 13, C.soft, 'center', '600');
    if (state.time - state.overAt > 0.6) {
      button(50, 432, W - 100, 56, 'PLAY AGAIN', startGame, { primary: true, size: 20 });
      button(50, 500, (W - 112) / 2, 44, 'Shop', () => go('shop'), { size: 15 });
      button(62 + (W - 112) / 2, 500, (W - 112) / 2, 44, 'Menu', () => go('menu'), { size: 15 });
    }
  }

  function draw() {
    buttons = [];
    ctx.save();
    if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    drawLand();
    drawRiver();
    drawScenery();
    const showBoat = playing() || state.screen === 'over' || state.screen === 'menu';
    if (showBoat) drawBoat(state.boatX, BOAT_Y, playing() ? state.boatTilt : 0, playing() ? state.edge : 0);
    drawDarkness();
    if (playing()) drawLanterns();
    drawHelicopter();
    if (playing() && state.edge > 0 && state.invuln <= 0) {
      ctx.fillStyle = `rgba(255,50,40,${0.15 * state.edge})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    if (!playing() && state.screen !== 'over') {
      ctx.fillStyle = 'rgba(2,4,12,0.35)';
      ctx.fillRect(0, 0, W, H);
    }
    switch (state.screen) {
      case 'menu': drawMenu(); break;
      case 'how': drawHow(); break;
      case 'shop': drawShop(); break;
      case 'scores': drawScores(); break;
      case 'play': drawPlayHUD(); break;
      case 'over': drawOver(); break;
    }
    if (state.toast) {
      ctx.globalAlpha = Math.min(1, (2 - state.toast.age) * 3);
      panel(40, H - 92, W - 80, 40);
      text(state.toast.msg, W / 2, H - 71, 14, '#fff', 'center', '600');
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
})();
