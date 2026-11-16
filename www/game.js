// Night Watch — keep your finger on the glowing path. Don't let go, don't step into the dark.
(() => {
  'use strict';

  // Logical game size. The canvas is scaled to fit the screen.
  const W = 360;
  const H = 640;

  // Tuning
  const START_SPEED = 110;   // px/s the path scrolls toward you
  const MAX_SPEED = 300;
  const SPEED_GAIN = 2.2;    // extra px/s per second survived
  const START_WIDTH = 150;   // path width at the start
  const MIN_WIDTH = 62;
  const NARROW_RATE = 0.012; // width lost per px travelled
  const STEP = 8;            // world px between path points
  const LIGHT_R = 120;       // flashlight radius
  const FIREFLY_EVERY = 320; // world px between fireflies
  const FIREFLY_BONUS = 10;
  const START_Y = H - 130;   // where you put your finger to begin

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
    try { return parseInt(localStorage.getItem('nightwatch.best') || '0', 10) || 0; }
    catch { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('nightwatch.best', String(v)); } catch { /* ignore */ }
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
    firefly: () => { beep(1046, 0.07, 'sine', 0.06); setTimeout(() => beep(1568, 0.12, 'sine', 0.05), 60); },
    over: () => beep(330, 0.6, 'sawtooth', 0.07, 60),
    warn: () => beep(180, 0.05, 'square', 0.03),
  };
  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
  }

  // ---------- The path ----------
  // The path lives in "world" coordinates: w = distance from the start line, growing upward.
  // A point at world w is drawn at screen y = START_Y - (w - distance).
  const path = {
    pts: [],      // { x, width } for w = i * STEP
    targetX: W / 2,
    x: W / 2,
  };

  function resetPath() {
    path.pts = [];
    path.x = W / 2;
    path.targetX = W / 2;
  }

  function extendPath(toW) {
    while (path.pts.length * STEP < toW) {
      const w = path.pts.length * STEP;
      const width = Math.max(MIN_WIDTH, START_WIDTH - w * NARROW_RATE);
      const margin = width / 2 + 14;
      if (w < 260) {
        // Straight runway at the start so you can settle in
        path.x = W / 2;
        path.targetX = W / 2;
      } else {
        if (Math.abs(path.targetX - path.x) < 4) {
          path.targetX = margin + Math.random() * (W - margin * 2);
        }
        // Turns get sharper the further you go
        const maxSlope = Math.min(5.5, 1.8 + w / 2500);
        const dx = Math.max(-maxSlope, Math.min(maxSlope, (path.targetX - path.x) * 0.06));
        path.x = Math.max(margin, Math.min(W - margin, path.x + dx));
      }
      path.pts.push({ x: path.x, width });
    }
  }

  function pathAt(w) {
    if (w < 0) return { x: W / 2, width: START_WIDTH };
    extendPath(w + STEP * 2);
    const i = Math.floor(w / STEP);
    const t = (w - i * STEP) / STEP;
    const a = path.pts[i], b = path.pts[i + 1];
    return { x: a.x + (b.x - a.x) * t, width: a.width + (b.width - a.width) * t };
  }

  // ---------- Game state ----------
  const state = {
    mode: 'menu', // 'menu' | 'play' | 'over'
    distance: 0,
    speed: START_SPEED,
    playTime: 0,
    bonus: 0,
    best: loadBest(),
    newBest: false,
    finger: null,      // { x, y } while held
    pointerId: null,
    fireflies: [],     // { w, offset, alive, phase }
    nextFireflyW: FIREFLY_EVERY,
    popups: [],        // floating "+10" text
    edge: 0,           // 0..1, how close the finger is to the edge
    warnTimer: 0,
    reason: '',
    time: 0,
    overAt: 0,
    shake: 0,
    moths: [],         // background ambience
  };
  window.__nightWatch = { state, pathAt }; // handy for debugging in the browser console

  for (let i = 0; i < 30; i++) {
    state.moths.push({ x: Math.random() * W, y: Math.random() * H, p: Math.random() * 10, s: 0.3 + Math.random() * 0.7 });
  }

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
    if (state.pointerId !== null) return; // only the first finger counts
    const p = toGame(e);
    state.pointerId = e.pointerId;
    state.finger = p;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    if (state.mode === 'menu' || (state.mode === 'over' && state.time - state.overAt > 0.8)) {
      // You must start by placing your finger on the start circle
      const dx = p.x - W / 2, dy = p.y - START_Y;
      if (dx * dx + dy * dy < 50 * 50) {
        startGame();
        state.finger = { x: p.x, y: p.y };
      }
    }
  }

  function onMove(e) {
    if (e.pointerId !== state.pointerId) return;
    e.preventDefault();
    state.finger = toGame(e);
  }

  function onUp(e) {
    if (e.pointerId !== state.pointerId) return;
    state.pointerId = null;
    state.finger = null;
    if (state.mode === 'play') gameOver('You let go!');
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', () => { if (state.mode === 'play') gameOver('You let go!'); state.pointerId = null; state.finger = null; });

  // ---------- Update ----------
  function update(dt) {
    state.time += dt;

    for (const m of state.moths) {
      m.p += dt * m.s;
      m.y += Math.sin(m.p * 1.7) * 6 * dt;
      m.x += Math.cos(m.p) * 10 * dt;
      if (m.x < 0) m.x += W; if (m.x > W) m.x -= W;
    }

    if (state.mode === 'play') {
      state.playTime += dt;
      state.speed = Math.min(MAX_SPEED, START_SPEED + state.playTime * SPEED_GAIN);
      state.distance += state.speed * dt;

      // Spawn fireflies ahead on the path
      const aheadW = state.distance + START_Y + 40;
      while (state.nextFireflyW < aheadW) {
        const p = pathAt(state.nextFireflyW);
        state.fireflies.push({
          w: state.nextFireflyW,
          offset: (Math.random() - 0.5) * p.width * 0.5,
          alive: true,
          phase: Math.random() * 6,
        });
        state.nextFireflyW += FIREFLY_EVERY * (0.7 + Math.random() * 0.6);
      }

      const f = state.finger;
      if (!f) {
        gameOver('You let go!');
      } else {
        // Is the finger on the path?
        const w = state.distance + (START_Y - f.y);
        const p = pathAt(w);
        const half = p.width / 2;
        const off = Math.abs(f.x - p.x);
        state.edge = Math.max(0, Math.min(1, (off - half * 0.6) / (half * 0.4)));
        if (off > half) {
          gameOver('Lost in the dark!');
        } else if (state.edge > 0.5) {
          state.warnTimer -= dt;
          if (state.warnTimer <= 0) { sfx.warn(); vibrate(15); state.warnTimer = 0.18; }
        }

        // Collect fireflies
        for (const fl of state.fireflies) {
          if (!fl.alive) continue;
          const fp = pathAt(fl.w);
          const fx = fp.x + fl.offset;
          const fy = START_Y - (fl.w - state.distance);
          const dx = fx - f.x, dy = fy - f.y;
          if (dx * dx + dy * dy < 34 * 34) {
            fl.alive = false;
            state.bonus += FIREFLY_BONUS;
            state.popups.push({ x: fx, y: fy, age: 0 });
            sfx.firefly();
            vibrate(20);
          }
        }
      }
      state.fireflies = state.fireflies.filter((fl) => fl.alive && START_Y - (fl.w - state.distance) < H + 30);
    }

    for (const p of state.popups) { p.age += dt; p.y -= 40 * dt; }
    state.popups = state.popups.filter((p) => p.age < 0.9);
    state.shake = Math.max(0, state.shake - dt * 30);
  }

  // ---------- Draw ----------
  function drawPath() {
    // Sample the visible part of the path and draw it as a ribbon
    const left = [], right = [], center = [];
    for (let y = H + 20; y >= -20; y -= 6) {
      const w = state.distance + (START_Y - y);
      const p = pathAt(w);
      left.push([p.x - p.width / 2, y]);
      right.push([p.x + p.width / 2, y]);
      center.push([p.x, y]);
    }

    // Soft outer glow
    ctx.save();
    ctx.shadowColor = 'rgba(120,200,255,0.8)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#16324a';
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const [x, y] of left) ctx.lineTo(x, y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Edge lines
    ctx.strokeStyle = '#7fd4ff';
    ctx.lineWidth = 3;
    for (const side of [left, right]) {
      ctx.beginPath();
      side.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }

    // Dashed center line, scrolling with the path
    ctx.save();
    ctx.setLineDash([10, 16]);
    ctx.lineDashOffset = -state.distance;
    ctx.strokeStyle = 'rgba(200,235,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    center.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }

  function drawFireflies() {
    for (const fl of state.fireflies) {
      const p = pathAt(fl.w);
      const x = p.x + fl.offset + Math.sin(state.time * 3 + fl.phase) * 5;
      const y = START_Y - (fl.w - state.distance) + Math.cos(state.time * 2.3 + fl.phase) * 4;
      const k = 0.7 + 0.3 * Math.sin(state.time * 8 + fl.phase);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
      g.addColorStop(0, `rgba(255,250,170,${k})`);
      g.addColorStop(0.35, `rgba(220,255,120,${0.5 * k})`);
      g.addColorStop(1, 'rgba(200,255,100,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawDarkness() {
    // Darkness everywhere except a pool of light around the finger.
    const f = state.finger && state.mode !== 'over' ? state.finger : null;
    if (f) {
      const g = ctx.createRadialGradient(f.x, f.y, 10, f.x, f.y, LIGHT_R);
      g.addColorStop(0, 'rgba(4,6,14,0)');
      g.addColorStop(0.6, 'rgba(4,6,14,0.25)');
      g.addColorStop(1, 'rgba(4,6,14,0.78)');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = 'rgba(4,6,14,0.55)';
    }
    ctx.fillRect(0, 0, W, H);

    // Shadows creeping in from the edges (stronger as you go further)
    const creep = Math.min(1, state.playTime / 90);
    const edge = 40 + creep * 50;
    let g2 = ctx.createLinearGradient(0, 0, edge, 0);
    g2.addColorStop(0, 'rgba(0,0,0,0.9)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, edge, H);
    g2 = ctx.createLinearGradient(W, 0, W - edge, 0);
    g2.addColorStop(0, 'rgba(0,0,0,0.9)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(W - edge, 0, edge, H);
    g2 = ctx.createLinearGradient(0, 0, 0, 120);
    g2.addColorStop(0, 'rgba(0,0,0,0.85)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, 120);

    // Danger tint when near the edge
    if (state.mode === 'play' && state.edge > 0) {
      ctx.fillStyle = `rgba(255,40,60,${0.18 * state.edge})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawFinger() {
    const f = state.finger;
    if (!f || state.mode !== 'play') return;
    const danger = state.edge;
    ctx.strokeStyle = danger > 0.5 ? '#ff6b7a' : '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 26 + Math.sin(state.time * 10) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawStartCircle() {
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 4);
    ctx.save();
    ctx.shadowColor = '#7fd4ff';
    ctx.shadowBlur = 20 + pulse * 15;
    ctx.strokeStyle = '#bfe9ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(W / 2, START_Y, 40 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = `rgba(191,233,255,${0.15 + pulse * 0.15})`;
    ctx.beginPath();
    ctx.arc(W / 2, START_Y, 40, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMoths() {
    for (const m of state.moths) {
      ctx.fillStyle = `rgba(170,190,255,${0.15 + 0.15 * Math.sin(m.p * 3)})`;
      ctx.fillRect(m.x, m.y, 2, 2);
    }
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
    ctx.fillStyle = 'rgba(8,12,28,0.85)';
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
      text('NIGHT', W / 2, 130, 58, '#bfe9ff');
      text('WATCH', W / 2, 188, 58, '#fff3a8');
      text('Keep your finger on the glowing path.', W / 2, 260, 15, '#c8d6ff', 'center', '500');
      text("Don't let go. Don't step into the dark.", W / 2, 284, 15, '#c8d6ff', 'center', '500');
      text('Catch fireflies for bonus points.', W / 2, 308, 15, '#e8ff9a', 'center', '500');
      drawStartCircle();
      ctx.globalAlpha = pulse;
      text('Hold here to start', W / 2, START_Y + 75, 20, '#ffffff', 'center', '700');
      ctx.globalAlpha = 1;
      if (state.best > 0) text(`Best: ${state.best}`, W / 2, 380, 18, '#fff3a8', 'center', '700');
    } else if (state.mode === 'play') {
      text(String(score()), W / 2, 56, 44);
    } else if (state.mode === 'over') {
      panel(40, 150, W - 80, 250);
      text(state.reason, W / 2, 190, 26, '#ff9b8a');
      text('Score', W / 2 - 65, 245, 16, '#c8d6ff', 'center', '600');
      text('Best', W / 2 + 65, 245, 16, '#c8d6ff', 'center', '600');
      text(String(score()), W / 2 - 65, 282, 40);
      text(String(state.best), W / 2 + 65, 282, 40, '#fff3a8');
      if (state.newBest) text('New best!', W / 2, 330, 20, '#7fd4ff', 'center', '700');
      if (state.time - state.overAt > 0.8) {
        drawStartCircle();
        ctx.globalAlpha = pulse;
        text('Hold the circle to play again', W / 2, START_Y + 75, 18, '#ffffff', 'center', '700');
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
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, W, H);
    drawMoths();
    drawPath();
    drawDarkness();
    drawFireflies(); // drawn over the darkness so they glow
    drawFinger();
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

  // If the app goes to the background mid-run, that counts as letting go
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    if (document.hidden && state.mode === 'play') gameOver('You let go!');
  });
})();
