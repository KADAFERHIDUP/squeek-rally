/* Squeek Orbit: the solar-system hub.
 * The sun is the WHEELY9000, spinning at Squeektoshi's real rpm. Eight planets orbit it,
 * one for each kind of Squeekchain build. Planet labels are real buttons positioned over the 3D scene. */
'use strict';
window.SR = window.SR || {};

(() => {
  const SR = window.SR;
  const { Geo, Engine, Batch } = SR;
  const lerp = (a, b, t) => a + (b - a) * t;

  class Hub {
    constructor(canvas, labelLayer, planets, onSelect) {
      this.canvas = canvas;
      this.labels = labelLayer;
      this.planets = planets;
      this.onSelect = onSelect;
      this.eng = new Engine(canvas);
      const e = this.eng;
      e.env.fog = [0.05, 0.04, 0.1];
      e.env.fogRange = [70, 220];
      e.env.lightDir = [0, 1, 0];
      this.mesh = {
        sphere: e.mesh(Geo.icosphere(3)),
        low: e.mesh(Geo.icosphere(1)),
        ring: e.mesh(Geo.torus(0.5, 0.03, 64, 5)),
        fatRing: e.mesh(Geo.torus(0.5, 0.07, 48, 6)),
        orbit: e.mesh(Geo.torus(0.5, 0.0035, 160, 3)),
        cube: e.mesh(Geo.box()),
      };
      this.b = { sun: new Batch(4), sunRing: new Batch(4), spoke: new Batch(16), planet: new Batch(12), band: new Batch(12), pring: new Batch(12), moon: new Batch(24), orbit: new Batch(12), star: new Batch(420), halo: new Batch(12) };
      const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(42);
      this.stars = Array.from({ length: 400 }, () => {
        const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), r = 160 + rnd() * 60;
        return [r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th), 0.25 + rnd() * 0.6];
      });
      this.time = 0;
      this.spin = 0;
      this.wheel = { running: false, rpm: 0 };
      this.focus = null;
      this.focusT = 0;
      this.active = true;
      this.hover = -1;
      this.cam = { eye: [0, 30, 52], target: [0, 0, 0] };
      this.drag = { on: false, x: 0, yaw: 0, vel: 0 };
      this.#buildLabels();
      this.#bindDrag();
      this.last = performance.now();
      requestAnimationFrame(t => this.#frame(t));
    }

    setWheel(running, rpm) { this.wheel.running = running; this.wheel.rpm = rpm; }
    focusPlanet(i) { this.focus = i; }
    clearFocus() { this.focus = null; }

    #buildLabels() {
      this.labels.innerHTML = '';
      this.labelEls = this.planets.map((p, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'planet-label';
        b.style.setProperty('--pc', p.css);
        b.innerHTML = `<span class="pl-num">${String(i + 1).padStart(2, '0')}</span><span class="pl-text"><b>${p.name}</b><small>${p.category}</small></span>`;
        b.addEventListener('click', () => this.onSelect(i));
        b.addEventListener('pointerenter', () => { this.hover = i; });
        b.addEventListener('pointerleave', () => { if (this.hover === i) this.hover = -1; });
        b.addEventListener('focus', () => { this.hover = i; });
        b.addEventListener('blur', () => { if (this.hover === i) this.hover = -1; });
        this.labels.appendChild(b);
        return b;
      });
    }

    #bindDrag() {
      const c = this.canvas;
      c.addEventListener('pointerdown', e => { this.drag.on = true; this.drag.x = e.clientX; this.drag.vel = 0; });
      window.addEventListener('pointermove', e => {
        if (!this.drag.on) return;
        const dx = e.clientX - this.drag.x;
        this.drag.x = e.clientX;
        this.drag.yaw += dx * 0.005;
        this.drag.vel = dx * 0.005;
      });
      window.addEventListener('pointerup', () => { this.drag.on = false; });
    }

    planetPos(i, t) {
      const p = this.planets[i];
      const a = p.phase + t * p.speed;
      return [Math.cos(a) * p.orbit, Math.sin(a * 0.7) * p.tilt, Math.sin(a) * p.orbit];
    }

    #frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      requestAnimationFrame(t => this.#frame(t));
      if (!this.active) return;
      const w = this.wheel;
      const pace = w.running ? 1 + Math.min(w.rpm / 60, 2) : 0.35;
      this.time += dt * pace * 0.12;
      this.spin += (w.running ? Math.max(w.rpm, 15) : 3) / 60 * Math.PI * 2 * dt * 0.3;
      if (!this.drag.on) { this.drag.yaw += this.drag.vel; this.drag.vel *= 0.92; }
      this.#render(dt);
    }

    #render(dt) {
      const e = this.eng, b = this.b;
      e.resize(1.75);
      Object.values(b).forEach(x => x.reset());
      const portrait = e.aspect < 0.9;

      // camera: slow drift, or fly to the focused planet
      const yaw = this.drag.yaw + this.time * 0.15;
      const dist = portrait ? 78 : 56;
      let eyeT = [Math.sin(yaw) * dist, portrait ? 44 : 28, Math.cos(yaw) * dist];
      let tgtT = [0, portrait ? -2 : 0, 0];
      if (this.focus !== null) {
        const p = this.planetPos(this.focus, this.time);
        const r = this.planets[this.focus].size;
        const dir = Math.atan2(p[0], p[2]);
        eyeT = [p[0] + Math.sin(dir) * r * 4.5, p[1] + r * 1.6, p[2] + Math.cos(dir) * r * 4.5];
        tgtT = p;
      }
      const k = Math.min(1, dt * (this.focus !== null ? 3.2 : 2));
      for (let i = 0; i < 3; i++) { this.cam.eye[i] = lerp(this.cam.eye[i], eyeT[i], k); this.cam.target[i] = lerp(this.cam.target[i], tgtT[i], k); }
      e.env.lightDir = [-this.cam.eye[0] * 0.02, 0.6, -this.cam.eye[2] * 0.02];
      e.begin(this.cam.eye, this.cam.target, portrait ? 1.15 : 0.95);

      // stars
      for (const s of this.stars) b.star.add(s[0], s[1], s[2], 0, 0, 0, s[3], s[3], s[3], 0.85, 0.85, 1);

      // the sun: WHEELY9000
      const w = this.wheel;
      const gold = w.running ? [1, 0.72, 0.24] : [0.95, 0.6, 0.25];
      const pulse = 1 + Math.sin(performance.now() / 400) * (w.running ? 0.04 : 0.015);
      b.sun.add(0, 0, 0, 0, this.spin * 0.2, 0, 5.2 * pulse, 5.2 * pulse, 5.2 * pulse, 1, 0.82, 0.4);
      b.sunRing.add(0, 0, 0, Math.PI / 2, 0, 0, 13.5, 13.5, 13.5, ...gold);
      b.sunRing.add(0, 0, 0, Math.PI / 2, 0, 0, 11, 11, 11, ...gold.map(c => c * 0.8));
      for (let s = 0; s < 12; s++) {
        const a = this.spin + (s / 12) * Math.PI * 2;
        b.spoke.add(Math.cos(a) * 4.3, Math.sin(a) * 4.3, 0, 0, 0, a + Math.PI / 2, 0.18, 3.6, 0.18, ...gold);
      }

      // planets
      this.planets.forEach((p, i) => {
        const pos = this.planetPos(i, this.time);
        const hover = this.hover === i || this.focus === i;
        const sc = p.size * (hover ? 1.12 : 1);
        b.orbit.add(0, 0, 0, 0, 0, 0, p.orbit * 2, p.orbit * 2, p.orbit * 2, ...p.color.map(c => c * (hover ? 0.95 : 0.32)));
        b.planet.add(pos[0], pos[1], pos[2], 0.3, this.time * 3 + i, 0, sc * 2, sc * 2, sc * 2, ...p.color);
        b.band.add(pos[0], pos[1], pos[2], 0.3, this.time * 3 + i, 0, sc * 2.02, sc * 0.5, sc * 2.02, ...p.color2);
        if (p.ring) b.pring.add(pos[0], pos[1], pos[2], 0.35 + i * 0.1, 0, 0.25, sc * 4, sc * 4, sc * 4, ...p.color2);
        if (hover) b.halo.add(pos[0], pos[1], pos[2], Math.PI / 2, 0, this.time * 2, sc * 2.9, sc * 2.9, sc * 2.9, 1, 1, 1);
        for (let m = 0; m < (p.moons || 0); m++) {
          const a = this.time * (6 + m * 2) + m * 2;
          const r = sc * (1.9 + m * 0.6);
          b.moon.add(pos[0] + Math.cos(a) * r, pos[1] + Math.sin(a * 0.5) * 0.4, pos[2] + Math.sin(a) * r, 0, a, 0, sc * 0.32, sc * 0.32, sc * 0.32, 0.85, 0.85, 0.9);
        }
        // label follows the planet
        const sp = e.toScreen(pos[0], pos[1] - sc * 1.25, pos[2]);
        const el = this.labelEls[i];
        if (sp && this.focus === null) {
          el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, 0)`;
          el.style.opacity = '1';
          el.style.zIndex = String(1000 - Math.round(sp.depth));
          el.tabIndex = 0;
        } else {
          el.style.opacity = '0';
          el.tabIndex = -1;
        }
      });

      const D = (m, x, o) => e.draw(m, x.data, x.n, o);
      D(this.mesh.cube, b.star, { emissive: 1, rim: 0, fog: 0 });
      D(this.mesh.orbit, b.orbit, { emissive: 1, rim: 0, fog: 0.3 });
      D(this.mesh.sphere, b.sun, { emissive: 1.1, rim: 0.6 });
      D(this.mesh.fatRing, b.sunRing, { emissive: 0.85, rim: 0 });
      D(this.mesh.cube, b.spoke, { emissive: 0.8, rim: 0 });
      D(this.mesh.sphere, b.planet, { emissive: 0.18, rim: 0.9 });
      D(this.mesh.low, b.band, { emissive: 0.1, rim: 0.4 });
      D(this.mesh.ring, b.pring, { emissive: 0.4, rim: 0 });
      D(this.mesh.low, b.moon, { emissive: 0.1, rim: 0.5 });
      D(this.mesh.ring, b.halo, { emissive: 1, rim: 0, fog: 0 });
    }
  }

  SR.Hub = Hub;
})();
