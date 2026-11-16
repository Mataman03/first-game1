// Comet Dash — tap to boost your comet through gaps in the crystal walls.
(() => {
  'use strict';

  // Logical game size. The canvas is scaled to fit the screen.
  const W = 360;
  const H = 640;

  // Tuning
  const GRAVITY = 1400;      // px/s^2
  const BOOST = -430;        // px/s (upward velocity on tap)
  const MAX_FALL = 650;      // px/s
  const WALL_W = 62;
  const WALL_SPACING = 210;  // px between walls
  const START_SPEED = 150;   // px/s
  const MAX_SPEED = 260;
  const START_GAP = 190;
  const MIN_GAP = 135;
  const COMET_R = 13;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let scale = 1;

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
    try { return parseInt(localStorage.getItem('cometdash.best') || '0', 10) || 0; }
    catch { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('cometdash.best', String(v)); } catch { /* ignore */ }
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
    boost: () => beep(520, 0.09, 'triangle', 0.05, 760),
    score: () => { beep(880, 0.08, 'sine', 0.06); setTimeout(() => beep(1320, 0.1, 'sine', 0.05), 70); },
    crash: () => beep(220, 0.45, 'sawtooth', 0.08, 55),
  };

  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
  }

  // ---------- Background stars ----------
  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.4 + 0.3,
      depth: Math.random() * 0.6 + 0.15,
      tw: Math.random() * Math.PI * 2,
    });
  }

  // ---------- Game state ----------
  const state = {
    mode: 'menu', // 'menu' | 'play' | 'over'
    comet: { x: 100, y: H / 2, vy: 0 },
    walls: [],
    trail: [],
    sparks: [],
    score: 0,
    best: loadBest(),
    speed: START_SPEED,
    time: 0,
    overAt: 0,
    shake: 0,
    newBest: false,
  };

  function currentGap() {
    return Math.max(MIN_GAP, START_GAP - state.score * 2.5);
  }

  function addWall(x) {
    const gap = currentGap();
    const margin = 70;
    const gapY = margin + Math.random() * (H - margin * 2 - gap);
    state.walls.push({ x, gapY, gap, passed: false, hue: 180 + Math.random() * 100 });
  }

  function reset() {
    state.comet = { x: 100, y: H / 2, vy: 0 };
    state.walls = [];
    state.trail = [];
    state.sparks = [];
    state.score = 0;
    state.speed = START_SPEED;
    state.newBest = false;
    for (let i = 0; i < 3; i++) addWall(W + 120 + i * WALL_SPACING);
  }

  function startGame() {
    reset();
    state.mode = 'play';
    boost();
  }

  function boost() {
    state.comet.vy = BOOST;
    sfx.boost();
  }

  function crash() {
    state.mode = 'over';
    state.overAt = state.time;
    state.shake = 12;
    sfx.crash();
    vibrate(120);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 260;
      state.sparks.push({
        x: state.comet.x, y: state.comet.y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.6 + Math.random() * 0.6, age: 0,
      });
    }
    if (state.score > state.best) {
      state.best = state.score;
      state.newBest = true;
      saveBest(state.best);
    }
  }

  // ---------- Input ----------
  function onPress(e) {
    if (e) e.preventDefault();
    if (state.mode === 'menu') startGame();
    else if (state.mode === 'play') boost();
    else if (state.mode === 'over' && state.time - state.overAt > 0.6) startGame();
  }
  canvas.addEventListener('pointerdown', onPress);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
      if (!e.repeat) onPress(e);
    }
  });

  // ---------- Update ----------
  function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function update(dt) {
    state.time += dt;
    const c = state.comet;

    // Stars drift (slower when not playing)
    const drift = state.mode === 'play' ? state.speed : 40;
    for (const s of stars) {
      s.x -= drift * s.depth * dt;
      if (s.x < -2) { s.x = W + 2; s.y = Math.random() * H; }
      s.tw += dt * 3;
    }

    if (state.mode === 'menu') {
      c.y = H / 2 + Math.sin(state.time * 2.5) * 18;
    }

    if (state.mode === 'play') {
      c.vy = Math.min(MAX_FALL, c.vy + GRAVITY * dt);
      c.y += c.vy * dt;
      state.speed = Math.min(MAX_SPEED, START_SPEED + state.score * 3);

      for (const w of state.walls) {
        w.x -= state.speed * dt;
        if (!w.passed && w.x + WALL_W < c.x) {
          w.passed = true;
          state.score++;
          sfx.score();
        }
      }
      if (state.walls.length && state.walls[0].x + WALL_W < -10) {
        state.walls.shift();
        const last = state.walls[state.walls.length - 1];
        addWall(last.x + WALL_SPACING);
      }

      // Collisions
      if (c.y - COMET_R < 0 || c.y + COMET_R > H) {
        c.y = Math.max(COMET_R, Math.min(H - COMET_R, c.y));
        crash();
      } else {
        const r = COMET_R - 3; // slightly forgiving hitbox
        for (const w of state.walls) {
          if (circleRectHit(c.x, c.y, r, w.x, 0, WALL_W, w.gapY) ||
              circleRectHit(c.x, c.y, r, w.x, w.gapY + w.gap, WALL_W, H - w.gapY - w.gap)) {
            crash();
            break;
          }
        }
      }
    }

    // Trail
    if (state.mode !== 'over') {
      state.trail.push({ x: c.x, y: c.y, age: 0 });
    }
    for (const t of state.trail) {
      t.x -= (state.mode === 'play' ? state.speed : 60) * dt;
      t.age += dt;
    }
    while (state.trail.length && state.trail[0].age > 0.45) state.trail.shift();

    // Sparks
    for (const p of state.sparks) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.vx *= 0.98;
    }
    state.sparks = state.sparks.filter((p) => p.age < p.life);

    state.shake = Math.max(0, state.shake - dt * 40);
  }

  // ---------- Draw ----------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1026');
    g.addColorStop(1, '#241449');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      const a = 0.45 + 0.35 * Math.sin(s.tw) * s.depth;
      ctx.fillStyle = `rgba(220,230,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCrystal(x, y, w, h, hue, capAtBottom) {
    if (h <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, `hsla(${hue},80%,45%,0.95)`);
    g.addColorStop(0.5, `hsla(${hue},90%,70%,0.95)`);
    g.addColorStop(1, `hsla(${hue},80%,40%,0.95)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // Faceted cap at the gap edge
    const capY = capAtBottom ? y + h : y;
    const dir = capAtBottom ? 1 : -1;
    ctx.fillStyle = `hsla(${hue},95%,80%,1)`;
    ctx.beginPath();
    ctx.moveTo(x - 4, capY);
    ctx.lineTo(x + w / 2, capY + dir * 12);
    ctx.lineTo(x + w + 4, capY);
    ctx.closePath();
    ctx.fill();

    // Shine line
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 8, y, 4, h);
  }

  function drawWalls() {
    for (const w of state.walls) {
      drawCrystal(w.x, 0, WALL_W, w.gapY, w.hue, true);
      drawCrystal(w.x, w.gapY + w.gap, WALL_W, H - w.gapY - w.gap, w.hue, false);
    }
  }

  function drawComet() {
    // Trail
    for (const t of state.trail) {
      const k = 1 - t.age / 0.45;
      ctx.fillStyle = `rgba(255,170,80,${0.35 * k})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, COMET_R * (0.3 + 0.7 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.mode === 'over') return;

    const c = state.comet;
    const glow = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, COMET_R * 2.4);
    glow.addColorStop(0, 'rgba(255,240,200,0.9)');
    glow.addColorStop(0.4, 'rgba(255,170,80,0.45)');
    glow.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c.x, c.y, COMET_R * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff6dc';
    ctx.beginPath();
    ctx.arc(c.x, c.y, COMET_R, 0, Math.PI * 2);
    ctx.fill();

    // Little face so it has some character
    const tilt = Math.max(-0.5, Math.min(0.6, c.vy / 900));
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(tilt);
    ctx.fillStyle = '#2b1a4a';
    ctx.beginPath(); ctx.arc(4, -3, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-3, -3, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2b1a4a';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0.5, 2, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.restore();
  }

  function drawSparks() {
    for (const p of state.sparks) {
      const k = 1 - p.age / p.life;
      ctx.fillStyle = `rgba(255,${150 + 100 * k | 0},90,${k})`;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
  }

  function text(str, x, y, size, color = '#fff', align = 'center', weight = '800') {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = 'rgba(11,16,38,0.85)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(11,16,38,0.72)';
    ctx.strokeStyle = 'rgba(160,180,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    ctx.stroke();
  }

  function drawUI() {
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
    if (state.mode === 'menu') {
      text('COMET', W / 2, 150, 56, '#ffd38a');
      text('DASH', W / 2, 205, 56, '#9fe6ff');
      ctx.globalAlpha = pulse;
      text('Tap to start', W / 2, 470, 24, '#ffffff', 'center', '700');
      ctx.globalAlpha = 1;
      text('Tap to boost through the crystal gaps', W / 2, 520, 15, '#c8d0ff', 'center', '500');
      if (state.best > 0) text(`Best: ${state.best}`, W / 2, 570, 18, '#ffd38a', 'center', '700');
    } else if (state.mode === 'play') {
      text(String(state.score), W / 2, 70, 52);
    } else if (state.mode === 'over') {
      panel(50, 190, W - 100, 230);
      text('Game Over', W / 2, 230, 34, '#ff9b8a');
      text('Score', W / 2 - 65, 290, 16, '#c8d0ff', 'center', '600');
      text('Best', W / 2 + 65, 290, 16, '#c8d0ff', 'center', '600');
      text(String(state.score), W / 2 - 65, 325, 38);
      text(String(state.best), W / 2 + 65, 325, 38, '#ffd38a');
      if (state.newBest) text('New best!', W / 2, 368, 18, '#9fe6ff', 'center', '700');
      if (state.time - state.overAt > 0.6) {
        ctx.globalAlpha = pulse;
        text('Tap to play again', W / 2, 400, 20, '#ffffff', 'center', '700');
        ctx.globalAlpha = 1;
      }
    }
  }

  function draw() {
    ctx.save();
    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }
    drawBackground();
    drawWalls();
    drawComet();
    drawSparks();
    ctx.restore();
    drawUI();
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); // clamp to avoid big jumps
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Pause-friendly: avoid a huge dt after returning from background
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
})();
