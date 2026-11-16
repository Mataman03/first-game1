// Night Watch — a soldier walks a dirt road through a forest at night.
// Thumb at the bottom steers him. Another finger is the flashlight that shows the road.
(() => {
  'use strict';

  // Logical game size. The canvas is scaled to fit the screen.
  const W = 360;
  const H = 640;

  // Layout
  const SOLDIER_Y = 400;     // the soldier stays at this height; the world scrolls past him
  const PAD_TOP = 500;       // below this line is the steering pad
  const STEP = 8;            // world px between road points

  // Difficulty per level (level 1 → 10+)
  const LEVEL_LENGTH = 1400; // world px per level
  function levelParams(level) {
    const n = Math.min(level, 10) - 1;
    return {
      speed: 95 + n * 20,                 // px/s
      lightR: Math.max(62, 112 - n * 6),  // flashlight radius
      memory: Math.max(0.45, 1.8 - n * 0.16), // seconds lit road stays visible
      ambient: Math.min(0.985, 0.9 + n * 0.012), // how dark the night is
    };
  }
  const START_WIDTH = 150;
  const MIN_WIDTH = 54;
  const NARROW_RATE = 0.0085; // road width lost per px travelled
  const STEER_GAIN = 1.25;
  const FIREFLY_EVERY = 360;
  const FIREFLY_BONUS = 10;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas'); // darkness layer with holes cut for lights
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
    try { return parseInt(localStorage.getItem('nightwatch.best3') || '0', 10) || 0; }
    catch { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('nightwatch.best3', String(v)); } catch { /* ignore */ }
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
    firefly: () => { beep(1046, 0.07, 'sine', 0.06); setTimeout(() => beep(1568, 0.12, 'sine', 0.05), 60); },
    level: () => { beep(392, 0.15, 'triangle', 0.06); setTimeout(() => beep(311, 0.3, 'triangle', 0.06), 150); },
    over: () => beep(330, 0.6, 'sawtooth', 0.07, 60),
    warn: () => beep(180, 0.05, 'square', 0.03),
  };
  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
  }

  // ---------- World: road + scenery ----------
  // World coordinate w grows upward. A point at w is drawn at screen y = SOLDIER_Y - (w - distance).
  const road = { pts: [], targetX: W / 2, x: W / 2 };
  let scenery = [];   // trees, bushes, rocks beside the road
  let pebbles = [];   // small stones on the road

  function resetWorld() {
    road.pts = [];
    road.x = road.targetX = W / 2;
    scenery = [];
    pebbles = [];
  }

  function extendRoad(toW) {
    while (road.pts.length * STEP < toW) {
      const w = road.pts.length * STEP;
      const width = Math.max(MIN_WIDTH, START_WIDTH - w * NARROW_RATE);
      const margin = width / 2 + 20;
      if (w < 300) {
        road.x = road.targetX = W / 2; // straight start
      } else {
        if (Math.abs(road.targetX - road.x) < 4) {
          road.targetX = margin + Math.random() * (W - margin * 2);
        }
        const maxSlope = Math.min(5, 1.5 + w / 3000);
        const dx = Math.max(-maxSlope, Math.min(maxSlope, (road.targetX - road.x) * 0.055));
        road.x = Math.max(margin, Math.min(W - margin, road.x + dx));
      }
      road.pts.push({ x: road.x, width, seen: -99 });

      // Scenery on both sides
      if (road.pts.length % 3 === 0) {
        for (const side of [-1, 1]) {
          if (Math.random() < 0.55) {
            const edge = road.x + side * (width / 2);
            const gap = 14 + Math.random() * 120;
            const x = edge + side * gap;
            if (x > -30 && x < W + 30) {
              const r = Math.random();
              scenery.push({
                w, x,
                kind: r < 0.5 ? 'tree' : r < 0.8 ? 'bush' : 'rock',
                size: r < 0.5 ? 20 + Math.random() * 16 : 8 + Math.random() * 8,
                hue: 95 + Math.random() * 40,
                seed: Math.random() * 10,
              });
            }
          }
        }
      }
      if (Math.random() < 0.35) {
        pebbles.push({ w, dx: (Math.random() - 0.5) * width * 0.8, r: 1 + Math.random() * 1.8 });
      }
    }
  }

  function roadAt(w) {
    if (w < 0) return { x: W / 2, width: START_WIDTH };
    extendRoad(w + STEP * 2);
    const i = Math.floor(w / STEP);
    const t = (w - i * STEP) / STEP;
    const a = road.pts[i], b = road.pts[i + 1];
    return { x: a.x + (b.x - a.x) * t, width: a.width + (b.width - a.width) * t };
  }
  function pointIndex(w) {
    extendRoad(Math.max(0, w) + STEP * 2);
    return Math.max(0, Math.round(w / STEP));
  }

  const toScreenY = (w) => SOLDIER_Y - (w - state.distance);
  const toWorld = (y) => state.distance + (SOLDIER_Y - y);

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
    soldierX: W / 2,
    step: 0,
    steerId: null, steerLastX: 0,
    lightId: null, light: null,
    fireflies: [],
    nextFireflyW: FIREFLY_EVERY,
    popups: [],
    edge: 0,
    warnTimer: 0,
    banner: null, // { text, sub, age }
    reason: '',
    time: 0,
    overAt: 0,
    shake: 0,
    playTime: 0,
  };
  window.__nightWatch = { state, roadAt }; // handy for debugging in the browser console

  function score() {
    return Math.floor(state.distance / 10) + state.bonus;
  }

  function startGame() {
    resetWorld();
    Object.assign(state, {
      mode: 'play', distance: 0, level: 1, params: levelParams(1), speed: levelParams(1).speed,
      bonus: 0, newBest: false, soldierX: W / 2, fireflies: [], nextFireflyW: FIREFLY_EVERY,
      popups: [], edge: 0, reason: '', playTime: 0,
      banner: { text: 'Level 1', sub: 'Light the road ahead', age: 0 },
    });
    sfx.start();
    vibrate(30);
  }

  function gameOver(reason) {
    if (state.mode !== 'play') return;
    state.mode = 'over';
    state.reason = reason;
    state.overAt = state.time;
    state.shake = 10;
    sfx.over();
    vibrate([80, 60, 120]);
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

    // Mouse on a computer: one pointer does the steering anywhere
    const isSteer = !hasTouch || e.pointerType === 'mouse' || p.y >= PAD_TOP;
    if (isSteer && state.steerId === null) {
      state.steerId = e.pointerId;
      state.steerLastX = p.x;
    } else if (!isSteer && state.lightId === null) {
      state.lightId = e.pointerId;
      state.light = p;
      sfx.click();
    }
  }

  function onMove(e) {
    const p = toGame(e);
    if (e.pointerId === state.steerId) {
      if (state.mode === 'play') {
        state.soldierX += (p.x - state.steerLastX) * STEER_GAIN;
        state.soldierX = Math.max(8, Math.min(W - 8, state.soldierX));
      }
      state.steerLastX = p.x;
    } else if (e.pointerId === state.lightId) {
      state.light = p;
    }
  }

  function onUp(e) {
    if (e.pointerId === state.steerId) state.steerId = null; // the soldier just keeps walking straight
    if (e.pointerId === state.lightId) { state.lightId = null; state.light = null; }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && state.mode !== 'play') startGame();
  });
  const keys = {};
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // Where the flashlight points right now (null = no light)
  function lightPos() {
    if (state.light) return state.light;
    if (!hasTouch && state.mode === 'play') return { x: state.soldierX, y: SOLDIER_Y - 130 };
    return null;
  }

  // ---------- Update ----------
  function lightUp(cx, cy, r) {
    const i0 = pointIndex(Math.max(0, toWorld(cy + r))), i1 = pointIndex(toWorld(cy - r));
    for (let i = i0; i <= i1; i++) {
      const p = road.pts[i];
      if (!p) continue;
      const dy = toScreenY(i * STEP) - cy;
      if (Math.abs(dy) > r) continue;
      const reach = Math.sqrt(r * r - dy * dy);
      if (cx + reach >= p.x - p.width / 2 && cx - reach <= p.x + p.width / 2) p.seen = state.time;
    }
  }

  function update(dt) {
    state.time += dt;
    if (state.banner) { state.banner.age += dt; if (state.banner.age > 2.4) state.banner = null; }

    if (state.mode === 'play') {
      state.playTime += dt;

      // Levels
      const lvl = 1 + Math.floor(state.distance / LEVEL_LENGTH);
      if (lvl !== state.level) {
        state.level = lvl;
        state.params = levelParams(lvl);
        state.banner = { text: `Level ${lvl}`, sub: 'The night gets darker', age: 0 };
        sfx.level();
        vibrate(40);
      }
      // Ease toward the level's speed so it never jumps
      state.speed += (state.params.speed - state.speed) * Math.min(1, dt * 0.8);
      state.distance += state.speed * dt;
      state.step += state.speed * dt * 0.09;

      // Keyboard steering on a computer
      if (keys.ArrowLeft || keys.KeyA) state.soldierX -= 200 * dt;
      if (keys.ArrowRight || keys.KeyD) state.soldierX += 200 * dt;
      state.soldierX = Math.max(8, Math.min(W - 8, state.soldierX));

      // On the road?
      const p = roadAt(state.distance);
      const half = p.width / 2;
      const off = Math.abs(state.soldierX - p.x);
      state.edge = Math.max(0, Math.min(1, (off - half * 0.55) / (half * 0.45)));
      if (off > half - 4) {
        gameOver('Off the road!');
      } else if (state.edge > 0.5) {
        state.warnTimer -= dt;
        if (state.warnTimer <= 0) { sfx.warn(); vibrate(15); state.warnTimer = 0.2; }
      }

      // Fireflies
      const aheadW = state.distance + SOLDIER_Y + 40;
      while (state.nextFireflyW < aheadW) {
        const fp = roadAt(state.nextFireflyW);
        state.fireflies.push({ w: state.nextFireflyW, offset: (Math.random() - 0.5) * fp.width * 0.5, phase: Math.random() * 6, alive: true });
        state.nextFireflyW += FIREFLY_EVERY * (0.7 + Math.random() * 0.6);
      }
      for (const fl of state.fireflies) {
        if (!fl.alive) continue;
        const fx = roadAt(fl.w).x + fl.offset, fy = toScreenY(fl.w);
        if (Math.hypot(fx - state.soldierX, fy - SOLDIER_Y) < 26) {
          fl.alive = false;
          state.bonus += FIREFLY_BONUS;
          state.popups.push({ x: fx, y: fy, age: 0 });
          sfx.firefly();
          vibrate(20);
        }
      }
      state.fireflies = state.fireflies.filter((fl) => fl.alive && toScreenY(fl.w) < H + 30);

      const L = lightPos();
      if (L) lightUp(L.x, L.y, state.params.lightR);
      lightUp(state.soldierX, SOLDIER_Y, 34);
    } else if (state.mode === 'menu') {
      state.distance += 30 * dt; // gentle drift on the title screen
      state.step += 30 * dt * 0.09;
      for (const pt of road.pts) pt.seen = state.time;
    } else if (state.mode === 'over') {
      for (const pt of road.pts) pt.seen = state.time; // show the whole road after losing
    }

    // Drop things that scrolled off the bottom
    const minW = state.distance - (H - SOLDIER_Y) - 60;
    if (scenery.length > 400) scenery = scenery.filter((s) => s.w > minW);
    if (pebbles.length > 400) pebbles = pebbles.filter((s) => s.w > minW);

    for (const p of state.popups) { p.age += dt; p.y -= 40 * dt; }
    state.popups = state.popups.filter((p) => p.age < 0.9);
    state.shake = Math.max(0, state.shake - dt * 30);
  }

  // ---------- Draw ----------
  const wTop = () => toWorld(-40);
  const wBottom = () => Math.max(0, toWorld(H + 40));

  function drawGround() {
    ctx.fillStyle = '#1d2b1a';
    ctx.fillRect(0, 0, W, H);
    // Grass stripes that scroll with the world
    const band = 26;
    const offset = state.distance % (band * 2);
    ctx.fillStyle = '#213020';
    for (let y = -band * 2 + offset; y < H; y += band * 2) ctx.fillRect(0, y, W, band);
  }

  function drawRoad() {
    const i0 = pointIndex(wBottom()), i1 = pointIndex(wTop());
    // Shoulder (darker edge), then the dirt
    for (const [extra, color] of [[10, '#3b3324'], [0, '#8b7550']]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const p = road.pts[i]; if (!p) continue;
        const y = toScreenY(i * STEP);
        if (i === i0) ctx.moveTo(p.x - p.width / 2 - extra, y); else ctx.lineTo(p.x - p.width / 2 - extra, y);
      }
      for (let i = i1; i >= i0; i--) {
        const p = road.pts[i]; if (!p) continue;
        ctx.lineTo(p.x + p.width / 2 + extra, toScreenY(i * STEP));
      }
      ctx.closePath();
      ctx.fill();
    }
    // Wheel ruts
    ctx.strokeStyle = 'rgba(70,56,36,0.55)';
    ctx.lineWidth = 5;
    for (const k of [-0.25, 0.25]) {
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const p = road.pts[i]; if (!p) continue;
        const x = p.x + k * p.width, y = toScreenY(i * STEP);
        if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Pebbles
    ctx.fillStyle = '#a99472';
    const lo = wBottom(), hi = wTop();
    for (const pb of pebbles) {
      if (pb.w < lo || pb.w > hi) continue;
      const p = roadAt(pb.w);
      ctx.beginPath();
      ctx.arc(p.x + pb.dx * (p.width / START_WIDTH), toScreenY(pb.w), pb.r, 0, Math.PI * 2);
      ctx.fill();
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

  function drawFireflies(alphaScale = 1) {
    for (const fl of state.fireflies) {
      const x = roadAt(fl.w).x + fl.offset + Math.sin(state.time * 3 + fl.phase) * 5;
      const y = toScreenY(fl.w) + Math.cos(state.time * 2.3 + fl.phase) * 4;
      const k = (0.65 + 0.35 * Math.sin(state.time * 8 + fl.phase)) * alphaScale;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
      g.addColorStop(0, `rgba(255,250,170,${k})`);
      g.addColorStop(0.35, `rgba(220,255,120,${0.5 * k})`);
      g.addColorStop(1, 'rgba(200,255,100,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawSoldier(x, y, danger) {
    const swing = Math.sin(state.step) * 4;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(2, 15, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2f3a22';
    ctx.fillRect(-6, 4 + swing, 5, 10);
    ctx.fillRect(1, 4 - swing, 5, 10);
    ctx.fillStyle = danger > 0.5 ? '#8f4a38' : '#56683a';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-9, -8, 18, 16, 5); else ctx.rect(-9, -8, 18, 16);
    ctx.fill();
    ctx.fillStyle = '#3f4c2b';
    ctx.fillRect(-7, -6, 14, 9); // backpack
    ctx.fillStyle = '#e1b98f';
    ctx.beginPath(); ctx.arc(0, -13, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#495a2e';
    ctx.beginPath(); ctx.arc(0, -15, 8, Math.PI, 0); ctx.fill();
    ctx.fillRect(-9, -15, 18, 2.5);
    ctx.restore();
  }

  function drawDarkness() {
    // Build the darkness layer, then cut soft holes where there is light
    const amb = state.mode === 'play' ? state.params.ambient : 0.55;
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle = `rgba(3,5,12,${amb})`;
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, strength) => {
      const g = dctx.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.65, `rgba(0,0,0,${strength * 0.8})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g;
      dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill();
    };
    if (state.mode === 'play') {
      hole(state.soldierX, SOLDIER_Y, 46, 0.75); // a little light around the soldier
      const L = lightPos();
      if (L) hole(L.x, L.y, state.params.lightR, 1);
      const mem = memoryShape();
      if (mem) { dctx.fillStyle = mem.fill; dctx.fill(mem.shape); }
    }
    dctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dark, 0, 0);
    ctx.restore();

    // Warm tint inside the flashlight beam
    const L = state.mode === 'play' ? lightPos() : null;
    if (L) {
      const r = state.params.lightR;
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, r);
      g.addColorStop(0, 'rgba(255,220,140,0.16)');
      g.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(L.x, L.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Road you lit a moment ago stays faintly visible as it fades.
  // Built as one shape with a vertical gradient, so there are no seams.
  function memoryShape() {
    const mem = state.params.memory;
    const yTop = -40, yBot = H + 40;
    const i0 = pointIndex(Math.max(0, toWorld(yBot))), i1 = pointIndex(toWorld(yTop));
    const shape = new Path2D();
    const fill = dctx.createLinearGradient(0, yTop, 0, yBot);
    const edge = ctx.createLinearGradient(0, yTop, 0, yBot);
    let any = false;
    for (let i = i0; i <= i1; i++) {
      const p = road.pts[i]; if (!p) continue;
      const y = toScreenY(i * STEP);
      if (i === i0) shape.moveTo(p.x - p.width / 2, y); else shape.lineTo(p.x - p.width / 2, y);
      const a = Math.max(0, 1 - (state.time - p.seen) / mem);
      if (a > 0) any = true;
      const t = Math.max(0, Math.min(1, (y - yTop) / (yBot - yTop)));
      fill.addColorStop(t, `rgba(0,0,0,${0.6 * a})`);
      edge.addColorStop(t, `rgba(232,204,150,${0.5 * a})`);
    }
    for (let i = i1; i >= i0; i--) {
      const p = road.pts[i]; if (!p) continue;
      shape.lineTo(p.x + p.width / 2, toScreenY(i * STEP));
    }
    shape.closePath();
    return any ? { shape, fill, edge } : null;
  }

  function drawMemoryEdges() {
    if (state.mode !== 'play') return;
    const mem = memoryShape();
    if (!mem) return;
    ctx.strokeStyle = mem.edge;
    ctx.lineWidth = 2;
    ctx.stroke(mem.shape);
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
      text('◀  drag here to steer  ▶', W / 2, PAD_TOP + 60, 15, 'rgba(255,255,255,0.7)', 'center', '600');
    }
  }

  function text(str, x, y, size, color = '#fff', align = 'center', weight = '800') {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = 'rgba(3,5,12,0.85)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(14,18,12,0.9)';
    ctx.strokeStyle = 'rgba(232,204,150,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 16); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
  }

  function drawUI() {
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
    if (state.mode === 'menu') {
      panel(28, 62, W - 56, 318);
      text('NIGHT WATCH', W / 2, 104, 38, '#f2dca8');
      text('Get the soldier through the forest.', W / 2, 144, 15, '#e8e4d6', 'center', '600');
      const rows = [
        ['Thumb on the bottom pad', 'steers the soldier'],
        ['Another finger above it', 'is your flashlight'],
        ['Let go of the pad', 'and he walks straight'],
        ['Fireflies', '+10 points'],
      ];
      rows.forEach(([a, b], i) => {
        const y = 186 + i * 42;
        text(a, W / 2, y, 15, '#f2dca8', 'center', '700');
        text(b, W / 2, y + 17, 13, '#b9b6a6', 'center', '500');
      });
      text('Every level is darker, faster and narrower.', W / 2, 356, 12, '#9c998b', 'center', '500');
      if (state.best > 0) text(`Best: ${state.best}`, W / 2, 412, 18, '#f2dca8', 'center', '700');
      ctx.globalAlpha = pulse;
      text(hasTouch ? 'Tap to start' : 'Click or press Space to start', W / 2, PAD_TOP + 70, 20, '#ffffff', 'center', '700');
      ctx.globalAlpha = 1;
    } else if (state.mode === 'play') {
      text(String(score()), W / 2, 46, 40);
      text(`Level ${state.level}`, 14, 30, 14, '#f2dca8', 'left', '700');
      if (state.banner) {
        const a = Math.min(1, state.banner.age * 4, (2.4 - state.banner.age) * 2);
        ctx.globalAlpha = Math.max(0, a);
        text(state.banner.text, W / 2, 150, 34, '#f2dca8');
        text(state.banner.sub, W / 2, 186, 16, '#e8e4d6', 'center', '600');
        ctx.globalAlpha = 1;
      }
    } else if (state.mode === 'over') {
      panel(36, 120, W - 72, 230);
      text(state.reason, W / 2, 158, 28, '#ff9b7a');
      text(`Reached level ${state.level}`, W / 2, 192, 15, '#b9b6a6', 'center', '600');
      text('Score', W / 2 - 65, 228, 15, '#b9b6a6', 'center', '600');
      text('Best', W / 2 + 65, 228, 15, '#b9b6a6', 'center', '600');
      text(String(score()), W / 2 - 65, 264, 40);
      text(String(state.best), W / 2 + 65, 264, 40, '#f2dca8');
      if (state.newBest) text('New best!', W / 2, 312, 20, '#bde38a', 'center', '700');
      if (state.time - state.overAt > 0.8) {
        ctx.globalAlpha = pulse;
        text('Tap to play again', W / 2, PAD_TOP + 70, 20, '#ffffff', 'center', '700');
        ctx.globalAlpha = 1;
      }
    }
    for (const p of state.popups) {
      ctx.globalAlpha = 1 - p.age / 0.9;
      text(`+${FIREFLY_BONUS}`, p.x, p.y, 20, '#f4ff9a');
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.save();
    if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    drawGround();
    drawRoad();
    drawScenery();
    drawSoldier(state.soldierX, SOLDIER_Y, state.mode === 'play' ? state.edge : 0);
    drawDarkness();
    drawMemoryEdges();
    drawFireflies(state.mode === 'play' ? 0.9 : 0);
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
