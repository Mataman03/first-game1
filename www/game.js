// Night Watch — steer a boat down a dark river. A helicopter's spotlight shows the way.
// Thumb on the bottom pad steers the boat. Another finger flies the helicopter.
(() => {
  'use strict';

  // Logical game size. The canvas is scaled to fit the screen.
  // The game is 360 units wide. Its height follows the phone's shape (at least 640),
  // so tall phones fill the screen instead of getting black bars.
  const W = 360;
  let H = 640;

  // Layout
  let BOAT_Y = 400;          // the boat's height on screen (set in resize: 240 above the bottom)
  let PAD_TOP = 500;         // below this line is the steering pad (set in resize: 140 above the bottom)
  let SAFE_TOP = 0;          // room for the camera hole / status area at the top, in game units
  const HELI_OFFSET = 70;    // the helicopter flies this far above your finger
  const STEP = 8;            // world px between river points

  // Joystick on the steering pad
  const JOY_R = 46;          // how far the knob can move
  const STEER_SPEED = 240;   // px/s sideways at full tilt
  const BOOST = 0.8;         // pushing forward adds up to +80% speed (there is no brake)
  // Fonts: a stencil face for titles, a condensed face for everything else
  const UI_FONT = '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
  const TITLE_FONT = '"Black Ops One", "Barlow Condensed", Impact, system-ui, sans-serif';
  try { document.fonts && ['600 16px "Barlow Condensed"', '700 16px "Barlow Condensed"', '16px "Black Ops One"'].forEach((f) => document.fonts.load(f)); } catch { /* ignore */ }
  const LANTERN_EVERY = 360;
  const LANTERN_BONUS = 10;
  const ISLAND_MAX = 46;     // half-width of the island when the river splits

  // Seeded random numbers, so a level's river is the same every time you play it
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = Math.random;        // river and scenery
  let lanternRng = Math.random; // lantern placement

  // How the river is shaped
  const ENDLESS_WORLD = {
    startWidth: 160, minWidth: 60, narrowRate: 0.0085, turn: 1.5, turnGrow: 1 / 3000,
    forks: true, firstFork: 1100, forkGap: [900, 2000], blockChance: 0.7,
  };
  let world = ENDLESS_WORLD;

  // Endless mode gets harder every ENDLESS_STEP px
  const ENDLESS_STEP = 1400;
  function endlessParams(stage) {
    const n = Math.min(stage, 10) - 1;
    return withUpgrades({
      speed: 95 + n * 20,
      lightR: Math.max(60, 105 - n * 5),
      memory: Math.max(0.45, 1.8 - n * 0.16),
      ambient: Math.min(0.988, 0.955 + n * 0.004),
    });
  }
  function withUpgrades(p) {
    const up = save.upgrades;
    return { ...p, lightR: p.lightR * (1 + 0.1 * up.spot), memory: p.memory * (1 + 0.2 * up.memory), lampR: 48 * (1 + 0.25 * up.lamp) };
  }

  // The 10 levels. Each has a fixed river (seed), a finish line (length) and its own night.
  const LEVELS = [
    { name: 'First Light', tip: 'Street lamps light the river. Where they stop, use the chopper!', road: { side: 1, every: 170, until: 1300 }, length: 2200, speed: 85, lightR: 125, memory: 2.4, ambient: 0.955,
      world: { startWidth: 175, minWidth: 150, narrowRate: 0.01, turn: 1.1, forks: false } },
    { name: 'Gentle Bends', tip: 'Only a few lamps tonight. Light the bends with the chopper.', road: { side: -1, every: 360, until: 1500 }, length: 2600, speed: 95, lightR: 115, memory: 2.1, ambient: 0.96,
      world: { startWidth: 165, minWidth: 125, narrowRate: 0.012, turn: 2.2, forks: false } },
    { name: 'The Split', tip: 'The river splits around islands. Both ways are open. Pick one!', length: 3000, speed: 100, lightR: 110, memory: 2, ambient: 0.962,
      world: { startWidth: 155, minWidth: 120, narrowRate: 0.01, turn: 2, forks: true, firstFork: 600, forkGap: [350, 600], forkLen: [500, 620], blockChance: 0 } },
    { name: 'Blocked Way', tip: 'One side of every split is blocked. Look for the red lights!', length: 3300, speed: 105, lightR: 108, memory: 1.9, ambient: 0.965,
      world: { startWidth: 150, minWidth: 115, narrowRate: 0.01, turn: 2, forks: true, firstFork: 600, forkGap: [350, 600], forkLen: [500, 620], blockChance: 1 } },
    { name: 'The Narrows', tip: 'The river gets very thin. Small, careful moves.', length: 3400, speed: 105, lightR: 105, memory: 1.8, ambient: 0.965,
      world: { startWidth: 140, minWidth: 68, narrowRate: 0.03, turn: 2.4, forks: true, firstFork: 1600, forkGap: [1200, 1500], blockChance: 0.6 } },
    { name: 'Moonless Night', tip: 'Very dark, and your light is small. Keep scouting.', length: 3400, speed: 110, lightR: 88, memory: 1.4, ambient: 0.988,
      world: { startWidth: 145, minWidth: 105, narrowRate: 0.012, turn: 2.6, forks: true, firstFork: 1000, forkGap: [900, 1200], blockChance: 0.7 } },
    { name: 'Fast Water', tip: 'The current is strong. Light far ahead!', length: 3900, speed: 150, lightR: 105, memory: 1.6, ambient: 0.968,
      world: { startWidth: 145, minWidth: 100, narrowRate: 0.01, turn: 2.6, forks: true, firstFork: 1200, forkGap: [1000, 1300], blockChance: 0.7 } },
    { name: 'Island Maze', tip: 'Split after split after split.', length: 4100, speed: 120, lightR: 100, memory: 1.6, ambient: 0.972,
      world: { startWidth: 150, minWidth: 110, narrowRate: 0.008, turn: 2.2, forks: true, firstFork: 450, forkGap: [150, 300], forkLen: [460, 540], blockChance: 0.85 } },
    { name: 'Fading Memory', tip: 'Lit water goes dark again almost at once.', length: 4100, speed: 125, lightR: 92, memory: 0.6, ambient: 0.975,
      world: { startWidth: 140, minWidth: 90, narrowRate: 0.012, turn: 2.8, forks: true, firstFork: 700, forkGap: [600, 900], blockChance: 0.8 } },
    { name: 'Night Run', tip: 'Everything at once. Good luck, captain.', length: 5200, speed: 145, lightR: 82, memory: 0.75, ambient: 0.985,
      world: { startWidth: 130, minWidth: 66, narrowRate: 0.014, turn: 3.2, forks: true, firstFork: 700, forkGap: [400, 600], forkLen: [520, 640], blockChance: 0.85 } },
  ];
  const levelWorld = (L) => ({ turnGrow: 0, firstFork: 1e9, forkGap: [1000, 1000], blockChance: 0, ...L.world, road: L.road || null });

  // ---------- Shop catalogue ----------
  const UPGRADES = [
    { id: 'spot', name: 'Bigger spotlight', desc: '+10% light size', costs: [30, 60, 120] },
    { id: 'memory', name: 'Sharper memory', desc: 'lit spots fade 20% slower', costs: [25, 50, 100] },
    { id: 'lamp', name: 'Brighter boat lamp', desc: '+25% light around the boat', costs: [20, 40, 80] },
  ];
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
      upgrades: { spot: 0, memory: 0, lamp: 0 },
      boats: ['wood'], boat: 'wood', top: [], stars: [],
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

  // ---------- Reward ads ("watch an ad to revive") ----------
  // In the Android app this uses AdMob through the @capacitor-community/admob plugin.
  // In a browser there are no ads, so a short pretend ad plays instead (handy for testing).
  // These are Google's TEST ids: swap in your own ad unit id from admob.google.com
  // (and the app id in android/app/src/main/res/values/strings.xml) before publishing.
  const AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';
  const AD_TESTING = true; // set to false with your real ad unit id
  const ads = (() => {
    const cap = window.Capacitor;
    const native = !!(cap && cap.getPlatform && cap.getPlatform() !== 'web' && cap.nativePromise);
    let ready = false, loading = false, started = false;
    const call = (method, opts = {}) => cap.nativePromise('AdMob', method, opts);
    async function preload() {
      if (!native || ready || loading) return;
      loading = true;
      try {
        if (!started) { await call('initialize', { initializeForTesting: AD_TESTING }); started = true; }
        await call('prepareRewardVideoAd', { adId: AD_UNIT_ID, isTesting: AD_TESTING });
        ready = true;
      } catch { ready = false; } finally { loading = false; }
    }
    // Shows a reward ad. Calls done(true) if the player watched it to the end, done(false) otherwise.
    function show(done) {
      if (!native) { setTimeout(() => done(true), 3000); return; } // pretend ad in the browser
      let rewarded = false, finished = false;
      const subs = [];
      const finish = (ok) => {
        if (finished) return;
        finished = true;
        subs.forEach((h) => { try { h.remove(); } catch { /* ignore */ } });
        ready = false;
        setTimeout(preload, 1000); // get the next one ready
        done(ok);
      };
      subs.push(cap.addListener('AdMob', 'onRewardedVideoAdReward', () => { rewarded = true; }));
      subs.push(cap.addListener('AdMob', 'onRewardedVideoAdDismissed', () => finish(rewarded)));
      subs.push(cap.addListener('AdMob', 'onRewardedVideoAdFailedToShow', () => finish(false)));
      const go = () => call('showRewardVideoAd').then(() => { rewarded = true; }).catch(() => finish(rewarded));
      if (ready) go();
      else preload().then(() => (ready ? go() : finish(false)));
    }
    return { native, preload, show, get ready() { return ready || !native; } };
  })();
  ads.preload();

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

  // How much of the top of the screen is taken by a camera hole or notch (CSS px).
  // The browser reports it through env(); the Android app also sends it as window.__safeTopPx.
  const safeProbe = document.createElement('div');
  safeProbe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top,0px);pointer-events:none;visibility:hidden';
  document.body.appendChild(safeProbe);
  function updateSafeTop() {
    const css = Math.max(safeProbe.offsetHeight || 0, Number(window.__safeTopPx) || 0);
    SAFE_TOP = css / scale;
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    H = Math.round(Math.max(640, Math.min(900, W * vh / vw)));
    BOAT_Y = H - 240;
    PAD_TOP = H - 140;
    scale = Math.min(vw / W, vh / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
    canvas.width = dark.width = Math.floor(W * scale * dpr);
    canvas.height = dark.height = Math.floor(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    dctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    updateSafeTop();
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
  const river = { pts: [], targetX: W / 2, x: W / 2, fork: null, nextForkW: ENDLESS_WORLD.firstFork };
  let scenery = [], ripples = [], reeds = [], blockers = [];

  function resetWorld() {
    Object.assign(river, { pts: [], targetX: W / 2, x: W / 2, fork: null, nextForkW: world.forks ? world.firstFork : Infinity });
    scenery = []; ripples = []; reeds = []; blockers = [];
  }

  const ease = (t) => t * t * (3 - 2 * t);

  function extendRiver(toW) {
    while (river.pts.length * STEP < toW) {
      const w = river.pts.length * STEP;
      const base = Math.max(world.minWidth, world.startWidth - w * world.narrowRate);
      let width = base, island = 0;

      // Start a split when one is due and the river is near the middle
      if (!river.fork && w >= river.nextForkW && w < finishW() - 750) {
        river.targetX = W / 2;
        if (Math.abs(river.x - W / 2) < 16) {
          const fl = world.forkLen || [600, 860];
          const len = fl[0] + rng() * (fl[1] - fl[0]);
          const r = rng();
          const blocked = r < world.blockChance ? (rng() < 0.5 ? -1 : 1) : 0;
          river.fork = { start: w, len, blocked };
          if (blocked) blockers.push({ w: w + len * 0.33, side: blocked, seed: rng() * 10 });
        }
      }

      if (river.fork) {
        const t = (w - river.fork.start) / river.fork.len;
        if (t >= 1) {
          river.fork = null;
          river.nextForkW = w + world.forkGap[0] + rng() * (world.forkGap[1] - world.forkGap[0]);
        } else {
          const b = t < 0.25 ? ease(t / 0.25) : t > 0.75 ? ease((1 - t) / 0.25) : 1;
          const channel = Math.max(52, base * 0.62);
          island = b * b * ISLAND_MAX; // the island grows a bit later than the river widens, so the channels never pinch
          width = base + (2 * channel + 2 * ISLAND_MAX - base) * b;
          river.targetX = W / 2;
        }
      }

      const margin = width / 2 + 20;
      if (w < 300) {
        river.x = river.targetX = W / 2;
      } else {
        if (!river.fork && w < river.nextForkW && Math.abs(river.targetX - river.x) < 4) {
          river.targetX = margin + rng() * (W - margin * 2);
        }
        const maxSlope = Math.min(5, world.turn + w * world.turnGrow);
        const dx = Math.max(-maxSlope, Math.min(maxSlope, (river.targetX - river.x) * 0.055));
        river.x = Math.max(margin, Math.min(W - margin, river.x + dx));
      }
      river.pts.push({ x: river.x, width, island });

      if (river.pts.length % 3 === 0) {
        for (const side of [-1, 1]) {
          if (rng() < 0.55) {
            const gap = 16 + rng() * 120;
            if (world.road && side === world.road.side && w < world.road.until + 420 && gap < 104) continue;
            const x = river.x + side * (width / 2 + gap);
            if (x > -30 && x < W + 30) {
              const r = rng();
              scenery.push({
                w, x,
                kind: r < 0.55 ? 'tree' : r < 0.85 ? 'bush' : 'rock',
                size: r < 0.55 ? 18 + rng() * 16 : 7 + rng() * 8,
                hue: 95 + rng() * 40,
                seed: rng() * 10,
              });
            }
          }
          if (rng() < 0.5) reeds.push({ w, side, seed: rng() * 10 });
        }
        // Trees on the island
        if (island > 34 && rng() < 0.6) {
          scenery.push({ w, x: river.x + (rng() - 0.5) * (island - 20), kind: rng() < 0.7 ? 'tree' : 'bush',
            size: 12 + rng() * 10, hue: 95 + rng() * 40, seed: rng() * 10 });
        }
      }
      if (rng() < 0.3) {
        ripples.push({ w, dx: (rng() - 0.5) * 0.8, len: 6 + rng() * 10, phase: rng() * 6 });
      }
    }
  }

  function riverAt(w) {
    if (w < 0) return { x: W / 2, width: world.startWidth, island: 0 };
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
    bonus: 0, lanterns: 0, newBest: false, coinsEarned: 0,
    boatX: W / 2, boatTilt: 0, invuln: 0,
    steerId: null, joy: null, // joy: { ox, oy, kx, ky } origin and knob offset
    boost: 0,
    lightId: null, finger: null,
    heli: { x: W / 2 + 60, y: 120 },
    marks: [], foam: [], lanternsList: [], nextLanternW: LANTERN_EVERY, popups: [],
    edge: 0, warnTimer: 0, banner: null, reason: '',
    time: 0, overAt: 0, shake: 0, playTime: 0,
    toast: null, press: null, pendingTap: null,
    mode: 'endless', levelIdx: 0, lanternTotal: 0, levelStars: 0, firstClear: false,
  };
  state.params = endlessParams(1);
  window.__nightWatch = { state, riverAt, save, channelCenter, LEVELS, startLevel: (i) => startGame('level', i), get blockers() { return blockers; } }; // handy for debugging in the browser console

  const score = () => Math.floor(state.distance / 10) + state.bonus;
  const playing = () => state.screen === 'play';

  const finishW = () => (state && state.mode === 'level' ? LEVELS[state.levelIdx].length : Infinity);
  const levelUnlocked = (i) => i === 0 || (save.stars[i - 1] || 0) > 0;

  function startGame(mode = state.mode, idx = state.levelIdx) {
    state.mode = mode;
    state.levelIdx = idx;
    let p, banner;
    if (mode === 'level') {
      const L = LEVELS[idx];
      world = levelWorld(L);
      rng = mulberry32(1000 + idx * 7919);
      lanternRng = mulberry32(5000 + idx * 104729);
      p = withUpgrades({ speed: L.speed, lightR: L.lightR, memory: L.memory, ambient: L.ambient });
      banner = { text: `Level ${idx + 1}: ${L.name}`, sub: L.tip, age: 0 };
    } else {
      world = ENDLESS_WORLD;
      rng = Math.random;
      lanternRng = Math.random;
      p = endlessParams(1);
      banner = { text: 'Endless', sub: 'How far can you go?', age: 0 };
    }
    resetWorld();
    Object.assign(state, {
      screen: 'play', distance: 0, level: 1, params: p, speed: p.speed,
      bonus: 0, lanterns: 0, lanternTotal: 0, newBest: false, coinsEarned: 0,
      boatX: W / 2, boatTilt: 0, invuln: 0, marks: [], foam: [], boost: 0,
      lanternsList: [], nextLanternW: LANTERN_EVERY, popups: [], edge: 0, reason: '', playTime: 0,
      banner, levelStars: 0, firstClear: false, revived: false, beforeCrash: null,
    });
    ads.preload();
    sfx.start();
    vibrate(30);
  }

  function winLevel() {
    state.screen = 'win';
    state.overAt = state.time;
    const i = state.levelIdx;
    const total = Math.max(1, state.lanternTotal);
    const stars = state.lanterns >= total ? 3 : state.lanterns >= total / 2 ? 2 : 1;
    state.levelStars = stars;
    state.firstClear = !(save.stars[i] > 0);
    state.coinsEarned = state.lanterns + (state.firstClear ? 10 + 5 * (i + 1) : 0);
    save.stars[i] = Math.max(save.stars[i] || 0, stars);
    save.coins += state.coinsEarned;
    save.lanternsTotal += state.lanterns;
    persist();
    sfx.saved();
    setTimeout(() => sfx.lantern(), 250);
    vibrate([40, 40, 80]);
  }

  function crash(reason) {
    if (!playing() || state.invuln > 0) return;
    state.screen = 'over';
    state.reason = reason;
    state.overAt = state.time;
    state.shake = 12;
    sfx.over();
    vibrate([100, 60, 140]);
    // Keep a copy of the save, so reviving can take back this run's coins and score
    // (they're counted again when the revived run ends).
    state.beforeCrash = state.revived ? null : JSON.parse(JSON.stringify(save));

    const s = score();
    if (state.mode === 'level') {
      state.coinsEarned = state.lanterns;
      save.coins += state.coinsEarned;
      save.lanternsTotal += state.lanterns;
      persist();
      return;
    }
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

  // ---------- Revive (once per run, by watching an ad) ----------
  const canRevive = () => !state.revived && state.beforeCrash && (state.mode === 'endless' || state.distance < finishW());
  function watchAdToRevive() {
    if (!canRevive()) return;
    state.screen = 'ad';
    state.adAt = state.time;
    ads.show((ok) => {
      if (state.screen !== 'ad') return;
      if (ok) revive();
      else { state.screen = 'over'; state.overAt = state.time - 1; toast('No ad right now, sorry. Try again later.'); }
    });
  }
  function revive() {
    Object.assign(save, state.beforeCrash); // undo the coins and score from the crash
    persist();
    state.beforeCrash = null;
    state.revived = true;
    // Put the boat back in the middle of open water: in a split, the side without rocks.
    const d = state.distance;
    const p = riverAt(d);
    if (p.island > 2) {
      let side = state.boatX < p.x ? -1 : 1;
      if (blockers.some((b) => b.side === side && b.w > d - 40 && b.w < d + 450)) side = -side;
      state.boatX = channelCenter(d, side);
    } else {
      state.boatX = p.x;
    }
    Object.assign(state, {
      screen: 'play', invuln: 3, boatTilt: 0, edge: 0, boost: 0, shake: 0, coinsEarned: 0, newBest: false,
      steerId: null, joy: null, lightId: null, finger: null,
      banner: { text: 'Revived!', sub: 'Safe for 3 seconds', age: 0 },
    });
    last = performance.now();
    sfx.start();
    vibrate(40);
  }

  // ---------- Buttons (menus are drawn on the canvas) ----------
  let buttons = [];
  function go(screen) {
    state.screen = screen;
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

    if (playing() && hit({ x: p.x, y: p.y - SAFE_TOP }, PAUSE_BTN)) { pause(); return; }
    if (!playing()) {
      if ((state.screen === 'over' || state.screen === 'win') && state.time - state.overAt < 0.6) return;
      if (state.pendingTap) return;
      p.y -= uiShift(); // buttons are drawn shifted down by this much
      for (const b of buttons) {
        if (!b.disabled && hit(p, b)) {
          state.press = { x: b.x, y: b.y, w: b.w, h: b.h, fn: b.onTap, id: e.pointerId, t: state.time, px: p.x, py: p.y, up: null };
          sfx.click();
          vibrate(8);
          break;
        }
      }
      return;
    }

    const isSteer = !hasTouch || e.pointerType === 'mouse' || p.y >= PAD_TOP;
    if (isSteer && state.steerId === null) {
      state.steerId = e.pointerId;
      // The joystick appears under your thumb
      const onPad = hasTouch && e.pointerType !== 'mouse';
      state.joy = onPad
        ? { ox: Math.max(JOY_R + 8, Math.min(W - JOY_R - 8, p.x)), oy: Math.max(PAD_TOP + JOY_R - 10, Math.min(H - 30, p.y)), kx: 0, ky: 0 }
        : { ox: p.x, oy: p.y, kx: 0, ky: 0 }; // mouse: the joystick sits where you clicked
      setKnob(p);
    } else if (!isSteer && state.lightId === null) {
      state.lightId = e.pointerId;
      state.finger = p;
      sfx.click();
    }
  }

  const PAUSE_BTN = { x: W - 54, y: 10, w: 44, h: 40 };
  function pause() {
    if (!playing()) return;
    state.screen = 'paused';
    state.steerId = null; state.joy = null;
    state.lightId = null; state.finger = null;
    sfx.click();
  }
  function resume() {
    state.screen = 'play';
    last = performance.now();
  }
  const CENTRED = ['how', 'scores', 'over', 'win', 'paused', 'ad'];
  function uiShift() {
    if (playing()) return SAFE_TOP;
    const extra = Math.max(0, H - SAFE_TOP - 640);
    if (CENTRED.includes(state.screen)) return SAFE_TOP + extra / 2;
    if (state.screen === 'menu') return SAFE_TOP + extra * 0.35;
    return SAFE_TOP;
  }
  const hit = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  function setKnob(p) {
    const j = state.joy;
    if (!j) return;
    let dx = p.x - j.ox, dy = p.y - j.oy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
    j.kx = dx; j.ky = dy;
  }

  function onMove(e) {
    const p = toGame(e);
    const pr = state.press;
    if (pr && pr.up == null && e.pointerId === pr.id &&
        !hit({ x: p.x, y: p.y - uiShift() }, { x: pr.x - 12, y: pr.y - 12, w: pr.w + 24, h: pr.h + 24 })) {
      state.press = null; // slid off the button: cancel
    }
    if (e.pointerId === state.steerId) {
      setKnob(p);
    } else if (e.pointerId === state.lightId) {
      state.finger = p;
    }
  }

  function onUp(e) {
    const pr = state.press;
    if (pr && pr.up == null && e.pointerId === pr.id) {
      pr.up = state.time;
      state.pendingTap = { fn: pr.fn, at: state.time + 0.1 }; // let the press show before the screen changes
    }
    if (e.pointerId === state.steerId) { state.steerId = null; state.joy = null; } // the boat keeps going straight
    if (e.pointerId === state.lightId) { state.lightId = null; state.finger = null; }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space' && !e.repeat && (state.screen === 'menu' || state.screen === 'over')) startGame(state.screen === 'menu' ? 'endless' : state.mode);
    if (e.code === 'Escape') { if (playing()) pause(); else if (state.screen === 'paused') resume(); else go('menu'); }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  const menuSweep = () => !playing() && !['over', 'win', 'paused', 'ad'].includes(state.screen);
  function spotTarget() {
    if (menuSweep()) return { x: W / 2 + Math.sin(state.time * 0.55) * 120, y: 330 + Math.sin(state.time * 0.9) * 150 };
    if (state.finger) return { x: state.finger.x, y: Math.max(20, state.finger.y - HELI_OFFSET) };
    if (!hasTouch && playing()) return { x: state.boatX, y: BOAT_Y - 140 };
    return null;
  }

  // ---------- Update ----------
  function update(dt) {
    state.time += dt;
    if (state.pendingTap && state.time >= state.pendingTap.at) {
      const fn = state.pendingTap.fn;
      state.pendingTap = null;
      fn();
    }
    if (state.press && state.press.up != null && state.time - state.press.up > 0.5) state.press = null;
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

      const lvl = 1 + Math.floor(state.distance / ENDLESS_STEP);
      if (state.mode === 'endless' && lvl !== state.level) {
        state.level = lvl;
        state.params = endlessParams(lvl);
        state.banner = { text: `Stage ${lvl}`, sub: 'The night gets darker', age: 0 };
        sfx.level();
        vibrate(40);
      }
      state.speed += (state.params.speed - state.speed) * Math.min(1, dt * 0.8);
      // Joystick: sideways steers, forward boosts. Pulling back does nothing (no brake).
      let steer = 0, push = 0;
      if (state.joy) {
        steer = state.joy.kx / JOY_R;
        push = Math.max(0, -state.joy.ky / JOY_R);
        if (Math.abs(steer) < 0.08) steer = 0;
      }
      if (keys.ArrowLeft || keys.KeyA) steer = -1;
      if (keys.ArrowRight || keys.KeyD) steer = 1;
      if (keys.ArrowUp || keys.KeyW) push = 1;
      state.boatX += steer * STEER_SPEED * dt;
      state.boatTilt += (steer * 0.45 - state.boatTilt) * Math.min(1, dt * 8);
      state.boost += (push - state.boost) * Math.min(1, dt * 5);
      state.distance += state.speed * (1 + BOOST * state.boost) * dt;
      if (state.distance >= finishW()) { winLevel(); return; }

      state.boatX = Math.max(8, Math.min(W - 8, state.boatX));

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

      if (Math.random() < dt * (40 + 60 * state.boost)) {
        state.foam.push({ x: state.boatX + (Math.random() - 0.5) * 8, w: state.distance - 16, age: 0, life: 0.9 + Math.random() * 0.5, side: Math.random() < 0.5 ? -1 : 1 });
      }

      // Lanterns, kept out of a blocked channel
      const aheadW = state.distance + BOAT_Y + 40;
      while (state.nextLanternW < Math.min(aheadW, finishW() - 150)) {
        const lw = state.nextLanternW;
        state.lanternTotal++;
        const fp = riverAt(lw);
        let x;
        if (fp.island > 2) {
          // In a split: put it in the middle of a channel (never on the island),
          // and never in a blocked channel, before or behind the log.
          let side = lanternRng() < 0.5 ? -1 : 1;
          if (blockers.some((b) => b.side === side && lw > b.w - 350 && lw < b.w + 700)) side = -side;
          x = channelCenter(lw, side);
        } else {
          x = fp.x + (lanternRng() - 0.5) * fp.width * 0.5;
        }
        state.lanternsList.push({ w: lw, dx: x - fp.x, phase: Math.random() * 6, alive: true });
        state.nextLanternW += LANTERN_EVERY * (0.7 + lanternRng() * 0.6);
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
    } else if (!['over', 'win', 'paused', 'ad'].includes(state.screen)) {
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

    drawFinish();
    drawRoadAndHarbor();

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

  // The finish: a wooden dock across the river with two lamp posts
  function drawFinish() {
    if (state.mode !== 'level') return;
    const fw = finishW();
    const y = toScreenY(fw);
    if (y < -60 || y > H + 60) return;
    const p = riverAt(fw);
    const x0 = p.x - p.width / 2 - 14, x1 = p.x + p.width / 2 + 14;
    ctx.fillStyle = '#5b3d22';
    ctx.fillRect(x0, y - 9, x1 - x0, 18);
    ctx.fillStyle = '#7a5532';
    for (let x = x0; x < x1; x += 10) ctx.fillRect(x + 1, y - 8, 8, 16);
    for (let k = 0; k < Math.floor((x1 - x0) / 14); k++) {
      ctx.fillStyle = k % 2 ? '#f2f0e8' : '#22262b';
      ctx.fillRect(x0 + k * 14, y - 14, 14, 5);
    }
  }
  // Fixed lights in the world: the harbour you start from, and street lamps on levels that have a road
  const HARBOR = [{ w: 30, side: -1 }, { w: 30, side: 1 }, { w: 170, side: -1 }, { w: 170, side: 1 }];
  function worldLights() {
    const out = [];
    const lo = toWorld(H + 120), hi = toWorld(-120);
    for (const l of HARBOR) {
      if (l.w < lo || l.w > hi) continue;
      const p = riverAt(l.w);
      out.push({ x: p.x + l.side * (p.width / 2 - 26), y: toScreenY(l.w), r: 95 });
    }
    const road = world.road;
    if (road) {
      for (let w = 260; w <= road.until; w += road.every) {
        if (w < lo || w > hi) continue;
        const p = riverAt(w);
        out.push({ x: p.x + road.side * (p.width / 2 + 16), y: toScreenY(w), r: 88, post: true });
      }
    }
    return out;
  }

  function drawRoadAndHarbor() {
    const road = world.road;
    if (road) {
      // The road runs beside the river, then bends away into the forest after the last lamp.
      const off = (w) => 22 + Math.max(0, w - road.until - 60) ** 1.35 * 0.35;
      const edgeX = (w, k) => { const q = riverAt(w); return q.x + road.side * (q.width / 2 + off(w) + k); };
      const lo = Math.max(0, wBottom()), hi = Math.min(wTop(), road.until + 420);
      if (hi > lo) {
        const stepW = 6;
        ctx.fillStyle = '#5a5039'; // gravel verge
        ctx.beginPath();
        for (let w = lo; w <= hi; w += stepW) { const y = toScreenY(w); w === lo ? ctx.moveTo(edgeX(w, -4), y) : ctx.lineTo(edgeX(w, -4), y); }
        for (let w = hi; w >= lo; w -= stepW) ctx.lineTo(edgeX(w, 42), toScreenY(w));
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3b3b3e'; // asphalt
        ctx.beginPath();
        for (let w = lo; w <= hi; w += stepW) { const y = toScreenY(w); w === lo ? ctx.moveTo(edgeX(w, 0), y) : ctx.lineTo(edgeX(w, 0), y); }
        for (let w = hi; w >= lo; w -= stepW) ctx.lineTo(edgeX(w, 38), toScreenY(w));
        ctx.closePath(); ctx.fill();
        // centre dashes, each one pinned to a spot on the road so they scroll with the world
        ctx.strokeStyle = 'rgba(240,220,150,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let w = Math.ceil(lo / 24) * 24; w <= hi; w += 24) {
          ctx.moveTo(edgeX(w, 19), toScreenY(w));
          ctx.lineTo(edgeX(w + 11, 19), toScreenY(w + 11));
        }
        ctx.stroke();
      }
    }
    // harbour piers sticking out from both banks
    for (const l of HARBOR) {
      const y = toScreenY(l.w);
      if (y < -40 || y > H + 40) continue;
      const p = riverAt(l.w);
      const bank = p.x + l.side * (p.width / 2 + 8);
      const tip = p.x + l.side * (p.width / 2 - 34);
      const a = Math.min(bank, tip), b = Math.max(bank, tip);
      ctx.fillStyle = '#4e3520';
      ctx.fillRect(a, y - 9, b - a, 18);
      ctx.fillStyle = '#6b4a2c';
      for (let x = a; x < b - 4; x += 8) ctx.fillRect(x + 1, y - 8, 6, 16);
      ctx.fillStyle = '#2a1c10';
      ctx.fillRect(a, y + 8, 4, 4); ctx.fillRect(b - 4, y + 8, 4, 4);
    }
  }

  function drawWorldLights() {
    if (!(playing() || state.screen === 'paused')) return;
    for (const L of worldLights()) {
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      g.addColorStop(0, 'rgba(255,205,130,0.22)');
      g.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2); ctx.fill();
      if (L.post) { ctx.fillStyle = '#1d1d1f'; ctx.fillRect(L.x - 1.5, L.y - 2, 3, 12); }
      ctx.fillStyle = '#fff1c9';
      ctx.beginPath(); ctx.arc(L.x, L.y - 3, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Small red warning lights on a blocking log: they show that a way is blocked, not where the river goes
  function drawBlockerLights() {
    if (!(playing() || state.screen === 'paused')) return;
    const on = Math.sin(state.time * 6) > -0.2;
    for (const b of blockers) {
      const y = toScreenY(b.w);
      if (y < -30 || y > H + 30) continue;
      const p = riverAt(b.w);
      if (p.island < 10) continue;
      const inner = p.x + b.side * p.island, outer = p.x + b.side * p.width / 2;
      for (const t of [0.3, 0.7]) {
        const x = inner + (outer - inner) * t;
        const g = ctx.createRadialGradient(x, y - 6, 0, x, y - 6, 16);
        g.addColorStop(0, `rgba(255,70,50,${on ? 0.8 : 0.3})`);
        g.addColorStop(1, 'rgba(255,70,50,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y - 6, 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = on ? '#ff8a70' : '#8a3a30';
        ctx.beginPath(); ctx.arc(x, y - 6, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawFinishLights() {
    if (state.mode !== 'level' || !playing()) return;
    const fw = finishW();
    const y = toScreenY(fw);
    if (y < -60 || y > H + 60) return;
    const p = riverAt(fw);
    for (const side of [-1, 1]) {
      const x = p.x + side * (p.width / 2 + 14);
      const g = ctx.createRadialGradient(x, y - 16, 0, x, y - 16, 40);
      g.addColorStop(0, 'rgba(160,255,190,0.85)');
      g.addColorStop(1, 'rgba(160,255,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y - 16, 40, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e9fff0';
      ctx.beginPath(); ctx.arc(x, y - 16, 4, 0, Math.PI * 2); ctx.fill();
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
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(0, -18, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawHelicopter() {
    const target = playing() || menuSweep() ? spotTarget() : null;
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
    const amb = playing() || state.screen === 'paused' ? state.params.ambient : menuSweep() ? 0.8 : 0.55;
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
    if (playing() || state.screen === 'paused') {
      const mem = state.params.memory;
      for (const m of state.marks) {
        const a = 1 - (state.time - m.t) / mem;
        hole(m.x, toScreenY(m.w), m.r * 0.9, 0.12 * a);
      }
      for (const L of worldLights()) hole(L.x, L.y, L.r, 0.9);
      if (state.mode === 'level') {
        const fy = toScreenY(finishW());
        if (fy > -80 && fy < H + 80) { const fp = riverAt(finishW()); for (const sd of [-1, 1]) hole(fp.x + sd * (fp.width / 2 + 14), fy - 16, 70, 0.8); }
      }
      hole(state.boatX, BOAT_Y - 10, state.params.lampR, 0.8);
      if (spotTarget()) hole(state.heli.x, state.heli.y, state.params.lightR, 1);
    } else if (menuSweep()) {
      hole(state.heli.x, state.heli.y, 115, 1);
    }
    dctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dark, 0, 0);
    ctx.restore();

    if ((playing() || menuSweep()) && spotTarget()) {
      const r = playing() ? state.params.lightR : 115;
      const { x, y } = state.heli;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(225,240,255,0.16)');
      g.addColorStop(1, 'rgba(225,240,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Supply crates bobbing on the water. They don't glow: you only see them where there is light.
  function drawLanterns() {
    for (const ln of state.lanternsList) {
      const x = riverAt(ln.w).x + ln.dx + Math.sin(state.time * 1.5 + ln.phase) * 2;
      const y = toScreenY(ln.w) + Math.sin(state.time * 2.2 + ln.phase) * 1.2;
      const rot = Math.sin(state.time * 1.1 + ln.phase) * 0.25 + ln.phase;
      // ripple ring
      ctx.strokeStyle = 'rgba(200,230,245,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(x, y + 2, 13, 9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-6, -4, 14, 12);
      ctx.fillStyle = '#9a6a3a';
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeStyle = '#5e3d1f';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.beginPath(); ctx.moveTo(-7, -2.3); ctx.lineTo(7, -2.3); ctx.moveTo(-7, 2.3); ctx.lineTo(7, 2.3); ctx.stroke();
      ctx.strokeStyle = '#d9b26b';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.stroke(); // rope
      ctx.restore();
    }
  }


  // ---------- Draw: UI ----------
  const C = { title: '#efe2bf', warm: '#ffc95c', soft: '#c3b394', dim: '#8a7c63', bad: '#ff8e66', good: '#b6e38a' };

  // Condensed face runs narrow, so UI text is drawn a touch larger than the size asked for
  function text(str, x, y, size, color = '#fff', align = 'center', weight = '800', font = UI_FONT) {
    const w = Number(weight) >= 700 ? 700 : 600;
    const px = font === UI_FONT ? Math.round(size * 1.12) : size;
    ctx.font = font === UI_FONT ? `${w} ${px}px ${font}` : `${px}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, px / 7);
    ctx.strokeStyle = 'rgba(8,6,4,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function title(str, x, y, size, color = C.title, align = 'center') {
    text(str, x, y, size, color, align, '400', TITLE_FONT);
  }

  // A deterministic wobble so planks keep the same grain every frame
  const grain = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };

  // A nailed wooden plank, drawn centred on (cx, cy)
  function plankShape(cx, cy, w, h, rot, kind, seed) {
    const tones = {
      wood: ['#7a5636', '#5c3f26', '#3d2a19'],
      paint: ['#e3912f', '#c4721b', '#7c4610'],
      dead: ['#4b4641', '#3a3632', '#26231f'],
      dark: ['#3a2a1c', '#2b1f15', '#1a120b'],
    }[kind];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 5, w, h);
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, tones[0]);
    g.addColorStop(1, tones[1]);
    ctx.fillStyle = g;
    // slightly uneven ends, like cut boards
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + 2 * grain(seed));
    ctx.lineTo(w / 2 - 3 * grain(seed + 1), -h / 2);
    ctx.lineTo(w / 2, h / 2 - 2 * grain(seed + 2));
    ctx.lineTo(-w / 2 + 3 * grain(seed + 3), h / 2);
    ctx.closePath();
    ctx.fill();
    // grain lines
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const yy = -h / 2 + h * (0.2 + 0.2 * k) + grain(seed + k * 7) * 4 - 2;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 4, yy);
      ctx.bezierCurveTo(-w / 6, yy + 3 * grain(seed + k), w / 6, yy - 3 * grain(seed + k + 9), w / 2 - 4, yy);
      ctx.stroke();
    }
    if (kind === 'paint') {
      // worn spots where the paint has chipped
      ctx.fillStyle = 'rgba(110,70,30,0.35)';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.ellipse(-w / 2 + 16 + (w - 32) * grain(seed + k * 3), -h / 2 + 4 + (h - 8) * grain(seed + k * 5), 2 + 3 * grain(seed + k), 1 + 1.5 * grain(seed + k + 2), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(-w / 2 + 2, -h / 2 + 1, w - 4, 2);
    // nails
    for (const nx of [-w / 2 + 11, w / 2 - 11]) {
      ctx.fillStyle = tones[2];
      ctx.beginPath(); ctx.arc(nx, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(nx - 1, -1, 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Buttons are planks. opts: primary, disabled, size, rot, sub (small text on the right), align
  // How pressed a button is right now: 1 while the finger is on it, easing back after release
  function pressAmount(x, y, w, h) {
    const p = state.press;
    if (!p || p.x !== x || p.y !== y || p.w !== w || p.h !== h) return 0;
    return p.up == null ? 1 : Math.max(0, 1 - (state.time - p.up) / 0.14);
  }
  // Darken the pressed area and send a ripple out from the finger
  function pressFx(x, y, w, h, rot = 0, amount = 1) {
    const p = state.press;
    if (!p) return;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(rot);
    ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
    ctx.fillStyle = `rgba(0,0,0,${0.2 * amount})`;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    const age = state.time - p.t;
    const r = 12 + age * 520;
    const a = Math.max(0, 0.45 - age * 0.9);
    if (a > 0) {
      ctx.fillStyle = `rgba(255,236,190,${a})`;
      ctx.beginPath(); ctx.arc(p.px - (x + w / 2), p.py - (y + h / 2), r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function button(x, y, w, h, label, onTap, opts = {}) {
    buttons.push({ x, y, w, h, onTap, disabled: opts.disabled });
    const pr = opts.disabled ? 0 : pressAmount(x, y, w, h);
    ctx.save();
    if (pr) {
      // pushed in: a little smaller and lower, as if pressed into the post
      const cx = x + w / 2, cy = y + h / 2;
      ctx.translate(cx, cy + 3 * pr);
      ctx.scale(1 - 0.04 * pr, 1 - 0.04 * pr);
      ctx.translate(-cx, -cy);
    }
    const kind = opts.disabled ? 'dead' : opts.primary ? 'paint' : 'wood';
    const rot = opts.rot || 0;
    plankShape(x + w / 2, y + h / 2, w, h, rot, kind, x * 0.13 + y * 0.07);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(rot);
    const ink = opts.disabled ? '#8d877f' : opts.primary ? '#2b1706' : '#f1e3c2';
    const size = opts.size || 18;
    ctx.fillStyle = ink;
    ctx.textBaseline = 'middle';
    if (opts.title) {
      ctx.font = `${size}px ${TITLE_FONT}`;
    } else {
      ctx.font = `700 ${Math.round(size * 1.12)}px ${UI_FONT}`;
    }
    try { ctx.letterSpacing = opts.title ? '1px' : '0.5px'; } catch { /* older browsers */ }
    const left = opts.align === 'left';
    if (opts.coin) {
      const tw = ctx.measureText(label).width;
      ctx.restore(); ctx.save();
      ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot);
      coin(-tw / 2 - 6, 0, 7);
      ctx.fillStyle = ink;
      ctx.font = `700 ${Math.round(size * 1.12)}px ${UI_FONT}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(label, 8, 1);
    } else {
      ctx.textAlign = left ? 'left' : 'center';
      ctx.fillText(label, left ? -w / 2 + 24 : 0, 1);
    }
    if (opts.sub) {
      ctx.font = `600 ${Math.round(size * 0.62)}px ${UI_FONT}`;
      ctx.textAlign = 'right';
      ctx.globalAlpha = 0.85;
      ctx.fillText(opts.sub, w / 2 - 24, 2);
    }
    try { ctx.letterSpacing = '0px'; } catch { /* ignore */ }
    ctx.restore();
    if (pr) pressFx(x, y, w, h, opts.rot || 0, pr);
    ctx.restore();
  }

  // Panels are dark boards: planks laid side by side, with nails at the corners
  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x + 4, y + 6, w, h);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#2a1f16');
    g.addColorStop(1, '#1d1610');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.5;
    for (let yy = y + 44; yy < y + h - 6; yy += 44) {
      ctx.beginPath(); ctx.moveTo(x + 2, yy); ctx.lineTo(x + w - 2, yy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,230,190,0.05)';
    for (let yy = y + 46; yy < y + h - 6; yy += 44) {
      ctx.beginPath(); ctx.moveTo(x + 2, yy); ctx.lineTo(x + w - 2, yy); ctx.stroke();
    }
    ctx.strokeStyle = '#4a3624';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    for (const [nx, ny] of [[x + 10, y + 10], [x + w - 10, y + 10], [x + 10, y + h - 10], [x + w - 10, y + h - 10]]) {
      ctx.fillStyle = '#120c07';
      ctx.beginPath(); ctx.arc(nx, ny, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(nx - 1, ny - 1, 1, 0, Math.PI * 2); ctx.fill();
    }
  }

  function coin(x, y, r = 7) {
    ctx.fillStyle = '#f2c45a';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b8862a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r - 2.5, 0, Math.PI * 2); ctx.stroke();
  }

  function crateIcon(x, y) {
    ctx.fillStyle = '#9a6a3a';
    ctx.fillRect(x - 6, y - 6, 12, 12);
    ctx.strokeStyle = '#5e3d1f'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 6, y - 6, 12, 12);
    ctx.strokeStyle = '#d9b26b'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.stroke();
  }

  function coinBadge(x, y) {
    const label = String(save.coins);
    ctx.font = `700 17px ${UI_FONT}`;
    const w = ctx.measureText(label).width + 38;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - w + 2, y - 12, w, 28);
    ctx.fillStyle = '#2a1f16';
    ctx.fillRect(x - w, y - 14, w, 28);
    ctx.strokeStyle = '#4a3624'; ctx.lineWidth = 2;
    ctx.strokeRect(x - w + 1, y - 13, w - 2, 26);
    coin(x - w + 16, y);
    text(label, x - 10, y + 1, 16, C.warm, 'right');
  }

  function backButton(to = 'menu') {
    button(14, 16, 86, 38, '‹ BACK', () => go(to), { size: 15, rot: -0.03 });
  }

  function totalStars() { return save.stars.reduce((a, b) => a + (b || 0), 0); }

  // Main menu: a signpost on the riverbank, lit by a hanging lantern,
  // while the patrol helicopter sweeps its searchlight over the water behind.
  function drawMenu() {
    coinBadge(W - 16, 34);
    text('RIVER PATROL  ·  SECTOR 7', 28, 60, 12, C.soft, 'left', '700');
    title('NIGHT', 24, 108, 62, '#efe2bf', 'left');
    title('WATCH', 24, 168, 62, '#ffc95c', 'left');

    // the post the signs are nailed to
    const px = 46;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px + 4, 214, 18, H);
    const pg = ctx.createLinearGradient(px, 0, px + 18, 0);
    pg.addColorStop(0, '#4a3220'); pg.addColorStop(1, '#2c1d12');
    ctx.fillStyle = pg;
    ctx.fillRect(px, 210, 18, H);

    // lantern hanging from the post
    const lx = px + 9, ly = 226 + Math.sin(state.time * 1.3) * 1.5;
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 120);
    lg.addColorStop(0, 'rgba(255,190,90,0.33)');
    lg.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(lx, ly, 120, 0, Math.PI * 2); ctx.fill();

    const stars = `★ ${totalStars()}/${LEVELS.length * 3}`;
    button(30, 240, 262, 66, 'LEVELS', () => go('levels'), { primary: true, size: 26, rot: -0.025, align: 'left', sub: stars, title: true });
    button(30, 320, 236, 56, 'ENDLESS', () => startGame('endless'), { size: 22, rot: 0.018, align: 'left', sub: save.best ? `BEST ${save.best}` : '', title: true });
    button(30, 392, 168, 46, 'SHOP', () => go('shop'), { size: 17, rot: -0.02, align: 'left' });
    button(30, 448, 196, 46, 'HIGH SCORES', () => go('scores'), { size: 17, rot: 0.015, align: 'left' });
    button(30, 504, 186, 46, 'HOW TO PLAY', () => go('how'), { size: 17, rot: -0.012, align: 'left' });

    // the lantern itself, in front of the top sign
    ctx.fillStyle = '#1b130c';
    ctx.fillRect(lx - 1, 212, 2, ly - 220);
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(lx - 7, ly - 8, 14, 3);
    ctx.fillStyle = '#ffd98a';
    ctx.fillRect(lx - 5, ly - 5, 10, 11);
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(lx - 7, ly + 6, 14, 3);

  }

  function star(x, y, r, on) {
    ctx.fillStyle = on ? '#f2c45a' : 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5;
      const rr = k % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Levels: a map of the river with a numbered buoy for each level, start at the bottom
  const right0 = (x) => x < W / 2;
  function levelNode(i) {
    const bottom = H - SAFE_TOP - 50, gap = Math.min(64, (bottom - 110) / 9);
    return { x: W / 2 + Math.sin(i * 1.15 + 0.4) * 92, y: bottom - i * gap };
  }

  function drawLevels() {
    // dim the world and draw the map on top
    ctx.fillStyle = 'rgba(10,8,5,0.6)';
    ctx.fillRect(0, -SAFE_TOP, W, H + SAFE_TOP);
    backButton();
    coinBadge(W - 16, 34);
    title('LEVELS', W / 2, 36, 26, C.title);
    text(`★ ${totalStars()} / ${LEVELS.length * 3}`, W / 2, 66, 14, C.warm, 'center', '700');

    // the river route through all the buoys
    const pts = LEVELS.map((_, i) => levelNode(i));
    const route = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, H + 20);
      ctx.lineTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        ctx.bezierCurveTo(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, b.x, b.y);
      }
      ctx.lineTo(pts[pts.length - 1].x, 70);
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4e4433'; ctx.lineWidth = 40; route(); ctx.stroke();
    ctx.strokeStyle = '#1f4a63'; ctx.lineWidth = 30; route(); ctx.stroke();
    ctx.strokeStyle = 'rgba(190,225,240,0.18)'; ctx.lineWidth = 2;
    ctx.setLineDash([6, 12]); ctx.lineDashOffset = -state.time * 12; route(); ctx.stroke(); ctx.setLineDash([]);

    const next = LEVELS.findIndex((_, i) => !(save.stars[i] > 0));
    LEVELS.forEach((L, i) => {
      const { x, y } = pts[i];
      const open = levelUnlocked(i);
      const done = (save.stars[i] || 0) > 0;
      if (i === next && open) {
        const pulse = 0.5 + 0.5 * Math.sin(state.time * 4);
        const g = ctx.createRadialGradient(x, y, 0, x, y, 40);
        g.addColorStop(0, `rgba(255,201,92,${0.35 + 0.3 * pulse})`);
        g.addColorStop(1, 'rgba(255,201,92,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI * 2); ctx.fill();
      }
      // buoy: white = open, green = done, grey = locked. Shrinks a little while pressed.
      const bx = right0(x) ? x - 26 : x - 124;
      const pr = pressAmount(bx, y - 24, 150, 48);
      const r = 18 * (1 - 0.12 * pr);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = !open ? '#57524c' : done ? '#3f8f58' : '#f3ecdb';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      if (pr) { ctx.fillStyle = `rgba(0,0,0,${0.2 * pr})`; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      if (open) text(String(i + 1), x, y + 1, 15, done ? '#f3ecdb' : '#2a1a0c', 'center', '700');
      else { // little padlock
        ctx.strokeStyle = '#2a2724'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y - 2, 4, Math.PI, 0); ctx.stroke();
        ctx.fillStyle = '#2a2724'; ctx.fillRect(x - 6, y - 2, 12, 9);
      }

      const right = x < W / 2;
      const tx = right ? x + 28 : x - 28;
      const al = right ? 'left' : 'right';
      text(open ? L.name.toUpperCase() : 'LOCKED', tx, y - 7, 13, open ? '#efe2bf' : '#6f665a', al, '700');
      if (open) {
        for (let k = 0; k < 3; k++) {
          const sx = right ? tx + 6 + k * 15 : tx - 6 - (2 - k) * 15;
          star(sx, y + 11, 6, k < (save.stars[i] || 0));
        }
      }
      buttons.push({ x: x - 26, y: y - 24, w: 150, h: 48, onTap: open ? () => startGame('level', i) : () => { sfx.nope(); toast(`Finish level ${i} to unlock`); } });
      if (!right) buttons[buttons.length - 1].x = x - 124;
    });
  }

  function drawHow() {
    backButton();
    panel(20, 70, W - 40, 470);
    title('HOW TO PLAY', W / 2, 106, 24, C.title);
    const rows = [
      ['Steer the boat', 'Put your thumb on the bottom pad: a joystick appears. Left and right steer, push up to go faster. Let go and the boat goes straight.'],
      ['Fly the helicopter', 'Touch anywhere above the pad with another finger. Its spotlight shows the river.'],
      ['Remember the river', 'Lit spots stay visible for a moment, so scout ahead, then steer.'],
      ['Supply crates', 'They float in the dark. Light them up to find them, then steer into them: +10 points and 1 coin each.'],
      ['The river splits', 'Pick a side. A fallen log can block one way: look for its blinking red lights, or light it up first.'],
      ['Levels', 'Reach the dock to finish. Floating supply crates give stars: half of them for 2 stars, all for 3.'],
      ['Endless', 'It gets darker and faster until you crash. Coins: 1 per crate and 1 per 50 points.'],
    ];
    let y = 142;
    for (const [head, body] of rows) {
      text(head, 40, y, 16, C.warm, 'left', '700');
      y = wrap(body, 40, y + 20, W - 80, 13, C.soft) + 28;
    }
    button(70, 556, W - 140, 50, 'PLAY', () => go('levels'), { primary: true, size: 20 });
  }

  function wrap(str, x, y, maxW, size, color) {
    ctx.font = `600 ${Math.round(size * 1.12)}px ${UI_FONT}`; // same size text() draws at
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
    title('SHOP', W / 2, 36, 24, C.title);
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
      button(x + w - 92, y + 10, 82, 32, maxed ? 'MAX' : String(u.costs[lvl]), () => buyUpgrade(u), { size: 14, disabled: maxed, primary: !maxed && save.coins >= u.costs[lvl], coin: !maxed });
      y += 60;
    }
    y += 8;
    text('BOATS', x, y, 12, C.dim, 'left', '700');
    y += 12;
    const cw = (w - 8 * (BOATS.length - 1)) / BOATS.length;
    BOATS.forEach((b, i) => {
      const bx = x + i * (cw + 8);
      const owned = save.boats.includes(b.id);
      const on = save.boat === b.id;
      const bpr = pressAmount(bx, y, cw, 112);
      panel(bx, y + 2 * bpr, cw, 112);
      if (on) { ctx.strokeStyle = C.warm; ctx.lineWidth = 3; ctx.strokeRect(bx + 1.5, y + 1.5, cw - 3, 109); }
      drawBoat(bx + cw / 2, y + 40, 0, 0, b.id, 1.05);
      if (!owned) coin(bx + cw / 2 - 16, y + 92, 5);
      text(on ? 'IN USE' : owned ? 'USE' : String(b.cost), bx + cw / 2 + (owned ? 0 : 5), y + 92, 12, on ? C.warm : owned ? '#fff' : (save.coins >= b.cost ? C.warm : C.dim), 'center', '700');
      buttons.push({ x: bx, y, w: cw, h: 112, onTap: () => tapBoat(b) });
      if (bpr) pressFx(bx, y + 2 * bpr, cw, 112, 0, bpr);
    });
    text(boatSkin(save.boat).name, W / 2, y + 130, 13, C.soft, 'center', '600');
    text('Earn coins from supply crates and points in every run.', W / 2, H - SAFE_TOP - 28, 12, C.dim, 'center', '500');
  }

  function drawScores() {
    backButton();
    title('SCORES', W / 2, 36, 24, C.title);
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
    text(`Endless runs ${save.runs}  ·  Crates ${save.lanternsTotal}  ·  Stars ${totalStars()}`, W / 2, 560, 12, C.soft, 'center', '600');
    button(70, 580, W - 140, 46, 'PLAY ENDLESS', () => startGame('endless'), { primary: true, size: 18 });
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

  function drawPad() {
    if (hasTouch) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, PAD_TOP, W, H - PAD_TOP);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, PAD_TOP); ctx.lineTo(W, PAD_TOP); ctx.stroke();
      ctx.setLineDash([]);
      drawJoystick();
      if (state.playTime < 6 && !state.joy) {
        text('touch above to fly the helicopter', W / 2, PAD_TOP - 18, 13, 'rgba(255,255,255,0.6)', 'center', '600');
      }
    }
  }

  function drawPlayHUD() {
    if (state.mode === 'level') {
      // Progress bar to the dock
      const t = Math.min(1, state.distance / finishW());
      const bx = 70, bw = W - 140;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(bx, 40, bw, 6);
      ctx.fillStyle = C.warm;
      ctx.fillRect(bx, 40, bw * t, 6);
      ctx.fillStyle = '#a0ffbe';
      ctx.fillRect(bx + bw - 3, 34, 3, 18);
      text(`Level ${state.levelIdx + 1}`, 14, 30, 14, C.warm, 'left', '700');
    } else {
      text(String(score()), W / 2, 46, 40);
      text(`Stage ${state.level}`, 14, 30, 14, C.warm, 'left', '700');
    }
    crateIcon(W - 104, 30);
    text(String(state.lanterns), W - 92, 31, 14, C.warm, 'left', '700');
    // pause button (handled in onDown, not in the buttons list, since play input is separate)
    const pb = PAUSE_BTN;
    plankShape(pb.x + pb.w / 2, pb.y + pb.h / 2, pb.w, pb.h, 0.03, 'wood', 7);
    ctx.fillStyle = '#f1e3c2';
    ctx.fillRect(pb.x + 15, pb.y + 12, 5, 16);
    ctx.fillRect(pb.x + 25, pb.y + 12, 5, 16);
    if (state.banner) {
      const a = Math.min(1, state.banner.age * 4, (2.4 - state.banner.age) * 2);
      ctx.globalAlpha = Math.max(0, a);
      text(state.banner.text, W / 2, 150, state.banner.text.length > 18 ? 24 : 32, C.title);
      wrapCenter(state.banner.sub, W / 2, 186, W - 60, 15, '#e6eef4');
      ctx.globalAlpha = 1;
    }
    ctx.translate(0, -SAFE_TOP); // pop-ups float where the crate was, in world position
    for (const p of state.popups) {
      ctx.globalAlpha = 1 - p.age / 0.9;
      if (state.mode === 'level') { // in levels a crate is worth a coin
        coin(p.x - 12, p.y, 7);
        text('+1', p.x + 2, p.y + 1, 20, C.warm, 'left');
      } else { // in endless it adds to the score
        text(`+${LANTERN_BONUS}`, p.x, p.y, 20, C.warm);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawJoystick() {
    const j = state.joy;
    const ox = j ? j.ox : W / 2, oy = j ? j.oy : PAD_TOP + 70;
    const kx = j ? j.kx : 0, ky = j ? j.ky : 0;
    ctx.globalAlpha = j ? 0.95 : 0.5;
    // base ring with arrows: left, right, and forward = boost
    ctx.strokeStyle = 'rgba(239,226,191,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ox, oy, JOY_R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(ox, oy, JOY_R, 0, Math.PI * 2); ctx.fill();
    const arrow = (ax, ay, ang, col) => {
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    arrow(ox - JOY_R + 10, oy, Math.PI, 'rgba(239,226,191,0.7)');
    arrow(ox + JOY_R - 10, oy, 0, 'rgba(239,226,191,0.7)');
    arrow(ox, oy - JOY_R + 10, -Math.PI / 2, state.boost > 0.2 ? '#ffc95c' : 'rgba(255,201,92,0.8)');
    // knob
    ctx.fillStyle = state.boost > 0.2 ? '#e3912f' : '#7a5636';
    ctx.beginPath(); ctx.arc(ox + kx, oy + ky, 20, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ox + kx, oy + ky, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (!j && state.playTime < 6) text('STEER  ·  PUSH UP TO BOOST', ox, oy + JOY_R + 16, 12, 'rgba(239,226,191,0.75)', 'center', '700');
    if (state.boost > 0.2) text('BOOST', ox, oy - JOY_R - 14, 13, '#ffc95c', 'center', '700');
  }

  function wrapCenter(str, x, y, maxW, size, color) {
    ctx.font = `600 ${Math.round(size * 1.12)}px ${UI_FONT}`;
    const lines = [];
    let line = '';
    for (const word of str.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => text(l, x, y + i * (size + 6), size, color, 'center', '600'));
  }

  function drawOver() {
    if (state.mode === 'level') {
      const L = LEVELS[state.levelIdx];
      panel(30, 120, W - 60, 250);
      text(state.reason, W / 2, 156, 22, C.bad);
      text(`Level ${state.levelIdx + 1}: ${L.name}`, W / 2, 190, 15, C.soft, 'center', '600');
      const t = Math.min(1, state.distance / finishW());
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(70, 226, W - 140, 8);
      ctx.fillStyle = C.warm; ctx.fillRect(70, 226, (W - 140) * t, 8);
      text(`${Math.round(t * 100)}% of the way`, W / 2, 254, 15, '#fff', 'center', '700');
      coin(W / 2 - 52, 296);
      text(`+${state.coinsEarned} coins`, W / 2 - 38, 297, 17, C.warm, 'left', '700');
      text('Same river every time: you can learn it!', W / 2, 336, 12, C.soft, 'center', '500');
      if (state.time - state.overAt > 0.6) {
        let y = 400;
        if (canRevive()) { reviveButton(y); y += 68; }
        button(50, y, W - 100, 56, 'TRY AGAIN', () => startGame('level', state.levelIdx), { primary: !canRevive(), size: 20 });
        button(50, y + 68, (W - 112) / 2, 44, 'Levels', () => go('levels'), { size: 15 });
        button(62 + (W - 112) / 2, y + 68, (W - 112) / 2, 44, 'Shop', () => go('shop'), { size: 15 });
      }
      return;
    }
    panel(30, 110, W - 60, 300);
    text(state.reason, W / 2, 146, 22, C.bad);
    text(`Reached stage ${state.level}`, W / 2, 178, 14, C.soft, 'center', '600');
    text('Score', W / 2 - 65, 212, 14, C.soft, 'center', '600');
    text('Best', W / 2 + 65, 212, 14, C.soft, 'center', '600');
    text(String(score()), W / 2 - 65, 246, 38);
    text(String(save.best), W / 2 + 65, 246, 38, C.warm);
    if (state.newBest) text('New high score!', W / 2, 290, 18, C.good, 'center', '700');
    coin(W / 2 - 52, 330);
    text(`+${state.coinsEarned} coins`, W / 2 - 38, 331, 17, C.warm, 'left', '700');
    text(`${state.lanterns} crates · ${Math.floor(score() / 50)} from points`, W / 2, 360, 12, C.soft, 'center', '500');
    text(`You have ${save.coins} coins`, W / 2, 386, 13, C.soft, 'center', '600');
    if (state.time - state.overAt > 0.6) {
      let y = 432;
      if (canRevive()) { reviveButton(y); y += 68; }
      button(50, y, W - 100, 56, 'PLAY AGAIN', () => startGame('endless'), { primary: !canRevive(), size: 20 });
      button(50, y + 68, (W - 112) / 2, 44, 'Shop', () => go('shop'), { size: 15 });
      button(62 + (W - 112) / 2, y + 68, (W - 112) / 2, 44, 'Menu', () => go('menu'), { size: 15 });
    }
  }

  function reviveButton(y) {
    button(50, y, W - 100, 56, 'REVIVE', watchAdToRevive, { primary: true, size: 20 });
    // a small "play" mark so it reads as "watch a video"
    ctx.save();
    ctx.translate(0, 3 * pressAmount(50, y, W - 100, 56));
    ctx.fillStyle = 'rgba(30,18,6,0.85)';
    ctx.beginPath(); ctx.arc(W - 86, y + 28, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd56b';
    ctx.beginPath(); ctx.moveTo(W - 90, y + 21); ctx.lineTo(W - 79, y + 28); ctx.lineTo(W - 90, y + 35); ctx.closePath(); ctx.fill();
    ctx.restore();
    text('Watch a short ad · once per run', W / 2, y + 63, 11, C.soft, 'center', '600');
  }

  function drawAd() {
    ctx.fillStyle = 'rgba(5,4,3,0.75)';
    ctx.fillRect(0, -H, W, H * 3);
    panel(40, 200, W - 80, 160);
    if (ads.native) {
      title('LOADING AD', W / 2, 250, 22, C.title);
      text('Your boat is waiting...', W / 2, 290, 14, C.soft, 'center', '600');
    } else {
      title('AD BREAK', W / 2, 250, 22, C.title);
      text('(no ads in the browser: this is a stand-in)', W / 2, 284, 12, C.soft, 'center', '600');
      const left = Math.max(0, 3 - (state.time - state.adAt));
      text(`Reviving in ${Math.ceil(left)}`, W / 2, 322, 18, C.warm, 'center', '700');
    }
  }

  function drawPaused() {
    ctx.fillStyle = 'rgba(5,4,3,0.55)';
    ctx.fillRect(0, -H, W, H * 3);
    panel(40, 150, W - 80, 290);
    title('PAUSED', W / 2, 192, 28, C.title);
    text(state.mode === 'level' ? `Level ${state.levelIdx + 1}: ${LEVELS[state.levelIdx].name}` : `Endless · score ${score()}`, W / 2, 226, 14, C.soft, 'center', '700');
    button(66, 254, W - 132, 56, 'RESUME', resume, { primary: true, size: 22, title: true });
    button(66, 322, W - 132, 46, 'RESTART', () => startGame(state.mode, state.levelIdx), { size: 17, rot: 0.012 });
    button(66, 378, W - 132, 46, state.mode === 'level' ? 'QUIT TO LEVELS' : 'QUIT TO MENU', () => go(state.mode === 'level' ? 'levels' : 'menu'), { size: 17, rot: -0.012 });
  }

  function drawWin() {
    const i = state.levelIdx;
    panel(30, 100, W - 60, 300);
    title('LEVEL COMPLETE', W / 2, 142, 24, C.good);
    text(`${i + 1}. ${LEVELS[i].name}`, W / 2, 174, 15, C.soft, 'center', '600');
    const shown = Math.min(state.levelStars, Math.floor((state.time - state.overAt) / 0.3) + 1);
    for (let k = 0; k < 3; k++) star(W / 2 - 52 + k * 52, 226, k === 1 ? 24 : 20, k < shown);
    text(`Crates ${state.lanterns} / ${state.lanternTotal}`, W / 2, 274, 15, '#fff', 'center', '700');
    coin(W / 2 - 52, 310);
    text(`+${state.coinsEarned} coins`, W / 2 - 38, 311, 17, C.warm, 'left', '700');
    if (state.firstClear) text(`includes first-time bonus +${10 + 5 * (i + 1)}`, W / 2, 338, 12, C.soft, 'center', '500');
    if (state.levelStars < 3) text('Pick up every crate for 3 stars', W / 2, 368, 12, C.dim, 'center', '500');
    if (state.time - state.overAt > 0.6) {
      if (i + 1 < LEVELS.length) {
        button(50, 420, W - 100, 56, 'NEXT LEVEL', () => startGame('level', i + 1), { primary: true, size: 20 });
      } else {
        text('You beat every level!', W / 2, 440, 18, C.warm, 'center', '700');
      }
      button(50, 488, (W - 112) / 2, 44, 'Replay', () => startGame('level', i), { size: 15 });
      button(62 + (W - 112) / 2, 488, (W - 112) / 2, 44, 'Levels', () => go('levels'), { size: 15 });
    }
  }

  function draw() {
    buttons = [];
    ctx.save();
    if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    drawLand();
    drawRiver();
    drawScenery();
    const showBoat = playing() || ['over', 'win', 'menu', 'paused', 'ad'].includes(state.screen);
    if (showBoat) drawBoat(state.boatX, BOAT_Y, playing() ? state.boatTilt : 0, playing() ? state.edge : 0);
    if (playing() || state.screen === 'paused') drawLanterns();
    drawDarkness();
    drawFinishLights();
    drawWorldLights();
    drawBlockerLights();
    drawHelicopter();
    if (playing() && state.edge > 0 && state.invuln <= 0) {
      ctx.fillStyle = `rgba(255,50,40,${0.15 * state.edge})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    if (!playing() && !['over', 'win', 'paused', 'ad'].includes(state.screen)) {
      ctx.fillStyle = 'rgba(2,4,12,0.35)';
      ctx.fillRect(0, 0, W, H);
    }
    updateSafeTop();
    ctx.save();
    if (playing()) drawPad(); // the pad and joystick sit at the bottom, not shifted
    ctx.translate(0, uiShift());
    switch (state.screen) {
      case 'menu': drawMenu(); break;
      case 'how': drawHow(); break;
      case 'shop': drawShop(); break;
      case 'scores': drawScores(); break;
      case 'play': drawPlayHUD(); break;
      case 'over': drawOver(); break;
      case 'win': drawWin(); break;
      case 'paused': drawPaused(); break;
      case 'ad': drawAd(); break;
      case 'levels': drawLevels(); break;
    }
    ctx.restore();
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
  document.addEventListener('visibilitychange', () => { last = performance.now(); if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
})();
