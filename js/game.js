/* Squeek Rally: 3D gameplay.
 * A hamster ball rolls along a floating tile road. Tiles are laid ("paved") ahead of you,
 * glowing gold while Squeektoshi is running and turning night-blue while he sleeps.
 * Live wheel speed sets Wheel Power (speed and score multiplier); every Squeek block
 * mined on Squeekchain drops a golden block crystal on the road. */
'use strict';
window.SR = window.SR || {};

(() => {
  const SR = window.SR;
  const { Geo, Engine, Batch } = SR;

  // ------------------------------------------------------------ tuning
  const LANE_X = [-2.3, 0, 2.3];
  const ROW = 2.2;
  const AHEAD = 72;
  const BEHIND = 8;
  const GRAVITY = -30;
  const JUMP_V = 11.5;
  const BALL_R = 0.78;
  const START_LIVES = 3;

  const SKINS = {
    classic:  { name: 'Classic Gold', shell: [1.0, 0.78, 0.3, 0.32], ring: [1.0, 0.75, 0.25], fur: [0.93, 0.62, 0.32], belly: [1, 0.92, 0.8], trail: [1.0, 0.75, 0.25] },
    sapphire: { name: 'Sapphire', shell: [0.35, 0.6, 1.0, 0.32], ring: [0.4, 0.65, 1.0], fur: [0.98, 0.9, 0.78], belly: [1, 1, 1], trail: [0.4, 0.65, 1.0] },
    night:    { name: 'Night Owl', shell: [0.62, 0.42, 1.0, 0.32], ring: [0.7, 0.5, 1.0], fur: [0.55, 0.55, 0.6], belly: [0.85, 0.85, 0.9], trail: [0.75, 0.5, 1.0] },
    genesis:  { name: 'Genesis', shell: [1.0, 0.96, 0.85, 0.36], ring: [1.0, 0.85, 0.4], fur: [1, 1, 1], belly: [1, 0.95, 0.85], trail: [1.0, 0.95, 0.6] },
  };

  // ------------------------------------------------------------ path
  const pathX = s => 3.4 * Math.sin(s * 0.011) + 1.7 * Math.sin(s * 0.029 + 1.3);
  const pathY = s => 1.6 * Math.sin(s * 0.016) + 0.7 * Math.sin(s * 0.047 + 0.4);
  const pathYaw = s => Math.atan((pathX(s + 0.5) - pathX(s - 0.5)));
  const lanePos = (s, laneF) => {
    const yaw = pathYaw(s);
    const lx = (laneF - 1) * 2.3;
    return [pathX(s) + lx * Math.cos(yaw), pathY(s), -s + lx * Math.sin(yaw)];
  };

  const hashRng = seed => {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  // ------------------------------------------------------------ audio
  const Sound = {
    ctx: null, enabled: true,
    ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.enabled = false; } } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    tone(freq, dur = 0.1, type = 'sine', vol = 0.08, slide = 0) {
      if (!this.enabled || !this.ctx) return;
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    seed() { this.tone(880 + Math.random() * 200, 0.08, 'triangle', 0.05); },
    coin() { this.tone(1320, 0.12, 'square', 0.035); setTimeout(() => this.tone(1760, 0.1, 'square', 0.03), 60); },
    jump() { this.tone(300, 0.18, 'sine', 0.06, 400); },
    lane() { this.tone(520, 0.04, 'sine', 0.025); },
    crash() { this.tone(120, 0.35, 'sawtooth', 0.08, -60); },
    block() { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.05), i * 90)); },
  };

  // ------------------------------------------------------------ game
  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.eng = new Engine(canvas);
      const e = this.eng;
      this.mesh = {
        tile: e.mesh(Geo.bevelBox([0.5, 0.5, 0.55], [1, 1, 1], 0.14)),
        cube: e.mesh(Geo.box()),
        sphere: e.mesh(Geo.icosphere(2)),
        lowSphere: e.mesh(Geo.icosphere(1)),
        gem: e.mesh(Geo.icosphere(0)),
        cyl: e.mesh(Geo.cylinder(18)),
        ring: e.mesh(Geo.torus(0.5, 0.045, 40, 6)),
        thinRing: e.mesh(Geo.torus(0.5, 0.02, 48, 5)),
        pillow: e.mesh(Geo.bevelBox([0.85, 0.85, 0.95], [1, 1, 1], 0.3)),
        rock: [1, 2, 3].map(k => e.mesh(Geo.rock(k * 977))),
      };
      const B = n => new Batch(n);
      this.b = {
        tile: B(260), strip: B(260), support: B(40), pillow: B(40), hurdle: B(60), seedDark: B(120), seedLight: B(120),
        coin: B(40), gem: B(10), gemRing: B(140), particle: B(260), rock: [B(30), B(30), B(30)], wheel: B(4), spoke: B(16), star: B(1),
        shell: B(1), shellRing: B(3), fur: B(10), dark: B(6), pink: B(4), glow: B(4),
      };
      this.quality = 'high';
      this.skin = SKINS.classic;
      this.listeners = {};
      this.wheel = { running: false, rpm: 0, power: 1, angle: 0 };
      this.particles = [];
      this.clock = 0;
      this.mode = 'menu';
      this.cam = { eye: [0, 5, 10], target: [0, 1, -10], shake: 0 };
      this.#resetWorld();
      this.#bindInput();
      this.last = performance.now();
      requestAnimationFrame(t => this.#frame(t));
    }

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    #emit(ev, p) { (this.listeners[ev] || []).forEach(fn => fn(p)); }

    setSkin(id) { this.skin = SKINS[id] || SKINS.classic; }
    setQuality(q) { this.quality = q; }
    setSound(on) { Sound.enabled = on; }
    setWheel(running, rpm) {
      const was = this.wheel.running;
      this.wheel.running = running;
      this.wheel.rpm = rpm;
      if (this.mode === 'play' && running && !was) this.#emit('notice', { kind: 'run', text: 'Squeektoshi is running! Gold road and Wheel Power up.' });
      if (this.mode === 'play' && !running && was) this.#emit('notice', { kind: 'rest', text: 'Squeektoshi stopped. Night road: watch for pillows.' });
    }
    blockMined(height) {
      if (this.mode !== 'play') return;
      this.pendingGems.push(height);
      Sound.block();
      this.#emit('notice', { kind: 'block', text: `Squeek block #${height} mined! A block crystal is on the road.` });
    }

    // ---------------------------------------------------------- run lifecycle
    #resetWorld() {
      this.rows = new Map();
      this.gen = { next: 0, safe: 1, hold: 4, holeRun: [0, 0, 0], protect: [0, 0, 0], lastHurdle: 0, seedRun: 0, seedLane: 1 };
      this.p = { s: 0, laneF: 1, target: 1, y: 0, vy: 0, speed: 10, fall: 0, invuln: 0, slow: 0, roll: 0, tilt: 0, alive: true };
      this.pendingGems = [];
      this.stats = { score: 0, seeds: 0, coins: 0, gems: 0, lives: START_LIVES, best: 0 };
      this.seedRng = hashRng(Date.now() & 0xffffff);
      for (let i = 0; i < AHEAD; i++) this.#genRow(-1 + i * 0.012);
    }

    startRun({ multiplier = 1 } = {}) {
      Sound.ensure();
      this.#resetWorld();
      this.mult = multiplier;
      this.mode = 'play';
      this.runTime = 0;
      this.#emit('hud', this.#hud());
    }
    pause() { if (this.mode === 'play') this.mode = 'paused'; }
    resume() { if (this.mode === 'paused') { this.mode = 'play'; this.last = performance.now(); } }
    toMenu() { this.mode = 'menu'; this.#resetWorld(); }

    #endRun() {
      this.mode = 'over';
      this.#emit('over', {
        score: Math.round(this.stats.score), seeds: this.stats.seeds, coins: this.stats.coins, gems: this.stats.gems,
        distanceM: Math.round(this.p.s), multiplier: this.mult,
      });
    }

    // ---------------------------------------------------------- track generation
    #genRow(bornAt) {
      const g = this.gen;
      const i = g.next++;
      const r = hashRng((i * 2654435761) ^ (this.seedRng() * 1e9));
      const d = clamp(i / 700, 0, 1);
      const night = !this.wheel.running;
      const row = { i, s: i * ROW, holes: [false, false, false], pillow: -1, hurdle: false, pickups: [], born: bornAt, gold: this.wheel.running, crossed: false };

      if (i > 14) {
        if (g.hold-- <= 0) {
          const prev = g.safe;
          if (r() < 0.55) g.safe = clamp(g.safe + (r() < 0.5 ? -1 : 1), 0, 2);
          if (g.safe !== prev) { g.protect[prev] = 4; g.protect[g.safe] = 4; }
          g.hold = 4 + Math.floor(r() * 6);
        }
        for (let l = 0; l < 3; l++) {
          if (l === g.safe || g.protect[l] > 0) { g.holeRun[l] = 0; continue; }
          if (g.holeRun[l] > 0) { row.holes[l] = true; g.holeRun[l]--; }
          else if (r() < 0.035 + 0.11 * d) { row.holes[l] = true; g.holeRun[l] = 1 + Math.floor(r() * 3); }
        }
        const free = [0, 1, 2].filter(l => !row.holes[l] && l !== g.safe && g.protect[l] <= 0);
        if (free.length && r() < 0.05 + 0.07 * d + (night ? 0.07 : 0)) row.pillow = free[Math.floor(r() * free.length)];
        if (!row.holes.some(Boolean) && row.pillow < 0 && i - g.lastHurdle > 14 && r() < 0.03 + 0.04 * d) { row.hurdle = true; g.lastHurdle = i; }
        for (let l = 0; l < 3; l++) if (g.protect[l] > 0) g.protect[l]--;

        if (g.seedRun > 0) {
          if (!row.holes[g.seedLane] && row.pillow !== g.seedLane) row.pickups.push({ type: 'seed', lane: g.seedLane, y: row.hurdle ? 1.9 : 0.9, taken: false });
          g.seedRun--;
        } else if (r() < 0.18) {
          g.seedRun = 4 + Math.floor(r() * 7);
          g.seedLane = r() < 0.6 ? g.safe : Math.floor(r() * 3);
        }
        if (this.wheel.running && r() < 0.045) {
          const opts = [0, 1, 2].filter(l => !row.holes[l] && row.pillow !== l && !row.pickups.some(p => p.lane === l));
          if (opts.length) row.pickups.push({ type: 'coin', lane: opts[Math.floor(r() * opts.length)], y: 1.0, taken: false });
        }
        if (this.pendingGems.length && !row.hurdle) {
          row.pickups.push({ type: 'gem', lane: g.safe, y: 1.4, taken: false, height: this.pendingGems.shift() });
          row.holes[g.safe] = false;
        }
      } else if (i > 4 && i % 2 === 0) {
        row.pickups.push({ type: 'seed', lane: 1, y: 0.9, taken: false });
      }
      this.rows.set(i, row);
    }

    // ---------------------------------------------------------- input
    #bindInput() {
      const press = dir => {
        if (this.mode !== 'play' || this.p.fall > 0) return;
        if (dir === 'left' && this.p.target > 0) { this.p.target--; Sound.lane(); }
        if (dir === 'right' && this.p.target < 2) { this.p.target++; Sound.lane(); }
        if (dir === 'jump' && this.p.y <= 0.001) { this.p.vy = JUMP_V; Sound.jump(); }
        if (dir === 'down' && this.p.y > 0) this.p.vy = Math.min(this.p.vy, -16);
      };
      this.press = press;
      const keys = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'down', KeyS: 'down' };
      window.addEventListener('keydown', e => {
        const k = keys[e.code];
        if (!k || this.mode !== 'play') return;
        e.preventDefault();
        if (!e.repeat) press(k);
      });
      let sx = 0, sy = 0, st = 0, tracking = false;
      this.canvas.addEventListener('pointerdown', e => { tracking = true; sx = e.clientX; sy = e.clientY; st = performance.now(); });
      this.canvas.addEventListener('pointerup', e => {
        if (!tracking) return;
        tracking = false;
        const dx = e.clientX - sx, dy = e.clientY - sy, dt = performance.now() - st;
        const min = 24;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > min) press(dx < 0 ? 'left' : 'right');
        else if (Math.abs(dy) > min) press(dy < 0 ? 'jump' : 'down');
        else if (dt < 250) press('jump');
      });
      this.canvas.addEventListener('pointercancel', () => { tracking = false; });
    }

    // ---------------------------------------------------------- simulation
    #update(dt) {
      this.clock += dt;
      const w = this.wheel;
      const targetPower = w.running ? 1 + clamp(w.rpm / 60, 0.2, 1.5) : 1;
      w.power = lerp(w.power, targetPower, Math.min(1, dt * 1.5));
      w.angle += (w.running ? Math.max(w.rpm, 20) : 4) / 60 * Math.PI * 2 * dt * 0.25;

      const p = this.p;
      if (this.mode === 'menu') {
        p.speed = 9;
        p.s += p.speed * dt;
        const row = this.rows.get(Math.floor(p.s / ROW) + 3);
        if (row && (row.holes[p.target] || row.pillow === p.target)) {
          const ok = [1, 0, 2].find(l => !row.holes[l] && row.pillow !== l);
          if (ok !== undefined) p.target = ok;
        }
        p.laneF = lerp(p.laneF, p.target, Math.min(1, dt * 3));
        p.roll += p.speed * dt / BALL_R;
        this.#maintainRows();
        this.#updateParticles(dt);
        return;
      }
      if (this.mode !== 'play') return;

      this.runTime += dt;
      const base = 13 + Math.min(11, p.s / 220);
      const wheelBoost = w.running ? 1 + 0.22 * (w.power - 1) : 0.92;
      let target = base * wheelBoost;
      if (p.slow > 0) { p.slow -= dt; target *= 0.55; }
      p.speed = lerp(p.speed, target, Math.min(1, dt * 2));

      const prevS = p.s;
      if (p.fall > 0) {
        p.fall += dt;
        p.vy += GRAVITY * dt;
        p.y += p.vy * dt;
        p.s += p.speed * 0.5 * dt;
        if (p.fall > 1.0) this.#respawn();
      } else {
        p.s += p.speed * dt;
        p.laneF = lerp(p.laneF, p.target, Math.min(1, dt * 16));
        if (Math.abs(p.laneF - p.target) < 0.01) p.laneF = p.target;
        if (p.y > 0 || p.vy > 0) {
          p.vy += GRAVITY * dt;
          p.y = Math.max(0, p.y + p.vy * dt);
          if (p.y === 0) p.vy = 0;
        }
      }
      p.roll += p.speed * dt / BALL_R;
      p.tilt = lerp(p.tilt, (p.target - p.laneF) * -0.5, Math.min(1, dt * 10));
      if (p.invuln > 0) p.invuln -= dt;

      // row crossings: holes, pillows, hurdles
      if (p.fall <= 0) {
        const from = Math.floor(prevS / ROW), to = Math.floor(p.s / ROW);
        for (let i = from + 1; i <= to; i++) {
          const row = this.rows.get(i);
          if (!row || row.crossed) continue;
          row.crossed = true;
          const lane = Math.round(p.laneF);
          if (row.holes[lane] && p.y < 0.35) { this.#fall(); break; }
          if (p.invuln > 0) continue;
          if (row.pillow === lane && p.y < 1.1) { this.#crash(); break; }
          if (row.hurdle && p.y < 0.85) { this.#crash(); break; }
        }
      }

      // pickups
      const near = Math.round(p.s / ROW);
      for (let i = near - 1; i <= near + 1; i++) {
        const row = this.rows.get(i);
        if (!row) continue;
        for (const k of row.pickups) {
          if (k.taken || Math.abs(row.s - p.s) > 1.4 || Math.abs(k.lane - p.laneF) > 0.55 || Math.abs((p.y + 1.0) - k.y) > 1.5) continue;
          k.taken = true;
          const pos = lanePos(row.s, k.lane);
          if (k.type === 'seed') { this.stats.seeds++; this.stats.score += 25 * w.power * this.mult; Sound.seed(); this.#burst(pos, k.y, [1, 0.85, 0.4], 6); }
          if (k.type === 'coin') { this.stats.coins++; this.stats.score += 200 * this.mult; Sound.coin(); this.#burst(pos, k.y, [1, 0.8, 0.2], 14); }
          if (k.type === 'gem') { this.stats.gems++; this.stats.score += 1500 * this.mult; Sound.block(); this.#burst(pos, k.y, [1, 0.95, 0.5], 40); this.#emit('notice', { kind: 'gem', text: `Block crystal #${k.height} collected: +${1500 * this.mult}` }); }
        }
      }

      this.stats.score += p.speed * dt * w.power * this.mult * 0.6;
      this.#maintainRows();
      this.#updateParticles(dt);

      // trail
      if (this.quality !== 'low' && p.fall <= 0 && Math.random() < dt * (w.running ? 40 : 14)) {
        const pos = lanePos(p.s - 0.6, p.laneF);
        this.particles.push({ x: pos[0] + (Math.random() - 0.5) * 0.6, y: pos[1] + p.y + 0.15, z: pos[2] + 0.3, vx: 0, vy: 0.6 + Math.random(), vz: 1.5, life: 0.6, max: 0.6, size: 0.12, col: this.skin.trail });
      }

      this.hudTimer = (this.hudTimer || 0) + dt;
      if (this.hudTimer > 0.1) { this.hudTimer = 0; this.#emit('hud', this.#hud()); }
    }

    #hud() {
      return {
        score: Math.round(this.stats.score), seeds: this.stats.seeds, coins: this.stats.coins, gems: this.stats.gems,
        lives: this.stats.lives, power: this.wheel.power, running: this.wheel.running, speed: this.p.speed, distanceM: Math.round(this.p.s), multiplier: this.mult,
      };
    }

    #maintainRows() {
      const pr = Math.floor(this.p.s / ROW);
      while (this.gen.next < pr + AHEAD) this.#genRow(this.clock);
      for (const k of this.rows.keys()) if (k < pr - BEHIND) this.rows.delete(k);
    }

    #fall() {
      this.p.fall = 0.001;
      this.p.vy = 2;
      this.cam.shake = 0.4;
      Sound.crash();
      this.#emit('notice', { kind: 'fall', text: 'Fell off the road!' });
    }
    #crash() {
      this.stats.lives--;
      this.p.invuln = 1.8;
      this.p.slow = 0.9;
      this.cam.shake = 0.6;
      Sound.crash();
      const pos = lanePos(this.p.s, this.p.laneF);
      this.#burst(pos, 0.8, [0.75, 0.6, 1], 24);
      this.#emit('hud', this.#hud());
      if (this.stats.lives <= 0) this.#endRun();
    }
    #respawn() {
      this.stats.lives--;
      const p = this.p;
      p.fall = 0; p.y = 0; p.vy = 0;
      p.laneF = p.target = this.gen.safe;
      // clear the next few rows so the player lands safely
      const pr = Math.floor(p.s / ROW);
      for (let i = pr - 1; i < pr + 6; i++) { const r = this.rows.get(i); if (r) { r.holes = [false, false, false]; r.pillow = -1; r.hurdle = false; r.crossed = false; } }
      p.invuln = 2;
      this.#emit('hud', this.#hud());
      if (this.stats.lives <= 0) this.#endRun();
    }

    #burst(pos, y, col, n) {
      if (this.quality === 'low') n = Math.ceil(n / 3);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5;
        this.particles.push({ x: pos[0], y: pos[1] + y, z: pos[2], vx: Math.cos(a) * v, vy: 2 + Math.random() * 5, vz: Math.sin(a) * v, life: 0.7, max: 0.7, size: 0.16, col });
      }
    }
    #updateParticles(dt) {
      for (const q of this.particles) { q.life -= dt; q.vy += -9 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; }
      this.particles = this.particles.filter(q => q.life > 0).slice(-250);
    }

    // ---------------------------------------------------------- rendering
    #render() {
      const e = this.eng, b = this.b, p = this.p, w = this.wheel, skin = this.skin;
      e.resize(this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.5 : 2);
      Object.values(b).forEach(x => Array.isArray(x) ? x.forEach(y => y.reset()) : x.reset());

      // lighting follows the wheel: warm gold while running, cool night while resting
      const k = w.running ? 1 : 0;
      e.env.lightCol = [lerp(0.7, 1.0, k), lerp(0.75, 0.86, k), lerp(0.95, 0.68, k)];
      e.env.sky = [lerp(0.32, 0.5, k), lerp(0.34, 0.42, k), lerp(0.62, 0.55, k)];
      e.env.rimCol = w.running ? [1.0, 0.7, 0.3] : [0.35, 0.45, 1.0];

      const ball = lanePos(p.s, p.laneF);
      const ballY = ball[1] + BALL_R + 0.22 + p.y;

      // camera
      const portrait = e.aspect < 1;
      const menu = this.mode === 'menu';
      const orbit = menu ? this.clock * 0.25 : 0;
      const back = portrait ? 10.5 : 8.6, up = portrait ? 6.2 : 4.4;
      const eyeT = menu
        ? [ball[0] + Math.sin(orbit) * 9, ballY + 3.2, ball[2] + Math.cos(orbit) * 9]
        : [ball[0] * 0.55 + pathX(p.s) * 0.45, ballY + up, -p.s + back];
      const tgtT = menu ? [ball[0], ballY, ball[2]] : [lanePos(p.s + 14, 1)[0], ballY - 0.6, -p.s - 14];
      const cs = Math.min(1, (menu ? 3 : 8) * (1 / 60));
      for (let i = 0; i < 3; i++) { this.cam.eye[i] = lerp(this.cam.eye[i], eyeT[i], cs * 4); this.cam.target[i] = lerp(this.cam.target[i], tgtT[i], cs * 4); }
      const shake = this.cam.shake > 0 && !this.noShake ? this.cam.shake : 0;
      this.cam.shake = Math.max(0, this.cam.shake - 1 / 60);
      const eye = [this.cam.eye[0] + (Math.random() - 0.5) * shake, this.cam.eye[1] + (Math.random() - 0.5) * shake, this.cam.eye[2]];
      e.begin(eye, this.cam.target, portrait ? 1.2 : 1.0);

      // giant WHEELY9000 on the horizon, spinning at Squeektoshi's rpm
      const wz = -p.s - 175, wx = pathX(p.s + 175) * 0.4, wy = 26;
      const goldC = w.running ? [1.0, 0.7, 0.24] : [0.42, 0.42, 0.9];
      b.wheel.add(wx, wy, wz, Math.PI / 2, 0, 0, 62, 62, 62, ...goldC);
      b.wheel.add(wx, wy, wz, Math.PI / 2, 0, 0, 44, 44, 44, ...goldC.map(c => c * 0.7));
      for (let s = 0; s < 12; s++) {
        const a = w.angle + (s / 12) * Math.PI * 2;
        b.spoke.add(wx + Math.cos(a) * 15, wy + Math.sin(a) * 15, wz, 0, 0, a + Math.PI / 2, 0.5, 30, 0.5, ...goldC.map(c => c * 0.8));
      }

      // floating rocks on both sides
      const chunk = 26;
      const c0 = Math.floor((p.s - 20) / chunk), c1 = Math.floor((p.s + 160) / chunk);
      for (let c = c0; c <= c1; c++) {
        const r = hashRng(c * 7349 + 11);
        for (const side of [-1, 1]) {
          const s = c * chunk + r() * chunk;
          const x = pathX(s) + side * (13 + r() * 22), y = pathY(s) - 4 + r() * 10, z = -s;
          const sc = 3 + r() * 6;
          b.rock[Math.floor(r() * 3)].add(x, y, z, 0, r() * 6.28, 0, sc, sc, sc, 1, 1, 1);
        }
      }

      // the road
      const pr = Math.floor(p.s / ROW);
      for (let i = pr - BEHIND; i < pr + AHEAD; i++) {
        const row = this.rows.get(i);
        if (!row) continue;
        const age = this.clock - row.born;
        const t = clamp(age / 0.55, 0, 1);
        const rise = (1 - easeOutBack(t)) * -10;
        const yaw = pathYaw(row.s);
        for (let l = 0; l < 3; l++) {
          if (row.holes[l]) continue;
          const [x, y, z] = lanePos(row.s, l);
          const alt = (i + l) % 2 === 0;
          const col = row.gold
            ? (alt ? [0.98, 0.68, 0.22] : [0.86, 0.5, 0.16])
            : (alt ? [0.27, 0.4, 0.95] : [0.2, 0.28, 0.72]);
          b.tile.add(x, y + rise, z, 0, -yaw, 0, 2.15, 0.55, ROW * 0.94, ...col);
          b.strip.add(x, y + rise + 0.29, z + ROW * 0.47, 0, -yaw, 0, 2.0, 0.04, 0.08, ...(row.gold ? [1, 0.9, 0.6] : [0.6, 0.75, 1]));
        }
        if (i % 6 === 0) {
          const [x, y, z] = lanePos(row.s, 1);
          b.support.add(x, y + rise - 2.6, z, 0, this.clock * 0.3 + i, 0, 1.1, 4.2, 1.1, ...(row.gold ? [1, 0.7, 0.3] : [0.5, 0.4, 1]));
        }
        if (row.pillow >= 0) {
          const [x, y, z] = lanePos(row.s, row.pillow);
          const bob = Math.sin(this.clock * 3 + i) * 0.06;
          b.pillow.add(x, y + rise + 0.85 + bob, z, 0, -yaw, 0, 1.7, 0.9, 1.3, 0.72, 0.55, 1.0);
          b.particle.add(x, y + rise + 1.7 + Math.sin(this.clock * 2 + i) * 0.2, z, 0, this.clock, 0.4, 0.22, 0.22, 0.05, 0.9, 0.85, 1);
        }
        if (row.hurdle) {
          const a = lanePos(row.s, 0), c = lanePos(row.s, 2);
          b.hurdle.add((a[0] + c[0]) / 2, a[1] + rise + 0.62, (a[2] + c[2]) / 2, 0, -yaw, Math.PI / 2, 0.32, 6.8, 0.32, 1.0, 0.45, 0.35);
          for (const q of [a, c]) b.hurdle.add(q[0] + (q === a ? -0.9 : 0.9) * Math.cos(yaw), q[1] + rise + 0.45, q[2], 0, 0, 0, 0.25, 0.9, 0.25, 0.9, 0.9, 1);
        }
        for (const k of row.pickups) {
          if (k.taken) continue;
          const [x, y, z] = lanePos(row.s, k.lane);
          const bob = Math.sin(this.clock * 4 + i * 0.7) * 0.12;
          if (k.type === 'seed') {
            const rot = this.clock * 3 + i;
            b.seedDark.add(x, y + rise + k.y + bob, z, 0.3, rot, 0, 0.44, 0.72, 0.28, 0.3, 0.24, 0.22);
            b.seedLight.add(x, y + rise + k.y + bob, z, 0.3, rot, 0, 0.16, 0.66, 0.295, 1.0, 0.95, 0.82);
            b.gemRing.add(x, y + rise + 0.32, z, 0, 0, 0, 1.0 + Math.sin(this.clock * 5 + i) * 0.08, 1, 1.0 + Math.sin(this.clock * 5 + i) * 0.08, ...(this.wheel.running ? [1, 0.85, 0.45] : [0.6, 0.75, 1]));
          } else if (k.type === 'coin') {
            b.coin.add(x, y + rise + k.y + bob, z, Math.PI / 2, this.clock * 4 + i, 0, 0.9, 0.16, 0.9, 1.0, 0.78, 0.2);
          } else if (k.type === 'gem') {
            b.gem.add(x, y + rise + k.y + bob, z, this.clock, this.clock * 1.6, 0, 1.3, 1.9, 1.3, 1.0, 0.85, 0.35);
            b.gemRing.add(x, y + rise + k.y + bob, z, Math.PI / 2 + Math.sin(this.clock) * 0.4, 0, this.clock, 2.6, 2.6, 2.6, 1.0, 0.9, 0.5);
          }
        }
      }

      // particles
      for (const q of this.particles) {
        const a = q.life / q.max;
        b.particle.add(q.x, q.y, q.z, q.life * 4, q.life * 3, 0, q.size * a + 0.02, q.size * a + 0.02, q.size * a + 0.02, ...q.col);
      }

      // the hamster ball
      const blink = p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0;
      if (!blink) {
        const yaw = -pathYaw(p.s);
        const hop = Math.abs(Math.sin(this.clock * (w.running ? 16 : 10))) * 0.07;
        const hx = ball[0], hy = ballY - 0.18 + hop, hz = ball[2];
        const f = skin.fur, be = skin.belly;
        b.fur.add(hx, hy, hz, 0, yaw, p.tilt * 0.5, 0.95, 0.82, 1.05, ...f);                               // body
        b.fur.add(hx, hy + 0.3, hz - 0.38, 0, yaw, 0, 0.66, 0.6, 0.6, ...f);                                // head
        b.fur.add(hx, hy + 0.12, hz - 0.5, 0, yaw, 0, 0.5, 0.36, 0.34, ...be);                              // snout
        b.fur.add(hx - 0.26, hy + 0.64, hz - 0.3, 0, yaw, -0.3, 0.27, 0.27, 0.14, ...f);                    // ears
        b.fur.add(hx + 0.26, hy + 0.64, hz - 0.3, 0, yaw, 0.3, 0.27, 0.27, 0.14, ...f);
        b.fur.add(hx, hy + 0.22, hz + 0.1, 0, yaw, 0, 0.7, 0.55, 0.75, ...f.map(c => c * 0.78));             // darker back
        b.fur.add(hx, hy + 0.05, hz + 0.52, 0, yaw, 0, 0.16, 0.14, 0.16, ...be);                            // tail
        b.pink.add(hx - 0.24, hy + 0.62, hz - 0.39, 0, yaw, 0, 0.11, 0.11, 0.05, 1, 0.6, 0.65);
        b.pink.add(hx + 0.24, hy + 0.62, hz - 0.39, 0, yaw, 0, 0.11, 0.11, 0.05, 1, 0.6, 0.65);
        b.pink.add(hx, hy + 0.2, hz - 0.67, 0, yaw, 0, 0.09, 0.07, 0.07, 1, 0.5, 0.55);                     // nose
        b.dark.add(hx - 0.15, hy + 0.38, hz - 0.62, 0, yaw, 0, 0.1, 0.12, 0.08, 0.05, 0.05, 0.08);         // eyes
        b.dark.add(hx + 0.15, hy + 0.38, hz - 0.62, 0, yaw, 0, 0.1, 0.12, 0.08, 0.05, 0.05, 0.08);
        b.glow.add(hx - 0.16, hy + 0.41, hz - 0.66, 0, 0, 0, 0.035, 0.035, 0.02, 1, 1, 1);
        b.glow.add(hx + 0.14, hy + 0.41, hz - 0.66, 0, 0, 0, 0.035, 0.035, 0.02, 1, 1, 1);
        const D = BALL_R * 2;
        b.shell.add(hx, ballY, hz, p.roll, yaw, p.tilt, D, D, D, ...skin.shell);
        for (let k2 = 0; k2 < 3; k2++) b.shellRing.add(hx, ballY, hz, -p.roll, yaw + k2 * Math.PI / 3, p.tilt, D * 1.01, D * 1.01, D * 1.01, ...skin.ring);
      }
      // shadow
      const sh = lanePos(p.s, p.laneF);
      if (p.fall <= 0) b.dark.add(sh[0], sh[1] + 0.29, sh[2], 0, 0, 0, 1.3 - p.y * 0.1, 0.02, 1.3 - p.y * 0.1, 0.05, 0.04, 0.1);

      // draw: opaque first, transparent last
      const D = (mesh, batch, opt) => e.draw(mesh, batch.data, batch.n, opt);
      D(this.mesh.ring, b.wheel, { emissive: 0.75, rim: 0, fog: 0.45 });
      D(this.mesh.cube, b.spoke, { emissive: 0.6, rim: 0, fog: 0.45 });
      this.mesh.rock.forEach((m, i) => D(m, b.rock[i], { rim: 0.25 }));
      D(this.mesh.tile, b.tile, { emissive: w.running ? 0.12 : 0.08, rim: 0.2 });
      D(this.mesh.cube, b.strip, { emissive: 0.9, rim: 0 });
      D(this.mesh.gem, b.support, { emissive: 0.35, rim: 0.4 });
      D(this.mesh.pillow, b.pillow, { emissive: 0.15, rim: 0.5 });
      D(this.mesh.cyl, b.hurdle, { emissive: 0.25, rim: 0.3 });
      D(this.mesh.lowSphere, b.seedDark, { rim: 0.3 });
      D(this.mesh.lowSphere, b.seedLight, { rim: 0.1 });
      D(this.mesh.cyl, b.coin, { emissive: 0.45, rim: 0.6 });
      D(this.mesh.gem, b.gem, { emissive: 0.7, rim: 0.8 });
      D(this.mesh.thinRing, b.gemRing, { emissive: 0.9, rim: 0 });
      D(this.mesh.sphere, b.fur, { rim: 0.25 });
      D(this.mesh.sphere, b.pink, { rim: 0.1 });
      D(this.mesh.sphere, b.dark, { rim: 0 });
      D(this.mesh.sphere, b.glow, { emissive: 1, rim: 0 });
      D(this.mesh.cube, b.particle, { emissive: 0.8, rim: 0 });
      D(this.mesh.thinRing, b.shellRing, { emissive: 0.35, rim: 0 });
      D(this.mesh.sphere, b.shell, { transparent: true, rim: 1.2, emissive: 0.1 });
    }

    #frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.active === false) { requestAnimationFrame(t => this.#frame(t)); return; }
      if (this.mode !== 'paused' && this.mode !== 'over') this.#update(dt);
      try { this.#render(); } catch (err) { console.error(err); }
      requestAnimationFrame(t => this.#frame(t));
    }
  }

  SR.Game = Game;
  SR.SKINS = SKINS;
})();
