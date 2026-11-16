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
  const HELI_OFFSET = 70;    // the helicopter flies this far above your finger, so you can see what it lights
  const STEP = 8;            // world px between river points

  // Difficulty per level
  const LEVEL_LENGTH = 1400; // world px per level
  function levelParams(level) {
    const n = Math.min(level, 10) - 1;
    return {
      speed: 95 + n * 20,                        // px/s
      lightR: Math.max(60, 105 - n * 5),         // spotlight radius
      memory: Math.max(0.45, 1.8 - n * 0.16),    // seconds a lit spot stays visible
      ambient: Math.min(0.985, 0.9 + n * 0.012), // how dark the night is
    };
  }
  const START_WIDTH = 160;
  const MIN_WIDTH = 60;
  const NARROW_RATE = 0.0085; // river width lost per px travelled
  const STEER_GAIN = 1.25;
  const LANTERN_EVERY = 360;
  const LANTERN_BONUS = 10;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas'); // darkness layer with holes cut for light
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

  // ---------- Storage (safe) ----------
  function loadBest() {
    try { return parseInt(localStorage.getItem('nightwatch.river.best') || '0', 10) || 0; }
    catch { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('nightwatch.river.best', String(v)); } catch { /* ignore */ }
  }

  // ---------- Sound (tiny synth, no files) ----------
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
    lantern: () => { beep(1046, 0.07, 'sine', 0.06); setTimeout(() => beep(1568, 0.12, 'sine', 0.05), 60); },
    level: () => { beep(392, 0.15, 'triangle', 0.06); setTimeout(() => beep(311, 0.3, 'triangle', 0.06), 150); },
    over: () => beep(160, 0.6, 'sawtooth', 0.08, 40),
    warn: () => beep(180, 0.05, 'square', 0.03),
  };
  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
  }

  // ---------- World: river + banks ----------
  // World coordinate w grows upward. A point at w is drawn at screen y = BOAT_Y - (w - distance).
  const river = { pts: [], targetX: W / 2, x: W / 2 };
  let scenery = [];  // trees, bushes, rocks on the banks
  let ripples = [];  // little wave marks on the water
  let reeds = [];    // reeds along the bank edges

  function resetWorld() {
    river.pts = [];
    river.x = river.targetX = W / 2;
    scenery = [];
    ripples = [];
    reeds = [];
  }

  function extendRiver(toW) {
    while (river.pts.length * STEP < toW) {
      const w = river.pts.length * STEP;
      const width = Math.max(MIN_WIDTH, START_WIDTH - w * NARROW_RATE);
      const margin = width / 2 + 20;
      if (w < 300) {
        river.x = river.targetX = W / 2; // straight start
      } else {
        if (Math.abs(river.targetX - river.x) < 4) {
          river.targetX = margin + Math.random() * (W - margin * 2);
        }
        const maxSlope = Math.min(5, 1.5 + w / 3000);
        const dx = Math.max(-maxSlope, Math.min(maxSlope, (river.targetX - river.x) * 0.055));
        river.x = Math.max(margin, Math.min(W - margin, river.x + dx));
      }
      river.pts.push({ x: river.x, width });

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
      }
      if (Math.random() < 0.3) {
        ripples.push({ w, dx: (Math.random() - 0.5) * 0.8, len: 6 + Math.random() * 10, phase: Math.random() * 6 });
      }
    }
  }

  function riverAt(w) {
    if (w < 0) return { x: W / 2, width: START_WIDTH };
    extendRiver(w + STEP * 2);
    const i = Math.floor(w / STEP);
    const t = (w - i * STEP) / STEP;
    const a = river.pts[i], b = river.pts[i + 1];
    return { x: a.x + (b.x - a.x) * t, width: a.width + (b.width - a.width) * t };
  }
  function pointIndex(w) {
    extendRiver(Math.max(0, w) + STEP * 2);
    return Math.max(0, Math.round(w / STEP));
  }

  const toScreenY = (w) => BOAT_Y - (w - state.distance);
  const toWorld = (y) => state.distance + (BOAT_Y - y);

  // ---------- Game state ----------
  const state = {
    mode: 'menu', // 'menu' | 'play' | 'over'
    distance: 0,
    speed: 95,
    level: 1,
    params: levelParams(1),
    bonus: 0,
    best: loadBest(),
    newBest: false,
    boatX: W / 2,
    boatTilt: 0,
    steerId: null, steerLastX: 0,
    lightId: null, finger: null,
    heli: { x: W / 2 + 60, y: 120 }, // helicopter position (it follows your finger smoothly)
    marks: [],    // spots the spotlight has lit: { x, w, r, t }
    foam: [],     // wake behind the boat
    lanterns: [],
    nextLanternW: LANTERN_EVERY,
    popups: [],
    edge: 0,
    warnTimer: 0,
    banner: null,
    reason: '',
    time: 0,
    overAt: 0,
    shake: 0,
    playTime: 0,
  };
  window.__nightWatch = { state, riverAt }; // handy for debugging in the browser console

  function score() {
    return Math.floor(state.distance / 10) + state.bonus;
  }

  function startGame() {
    resetWorld();
    const p = levelParams(1);
    Object.assign(state, {
      mode: 'play', distance: 0, level: 1, params: p, speed: p.speed,
      bonus: 0, newBest: false, boatX: W / 2, boatTilt: 0, marks: [], foam: [],
      lanterns: [], nextLanternW: LANTERN_EVERY, popups: [], edge: 0, reason: '', playTime: 0,
      banner: { text: 'Level 1', sub: 'Light the river ahead', age: 0 },
    });
    sfx.start();
    vibrate(30);
  }

  function gameOver(reason) {
    if (state.mode !== 'play') return;
    state.mode = 'over';
    state.reason = reason;
    state.overAt = state.time;
    state.shake = 12;
    sfx.over();
    vibrate([100, 60, 140]);
    const s = score();
    if (s > state.best) {
      state.best = s;
      state.newBest = true;
      saveBest(s);
    }
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

    if (state.mode === 'menu' || (state.mode === 'over' && state.time - state.overAt > 0.8)) {
      startGame();
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
      if (state.mode === 'play') {
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
    if (e.code === 'Space' && !e.repeat && state.mode !== 'play') startGame();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // Where the spotlight is aimed right now (null = no light)
  function spotTarget() {
    if (state.finger) return { x: state.finger.x, y: Math.max(20, state.finger.y - HELI_OFFSET) };
    if (!hasTouch && state.mode === 'play') return { x: state.boatX, y: BOAT_Y - 140 };
    return null;
  }

  // ---------- Update ----------
  function update(dt) {
    state.time += dt;
    if (state.banner) { state.banner.age += dt; if (state.banner.age > 2.4) state.banner = null; }

    // The helicopter glides toward where you point
    const target = spotTarget();
    if (target) {
      const k = Math.min(1, dt * 14);
      state.heli.x += (target.x - state.heli.x) * k;
      state.heli.y += (target.y - state.heli.y) * k;
    }

    if (state.mode === 'play') {
      state.playTime += dt;

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
      state.boatTilt *= Math.pow(0.02, dt); // straighten out
      state.boatTilt = Math.max(-0.5, Math.min(0.5, state.boatTilt));

      // In the water?
      const p = riverAt(state.distance);
      const half = p.width / 2;
      const off = Math.abs(state.boatX - p.x);
      state.edge = Math.max(0, Math.min(1, (off - half * 0.55) / (half * 0.45)));
      if (off > half - 6) {
        gameOver('Crashed into the bank!');
      } else if (state.edge > 0.5) {
        state.warnTimer -= dt;
        if (state.warnTimer <= 0) { sfx.warn(); vibrate(15); state.warnTimer = 0.2; }
      }

      // Remember where the spotlight shone (in world coordinates, so it moves with the river)
      if (target) {
        const lastMark = state.marks[state.marks.length - 1];
        const mw = toWorld(state.heli.y);
        if (!lastMark || state.time - lastMark.t > 0.04 ||
            Math.hypot(lastMark.x - state.heli.x, lastMark.w - mw) > 10) {
          state.marks.push({ x: state.heli.x, w: mw, r: state.params.lightR, t: state.time });
        }
      }
      state.marks = state.marks.filter((m) => state.time - m.t < state.params.memory);

      // Wake foam
      if (Math.random() < dt * 40) {
        state.foam.push({ x: state.boatX + (Math.random() - 0.5) * 8, w: state.distance - 16, age: 0, life: 0.9 + Math.random() * 0.5, side: Math.random() < 0.5 ? -1 : 1 });
      }

      // Lanterns
      const aheadW = state.distance + BOAT_Y + 40;
      while (state.nextLanternW < aheadW) {
        const fp = riverAt(state.nextLanternW);
        state.lanterns.push({ w: state.nextLanternW, offset: (Math.random() - 0.5) * fp.width * 0.5, phase: Math.random() * 6, alive: true });
        state.nextLanternW += LANTERN_EVERY * (0.7 + Math.random() * 0.6);
      }
      for (const ln of state.lanterns) {
        if (!ln.alive) continue;
        const lx = riverAt(ln.w).x + ln.offset, ly = toScreenY(ln.w);
        if (Math.hypot(lx - state.boatX, ly - BOAT_Y) < 26) {
          ln.alive = false;
          state.bonus += LANTERN_BONUS;
          state.popups.push({ x: lx, y: ly, age: 0 });
          sfx.lantern();
          vibrate(20);
        }
      }
      state.lanterns = state.lanterns.filter((ln) => ln.alive && toScreenY(ln.w) < H + 30);
    } else if (state.mode === 'menu') {
      state.distance += 30 * dt; // gentle drift on the title screen
    }

    for (const f of state.foam) {
      f.age += dt;
      f.x += f.side * 22 * dt; // spreads into a V
    }
    state.foam = state.foam.filter((f) => f.age < f.life);

    const minW = state.distance - (H - BOAT_Y) - 60;
    if (scenery.length > 400) scenery = scenery.filter((s) => s.w > minW);
    if (ripples.length > 400) ripples = ripples.filter((s) => s.w > minW);
    if (reeds.length > 400) reeds = reeds.filter((s) => s.w > minW);

    for (const p of state.popups) { p.age += dt; p.y -= 40 * dt; }
    state.popups = state.popups.filter((p) => p.age < 0.9);
    state.shake = Math.max(0, state.shake - dt * 30);
  }

  // ---------- Draw ----------
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

  function drawLand() {
    ctx.fillStyle = '#1e2d1b';
    ctx.fillRect(0, 0, W, H);
    // Subtle grass texture that scrolls with the world
    const band = 30;
    const offset = state.distance % (band * 2);
    ctx.fillStyle = '#223320';
    for (let y = -band * 2 + offset; y < H; y += band * 2) ctx.fillRect(0, y, W, band);
  }

  function drawRiver() {
    // Muddy bank, then water
    ctx.fillStyle = '#5a5039';
    ctx.fill(riverOutline(9));
    const water = riverOutline(0);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#1d4c66');
    g.addColorStop(0.5, '#2a6585');
    g.addColorStop(1, '#1d4c66');
    ctx.fillStyle = g;
    ctx.fill(water);

    // Ripples drift with the current
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
    // Wake
    for (const f of state.foam) {
      const k = 1 - f.age / f.life;
      ctx.fillStyle = `rgba(235,245,250,${0.55 * k})`;
      ctx.beginPath();
      ctx.arc(f.x, toScreenY(f.w), 2 + (1 - k) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Reeds on the bank edges
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

  function drawBoat(x, y, tilt, danger) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    // Hull (pointing up the river)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(3, 4, 11, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = danger > 0.5 ? '#9a4d34' : '#8a5a33';
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.quadraticCurveTo(12, -8, 11, 16);
    ctx.lineTo(-11, 16);
    ctx.quadraticCurveTo(-12, -8, 0, -22);
    ctx.fill();
    ctx.fillStyle = '#b07a46';
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.quadraticCurveTo(8, -6, 7.5, 13);
    ctx.lineTo(-7.5, 13);
    ctx.quadraticCurveTo(-8, -6, 0, -17);
    ctx.fill();
    // Seats
    ctx.fillStyle = '#6e4626';
    ctx.fillRect(-7, -4, 14, 3);
    ctx.fillRect(-7, 6, 14, 3);
    // Sailor in a yellow raincoat
    ctx.fillStyle = '#e0b43c';
    ctx.beginPath(); ctx.arc(0, 1, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c6962a';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    // Bow lamp
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(0, -18, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawHelicopter() {
    const target = state.mode === 'play' ? spotTarget() : null;
    if (!target) return;
    const { x, y } = state.heli;
    // Shadow-free silhouette seen from above, a bit offset as if it hovers to the side of its beam
    ctx.save();
    ctx.translate(x + 18, y - 22);
    ctx.rotate(-0.35);
    ctx.fillStyle = '#2b3138';
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 12, 0, 0, Math.PI * 2); ctx.fill(); // body
    ctx.fillRect(-1.5, 10, 3, 16); // tail
    ctx.fillRect(-5, 24, 10, 2.5);  // tail rotor
    ctx.fillStyle = '#6fa8c8';
    ctx.beginPath(); ctx.ellipse(0, -6, 4.5, 4, 0, 0, Math.PI * 2); ctx.fill(); // cockpit
    // Spinning rotor
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
    // Blinking light
    if (Math.sin(state.time * 8) > 0.6) {
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(0, 25, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawDarkness() {
    const amb = state.mode === 'play' ? state.params.ambient : 0.5;
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
    if (state.mode === 'play') {
      // Spots you lit a moment ago fade out where they were
      const mem = state.params.memory;
      for (const m of state.marks) {
        const a = 1 - (state.time - m.t) / mem;
        hole(m.x, toScreenY(m.w), m.r * 0.9, 0.12 * a);
      }
      hole(state.boatX, BOAT_Y - 10, 48, 0.8); // the boat's own lamp
      if (spotTarget()) hole(state.heli.x, state.heli.y, state.params.lightR, 1);
    }
    dctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dark, 0, 0);
    ctx.restore();

    // Cool white tint inside the spotlight
    if (state.mode === 'play' && spotTarget()) {
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
    for (const ln of state.lanterns) {
      const x = riverAt(ln.w).x + ln.offset + Math.sin(state.time * 1.5 + ln.phase) * 3;
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

  function drawPad() {
    if (!hasTouch) return;
    const active = state.steerId !== null;
    ctx.fillStyle = active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, PAD_TOP, W, H - PAD_TOP);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, PAD_TOP); ctx.lineTo(W, PAD_TOP); ctx.stroke();
    ctx.setLineDash([]);
    if (state.mode === 'play' && state.playTime < 6) {
      text('◀  drag here to steer the boat  ▶', W / 2, PAD_TOP + 50, 14, 'rgba(255,255,255,0.75)', 'center', '600');
      text('touch above to fly the helicopter', W / 2, PAD_TOP + 78, 13, 'rgba(255,255,255,0.55)', 'center', '500');
    }
  }

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
    ctx.fillStyle = 'rgba(8,16,24,0.9)';
    ctx.strokeStyle = 'rgba(150,205,235,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 16); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
  }

  function drawUI() {
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
    const title = '#cfe8f5', warm = '#ffd98a', soft = '#a9bccb';
    if (state.mode === 'menu') {
      panel(28, 62, W - 56, 318);
      text('NIGHT WATCH', W / 2, 104, 38, title);
      text('Get the boat down the river.', W / 2, 144, 15, '#e6eef4', 'center', '600');
      const rows = [
        ['Thumb on the bottom pad', 'steers the boat'],
        ['Another finger above it', 'flies the helicopter spotlight'],
        ['Let go of the pad', 'and the boat goes straight'],
        ['Floating lanterns', '+10 points'],
      ];
      rows.forEach(([a, b], i) => {
        const y = 186 + i * 42;
        text(a, W / 2, y, 15, warm, 'center', '700');
        text(b, W / 2, y + 17, 13, soft, 'center', '500');
      });
      text('Every level is darker, faster and narrower.', W / 2, 356, 12, '#8197a6', 'center', '500');
      if (state.best > 0) text(`Best: ${state.best}`, W / 2, 412, 18, warm, 'center', '700');
      ctx.globalAlpha = pulse;
      text(hasTouch ? 'Tap to start' : 'Click or press Space to start', W / 2, PAD_TOP + 70, 20, '#ffffff', 'center', '700');
      ctx.globalAlpha = 1;
    } else if (state.mode === 'play') {
      text(String(score()), W / 2, 46, 40);
      text(`Level ${state.level}`, 14, 30, 14, warm, 'left', '700');
      if (state.banner) {
        const a = Math.min(1, state.banner.age * 4, (2.4 - state.banner.age) * 2);
        ctx.globalAlpha = Math.max(0, a);
        text(state.banner.text, W / 2, 150, 34, title);
        text(state.banner.sub, W / 2, 186, 16, '#e6eef4', 'center', '600');
        ctx.globalAlpha = 1;
      }
    } else if (state.mode === 'over') {
      panel(30, 120, W - 60, 230);
      text(state.reason, W / 2, 158, 25, '#ff9b7a');
      text(`Reached level ${state.level}`, W / 2, 192, 15, soft, 'center', '600');
      text('Score', W / 2 - 65, 228, 15, soft, 'center', '600');
      text('Best', W / 2 + 65, 228, 15, soft, 'center', '600');
      text(String(score()), W / 2 - 65, 264, 40);
      text(String(state.best), W / 2 + 65, 264, 40, warm);
      if (state.newBest) text('New best!', W / 2, 312, 20, '#9fe0c0', 'center', '700');
      if (state.time - state.overAt > 0.8) {
        ctx.globalAlpha = pulse;
        text('Tap to play again', W / 2, PAD_TOP + 70, 20, '#ffffff', 'center', '700');
        ctx.globalAlpha = 1;
      }
    }
    for (const p of state.popups) {
      ctx.globalAlpha = 1 - p.age / 0.9;
      text(`+${LANTERN_BONUS}`, p.x, p.y, 20, warm);
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.save();
    if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    drawLand();
    drawRiver();
    drawScenery();
    drawBoat(state.boatX, BOAT_Y, state.mode === 'play' ? state.boatTilt : 0, state.mode === 'play' ? state.edge : 0);
    drawDarkness();
    if (state.mode === 'play') drawLanterns();
    drawHelicopter();
    if (state.mode === 'play' && state.edge > 0) {
      ctx.fillStyle = `rgba(255,50,40,${0.15 * state.edge})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    drawPad();
    drawUI();
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
