// Night Watch — two fingers: one walks the soldier, the other holds the flashlight.
// Light the path ahead, remember where it goes, and keep the soldier on it.
(() => {
  'use strict';

  // Logical game size. The canvas is scaled to fit the screen.
  const W = 360;
  const H = 640;

  // Tuning
  const START_SPEED = 95;    // px/s the path scrolls toward you
  const MAX_SPEED = 260;
  const SPEED_GAIN = 2.0;    // extra px/s per second survived
  const START_WIDTH = 140;   // path width at the start
  const MIN_WIDTH = 60;
  const NARROW_RATE = 0.011; // width lost per px travelled
  const STEP = 8;            // world px between path points
  const LIGHT_R = 105;       // flashlight radius
  const SOLDIER_LIGHT_R = 42;// the soldier can see a little around himself
  const MEMORY = 1.6;        // seconds a lit part of the path stays visible
  const SOLDIER_OFFSET = 60; // soldier stands this far above the finger, so you can see him
  const FIREFLY_EVERY = 340;
  const FIREFLY_BONUS = 10;
  const START_Y = 470;       // soldier's starting height
  const START_CIRCLE_Y = START_Y + SOLDIER_OFFSET;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let scale = 1;

  // On a computer there is only one mouse, so the flashlight follows ahead of the soldier.
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
    canvas.width = Math.floor(W * scale * dpr);
    canvas.height = Math.floor(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Storage (safe) ----------
  function loadBest() {
    try { return parseInt(localStorage.getItem('nightwatch.best2') || '0', 10) || 0; }
    catch { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('nightwatch.best2', String(v)); } catch { /* ignore */ }
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
    light: () => beep(1200, 0.04, 'square', 0.025),
    firefly: () => { beep(1046, 0.07, 'sine', 0.06); setTimeout(() => beep(1568, 0.12, 'sine', 0.05), 60); },
    over: () => beep(330, 0.6, 'sawtooth', 0.07, 60),
    warn: () => beep(180, 0.05, 'square', 0.03),
  };
  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
  }

  // ---------- The path ----------
  // World coordinate w = distance from the start line, growing upward.
  // A point at world w is drawn at screen y = START_Y - (w - distance).
  const path = { pts: [], targetX: W / 2, x: W / 2 };

  function resetPath() {
    path.pts = [];
    path.x = W / 2;
    path.targetX = W / 2;
  }

  function extendPath(toW) {
    while (path.pts.length * STEP < toW) {
      const w = path.pts.length * STEP;
      const width = Math.max(MIN_WIDTH, START_WIDTH - w * NARROW_RATE);
      const margin = width / 2 + 16;
      if (w < 240) {
        path.x = W / 2;           // straight runway so you can get both fingers ready
        path.targetX = W / 2;
      } else {
        if (Math.abs(path.targetX - path.x) < 4) {
          path.targetX = margin + Math.random() * (W - margin * 2);
        }
        const maxSlope = Math.min(5, 1.6 + w / 2600);
        const dx = Math.max(-maxSlope, Math.min(maxSlope, (path.targetX - path.x) * 0.06));
        path.x = Math.max(margin, Math.min(W - margin, path.x + dx));
      }
      path.pts.push({ x: path.x, width, seen: -99 });
    }
  }

  function pointIndex(w) {
    extendPath(Math.max(0, w) + STEP * 2);
    return Math.max(0, Math.round(w / STEP));
  }

  function pathAt(w) {
    if (w < 0) return { x: W / 2, width: START_WIDTH };
    extendPath(w + STEP * 2);
    const i = Math.floor(w / STEP);
    const t = (w - i * STEP) / STEP;
    const a = path.pts[i], b = path.pts[i + 1];
    return { x: a.x + (b.x - a.x) * t, width: a.width + (b.width - a.width) * t };
  }

  const toScreenY = (w) => START_Y - (w - state.distance);
  const toWorld = (y) => state.distance + (START_Y - y);

  // ---------- Game state ----------
  const state = {
    mode: 'menu', // 'menu' | 'play' | 'over'
    distance: 0,
    speed: START_SPEED,
    playTime: 0,
    bonus: 0,
    best: loadBest(),
    newBest: false,
    soldierFinger: null, soldierId: null,
    lightFinger: null, lightId: null,
    soldier: { x: W / 2, y: START_Y, step: 0 },
    fireflies: [],
    nextFireflyW: FIREFLY_EVERY,
    popups: [],
    edge: 0,
    warnTimer: 0,
    reason: '',
    time: 0,
    overAt: 0,
    shake: 0,
    darkTime: 0,
  };
  window.__nightWatch = { state, pathAt }; // handy for debugging in the browser console

  function score() {
    return Math.floor(state.distance / 10) + state.bonus;
  }

  function reset() {
    resetPath();
    state.distance = 0;
    state.speed = START_SPEED;
    state.playTime = 0;
    state.bonus = 0;
    state.newBest = false;
    state.fireflies = [];
    state.nextFireflyW = FIREFLY_EVERY;
    state.popups = [];
    state.edge = 0;
    state.reason = '';
    state.darkTime = 0;
  }

  function startGame() {
    reset();
    state.mode = 'play';
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
    // Reveal the path you were on, so you can see where you went wrong
    const t = state.time;
    for (const p of path.pts) p.seen = t + 99;
    const s = score();
    if (s > state.best) {
      state.best = s;
      state.newBest = true;
      saveBest(s);
    }
  }

  // ---------- Input (multi-touch) ----------
  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function canStart() {
    return state.mode === 'menu' || (state.mode === 'over' && state.time - state.overAt > 0.8);
  }

  function onDown(e) {
    e.preventDefault();
    const p = toGame(e);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const dx = p.x - W / 2, dy = p.y - START_CIRCLE_Y;
    const onStart = dx * dx + dy * dy < 50 * 50;

    if (state.soldierId === null && canStart() && onStart) {
      state.soldierId = e.pointerId;
      state.soldierFinger = p;
      startGame();
      return;
    }
    if (state.lightId === null && e.pointerId !== state.soldierId) {
      state.lightId = e.pointerId;
      state.lightFinger = p;
      sfx.light();
    }
  }

  function onMove(e) {
    if (e.pointerId === state.soldierId) state.soldierFinger = toGame(e);
    else if (e.pointerId === state.lightId) state.lightFinger = toGame(e);
  }

  function onUp(e) {
    if (e.pointerId === state.soldierId) {
      state.soldierId = null;
      state.soldierFinger = null;
      if (state.mode === 'play') gameOver('The soldier stopped!');
    } else if (e.pointerId === state.lightId) {
      state.lightId = null;
      state.lightFinger = null;
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', () => {
    if (state.mode === 'play') gameOver('The soldier stopped!');
    state.soldierId = state.lightId = null;
    state.soldierFinger = state.lightFinger = null;
  });

  // Where the flashlight is right now (null = dark)
  function lightPos() {
    if (state.lightFinger) return state.lightFinger;
    if (!hasTouch && state.mode === 'play') {
      // Computer: the flashlight points a little ahead of the soldier
      return { x: state.soldier.x, y: state.soldier.y - 120 };
    }
    return null;
  }

  // ---------- Update ----------
  function lightUp(cx, cy, r) {
    // Mark path points near (cx, cy) as seen right now
    const wTop = toWorld(cy - r), wBottom = toWorld(cy + r);
    const i0 = pointIndex(Math.max(0, wBottom)), i1 = pointIndex(wTop);
    for (let i = i0; i <= i1; i++) {
      const p = path.pts[i];
      if (!p) continue;
      const y = toScreenY(i * STEP);
      // Light the point if any part of the path's width at this height is inside the circle
      const dy = y - cy;
      if (Math.abs(dy) > r) continue;
      const reach = Math.sqrt(r * r - dy * dy);
      if (cx + reach >= p.x - p.width / 2 && cx - reach <= p.x + p.width / 2) {
        p.seen = state.time;
      }
    }
  }

  function update(dt) {
    state.time += dt;

    if (state.mode === 'play') {
      state.playTime += dt;
      state.speed = Math.min(MAX_SPEED, START_SPEED + state.playTime * SPEED_GAIN);
      state.distance += state.speed * dt;

      const f = state.soldierFinger;
      if (!f) {
        gameOver('The soldier stopped!');
      } else {
        const s = state.soldier;
        const nx = f.x, ny = f.y - SOLDIER_OFFSET;
        s.step += Math.hypot(nx - s.x, ny - s.y) * 0.08 + state.speed * dt * 0.06;
        s.x = nx; s.y = ny;

        // Is the soldier on the path?
        const p = pathAt(toWorld(s.y));
        const half = p.width / 2;
        const off = Math.abs(s.x - p.x);
        state.edge = Math.max(0, Math.min(1, (off - half * 0.6) / (half * 0.4)));
        if (off > half) {
          gameOver('Lost in the dark!');
        } else if (state.edge > 0.5) {
          state.warnTimer -= dt;
          if (state.warnTimer <= 0) { sfx.warn(); vibrate(15); state.warnTimer = 0.18; }
        }

        // Spawn fireflies on the path ahead
        const aheadW = state.distance + START_Y + 40;
        while (state.nextFireflyW < aheadW) {
          const fp = pathAt(state.nextFireflyW);
          state.fireflies.push({
            w: state.nextFireflyW,
            offset: (Math.random() - 0.5) * fp.width * 0.5,
            alive: true,
            phase: Math.random() * 6,
          });
          state.nextFireflyW += FIREFLY_EVERY * (0.7 + Math.random() * 0.6);
        }

        // Collect fireflies
        for (const fl of state.fireflies) {
          if (!fl.alive) continue;
          const fx = pathAt(fl.w).x + fl.offset;
          const fy = toScreenY(fl.w);
          const dx = fx - s.x, dy = fy - s.y;
          if (dx * dx + dy * dy < 30 * 30) {
            fl.alive = false;
            state.bonus += FIREFLY_BONUS;
            state.popups.push({ x: fx, y: fy, age: 0 });
            sfx.firefly();
            vibrate(20);
          }
        }

        lightUp(s.x, s.y, SOLDIER_LIGHT_R);
      }

      const L = lightPos();
      if (L) lightUp(L.x, L.y, LIGHT_R);
      state.darkTime = L ? 0 : state.darkTime + dt;

      state.fireflies = state.fireflies.filter((fl) => fl.alive && toScreenY(fl.w) < H + 30);
    } else if (state.mode === 'menu') {
      // On the menu the flashlight still works, so you can try it
      const L = lightPos();
      if (L) lightUp(L.x, L.y, LIGHT_R);
      lightUp(W / 2, START_Y, SOLDIER_LIGHT_R + 20);
    }

    for (const p of state.popups) { p.age += dt; p.y -= 40 * dt; }
    state.popups = state.popups.filter((p) => p.age < 0.9);
    state.shake = Math.max(0, state.shake - dt * 30);
  }

  // ---------- Draw ----------
  function seenAlpha(p) {
    const age = state.time - p.seen;
    if (age <= 0) return 1;
    return Math.max(0, 1 - age / MEMORY);
  }

  function drawPath() {
    const yTop = -20, yBottom = H + 20;
    const i0 = pointIndex(Math.max(0, toWorld(yBottom)));
    const i1 = pointIndex(toWorld(yTop));
    for (let i = i0; i < i1; i++) {
      const a = path.pts[i], b = path.pts[i + 1];
      if (!a || !b) continue;
      const alpha = Math.max(seenAlpha(a), seenAlpha(b));
      if (alpha <= 0.01) continue;
      const ya = toScreenY(i * STEP), yb = toScreenY((i + 1) * STEP);

      // Ground
      ctx.fillStyle = `rgba(40,62,84,${0.9 * alpha})`;
      ctx.beginPath();
      ctx.moveTo(a.x - a.width / 2, ya + 0.5);
      ctx.lineTo(b.x - b.width / 2, yb - 0.5);
      ctx.lineTo(b.x + b.width / 2, yb - 0.5);
      ctx.lineTo(a.x + a.width / 2, ya + 0.5);
      ctx.closePath();
      ctx.fill();

      // Edges
      ctx.strokeStyle = `rgba(127,212,255,${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x - a.width / 2, ya); ctx.lineTo(b.x - b.width / 2, yb);
      ctx.moveTo(a.x + a.width / 2, ya); ctx.lineTo(b.x + b.width / 2, yb);
      ctx.stroke();

      // Footprints down the middle every few points
      if (i % 4 === 0) {
        ctx.fillStyle = `rgba(200,235,255,${0.25 * alpha})`;
        ctx.fillRect(a.x + (i % 8 === 0 ? -6 : 3), ya - 2, 3, 4);
      }
    }
  }

  function drawLight() {
    const L = lightPos();
    if (!L) return;
    const g = ctx.createRadialGradient(L.x, L.y, 4, L.x, L.y, LIGHT_R * 1.15);
    g.addColorStop(0, 'rgba(255,240,190,0.22)');
    g.addColorStop(0.7, 'rgba(255,230,160,0.08)');
    g.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.x, L.y, LIGHT_R * 1.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,190,0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(L.x, L.y, LIGHT_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawFireflies() {
    for (const fl of state.fireflies) {
      const x = pathAt(fl.w).x + fl.offset + Math.sin(state.time * 3 + fl.phase) * 5;
      const y = toScreenY(fl.w) + Math.cos(state.time * 2.3 + fl.phase) * 4;
      const k = 0.7 + 0.3 * Math.sin(state.time * 8 + fl.phase);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
      g.addColorStop(0, `rgba(255,250,170,${k})`);
      g.addColorStop(0.35, `rgba(220,255,120,${0.5 * k})`);
      g.addColorStop(1, 'rgba(200,255,100,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSoldier(x, y, danger) {
    const swing = Math.sin(state.soldier.step) * 4;
    ctx.save();
    ctx.translate(x, y);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 14, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    // Legs
    ctx.fillStyle = '#3b4a2a';
    ctx.fillRect(-6, 4 + swing, 5, 10);
    ctx.fillRect(1, 4 - swing, 5, 10);
    // Body
    ctx.fillStyle = danger > 0.5 ? '#9a4a3a' : '#5b6e3a';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-9, -8, 18, 16, 5); else ctx.rect(-9, -8, 18, 16);
    ctx.fill();
    // Backpack strap
    ctx.fillStyle = '#2e3a20';
    ctx.fillRect(-9, -2, 18, 3);
    // Head + helmet
    ctx.fillStyle = '#e8c39e';
    ctx.beginPath(); ctx.arc(0, -13, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a5a30';
    ctx.beginPath(); ctx.arc(0, -15, 8, Math.PI, 0); ctx.fill();
    ctx.fillRect(-9, -15, 18, 2.5);
    ctx.restore();
  }

  function drawFingers() {
    if (state.mode !== 'play') return;
    const f = state.soldierFinger;
    if (f) {
      // Faint line from finger to soldier, so it's clear what you control
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(state.soldier.x, state.soldier.y + 14); ctx.stroke();
      ctx.strokeStyle = state.edge > 0.5 ? '#ff6b7a' : 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(f.x, f.y, 22, 0, Math.PI * 2); ctx.stroke();
      drawSoldier(state.soldier.x, state.soldier.y, state.edge);
    }
  }

  function drawStartCircle() {
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 4);
    ctx.save();
    ctx.shadowColor = '#7fd4ff';
    ctx.shadowBlur = 20 + pulse * 15;
    ctx.strokeStyle = '#bfe9ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(W / 2, START_CIRCLE_Y, 38 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = `rgba(191,233,255,${0.12 + pulse * 0.12})`;
    ctx.beginPath();
    ctx.arc(W / 2, START_CIRCLE_Y, 38, 0, Math.PI * 2);
    ctx.fill();
    drawSoldier(W / 2, START_Y, 0);
  }

  function text(str, x, y, size, color = '#fff', align = 'center', weight = '800') {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = 'rgba(4,6,14,0.9)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(8,12,28,0.88)';
    ctx.strokeStyle = 'rgba(127,212,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 18); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
  }

  function drawUI() {
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
    if (state.mode === 'menu') {
      text('NIGHT', W / 2, 92, 54, '#bfe9ff');
      text('WATCH', W / 2, 146, 54, '#fff3a8');
      text('Finger 1 walks the soldier.', W / 2, 206, 16, '#e6ecff', 'center', '600');
      text('Finger 2 is your flashlight.', W / 2, 230, 16, '#fff3a8', 'center', '600');
      text('Light the path ahead, then keep the', W / 2, 266, 14, '#c8d6ff', 'center', '500');
      text('soldier on it. Lifting finger 1 ends the run.', W / 2, 286, 14, '#c8d6ff', 'center', '500');
      if (!hasTouch) text('On a computer the light follows the soldier.', W / 2, 314, 13, '#9fb0d8', 'center', '500');
      if (state.best > 0) text(`Best: ${state.best}`, W / 2, 350, 18, '#fff3a8', 'center', '700');
      drawStartCircle();
      ctx.globalAlpha = pulse;
      text('Hold here to start', W / 2, START_CIRCLE_Y + 66, 18, '#ffffff', 'center', '700');
      ctx.globalAlpha = 1;
    } else if (state.mode === 'play') {
      text(String(score()), W / 2, 50, 42);
      if (state.darkTime > 1.2 && hasTouch) {
        ctx.globalAlpha = pulse;
        text('Use a 2nd finger to light the way', W / 2, 92, 16, '#fff3a8', 'center', '700');
        ctx.globalAlpha = 1;
      }
    } else if (state.mode === 'over') {
      panel(36, 130, W - 72, 240);
      text(state.reason, W / 2, 170, 25, '#ff9b8a');
      text('Score', W / 2 - 65, 222, 16, '#c8d6ff', 'center', '600');
      text('Best', W / 2 + 65, 222, 16, '#c8d6ff', 'center', '600');
      text(String(score()), W / 2 - 65, 258, 40);
      text(String(state.best), W / 2 + 65, 258, 40, '#fff3a8');
      if (state.newBest) text('New best!', W / 2, 304, 20, '#7fd4ff', 'center', '700');
      text('The whole path is shown now.', W / 2, 340, 13, '#9fb0d8', 'center', '500');
      if (state.time - state.overAt > 0.8) {
        drawStartCircle();
        ctx.globalAlpha = pulse;
        text('Hold the circle to play again', W / 2, START_CIRCLE_Y + 66, 17, '#ffffff', 'center', '700');
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
    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, W, H);
    drawLight();
    drawPath();
    drawFireflies();
    if (state.mode === 'play' && state.edge > 0) {
      ctx.fillStyle = `rgba(255,40,60,${0.16 * state.edge})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawFingers();
    ctx.restore();
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

  // If the app goes to the background mid-run, the soldier stops
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    if (document.hidden && state.mode === 'play') gameOver('The soldier stopped!');
  });
})();
