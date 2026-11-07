/* Squeek Rally: tiny WebGL2 engine.
 * Flat-shaded low-poly meshes drawn with instancing, one directional light,
 * hemisphere ambient, rim light and distance fog. No dependencies. */
'use strict';
window.SR = window.SR || {};

(() => {
  const SR = window.SR;
  // ------------------------------------------------------------ math
  const M = {
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(eye, target, up) {
      let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([
        xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
      ]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    /** Writes translate × rotateY(ry) × rotateX(rx) × rotateZ(rz) × scale into out[off..off+15]. */
    trs(out, off, x, y, z, rx, ry, rz, sx, sy, sz) {
      const cx = Math.cos(rx), snx = Math.sin(rx), cy = Math.cos(ry), sny = Math.sin(ry), cz = Math.cos(rz), snz = Math.sin(rz);
      // R = Ry * Rx * Rz
      const r00 = cy * cz + sny * snx * snz, r01 = -cy * snz + sny * snx * cz, r02 = sny * cx;
      const r10 = cx * snz, r11 = cx * cz, r12 = -snx;
      const r20 = -sny * cz + cy * snx * snz, r21 = sny * snz + cy * snx * cz, r22 = cy * cx;
      out[off] = r00 * sx; out[off + 1] = r10 * sx; out[off + 2] = r20 * sx; out[off + 3] = 0;
      out[off + 4] = r01 * sy; out[off + 5] = r11 * sy; out[off + 6] = r21 * sy; out[off + 7] = 0;
      out[off + 8] = r02 * sz; out[off + 9] = r12 * sz; out[off + 10] = r22 * sz; out[off + 11] = 0;
      out[off + 12] = x; out[off + 13] = y; out[off + 14] = z; out[off + 15] = 1;
    },
  };

  // ------------------------------------------------------------ geometry (flat shaded, non-indexed)
  function pushTri(g, a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) {
      g.pos.push(p[0], p[1], p[2]); g.nor.push(nx, ny, nz); g.col.push(col[0], col[1], col[2]);
    }
  }
  const newGeo = () => ({ pos: [], nor: [], col: [] });
  const WHITE = [1, 1, 1];

  const Geo = {
    box(col = WHITE, topCol = null) {
      const g = newGeo(), h = 0.5;
      const v = [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]];
      const faces = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]];
      faces.forEach((f, i) => {
        const c = i === 4 && topCol ? topCol : col;
        pushTri(g, v[f[0]], v[f[1]], v[f[2]], c); pushTri(g, v[f[0]], v[f[2]], v[f[3]], c);
      });
      return g;
    },
    /** Box with chamfered top edges: reads as a beveled tile. */
    bevelBox(col = WHITE, topCol = WHITE, bevel = 0.12) {
      const g = newGeo(), h = 0.5, b = h - bevel;
      const P = (x, y, z) => [x, y, z];
      const top = [P(-b, h, -b), P(b, h, -b), P(b, h, b), P(-b, h, b)];
      const mid = [P(-h, h - bevel, -h), P(h, h - bevel, -h), P(h, h - bevel, h), P(-h, h - bevel, h)];
      const bot = [P(-h, -h, -h), P(h, -h, -h), P(h, -h, h), P(-h, -h, h)];
      pushTri(g, top[3], top[2], top[1], topCol); pushTri(g, top[3], top[1], top[0], topCol);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        pushTri(g, mid[i], top[i], top[j], col); pushTri(g, mid[i], top[j], mid[j], col);
        pushTri(g, bot[i], mid[i], mid[j], col); pushTri(g, bot[i], mid[j], bot[j], col);
      }
      pushTri(g, bot[0], bot[1], bot[2], col); pushTri(g, bot[0], bot[2], bot[3], col);
      return g;
    },
    icosphere(sub = 1, col = WHITE) {
      const t = (1 + Math.sqrt(5)) / 2;
      let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
        .map(v => { const l = Math.hypot(...v); return v.map(c => c / l * 0.5); });
      let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      for (let s = 0; s < sub; s++) {
        const cache = new Map(), nf = [];
        const mid = (a, b) => {
          const k = a < b ? `${a}_${b}` : `${b}_${a}`;
          if (cache.has(k)) return cache.get(k);
          const m = verts[a].map((c, i) => (c + verts[b][i]) / 2); const l = Math.hypot(...m);
          verts.push(m.map(c => c / l * 0.5)); cache.set(k, verts.length - 1); return verts.length - 1;
        };
        for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
        faces = nf;
      }
      const g = newGeo();
      for (const [a, b, c] of faces) pushTri(g, verts[a], verts[b], verts[c], col);
      return g;
    },
    cylinder(seg = 16, col = WHITE, capCol = null) {
      const g = newGeo(), h = 0.5, r = 0.5;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const p0 = [Math.cos(a0) * r, -h, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, -h, Math.sin(a1) * r];
        const q0 = [p0[0], h, p0[2]], q1 = [p1[0], h, p1[2]];
        pushTri(g, p0, q1, p1, col); pushTri(g, p0, q0, q1, col);
        pushTri(g, [0, h, 0], q1, q0, capCol || col);
        pushTri(g, [0, -h, 0], p0, p1, capCol || col);
      }
      return g;
    },
    torus(R = 0.5, r = 0.08, seg = 32, side = 6, col = WHITE) {
      const g = newGeo();
      const P = (i, j) => {
        const u = (i / seg) * Math.PI * 2, v = (j / side) * Math.PI * 2;
        return [(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)];
      };
      for (let i = 0; i < seg; i++) for (let j = 0; j < side; j++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        pushTri(g, a, c, b, col); pushTri(g, a, d, c, col);
      }
      return g;
    },
    /** Low-poly floating rock: a squashed, jittered icosphere with a grassy top. */
    rock(seed = 1, col = [0.24, 0.22, 0.32], topCol = [0.36, 0.3, 0.6]) {
      let s = seed;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const base = Geo.icosphere(1, col);
      const g = newGeo();
      const jitter = new Map();
      for (let i = 0; i < base.pos.length; i += 3) {
        const k = `${base.pos[i].toFixed(3)},${base.pos[i + 1].toFixed(3)},${base.pos[i + 2].toFixed(3)}`;
        if (!jitter.has(k)) jitter.set(k, 0.8 + rnd() * 0.4);
      }
      const tris = [];
      for (let i = 0; i < base.pos.length; i += 9) {
        const tri = [];
        for (let k = 0; k < 3; k++) {
          const x = base.pos[i + k * 3], y = base.pos[i + k * 3 + 1], z = base.pos[i + k * 3 + 2];
          const j = jitter.get(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`);
          tri.push([x * j, (y > 0 ? y * 0.35 : y * 1.4) * j, z * j]);
        }
        tris.push(tri);
      }
      for (const [a, b, c] of tris) pushTri(g, a, b, c, (a[1] + b[1] + c[1]) / 3 > 0.08 ? topCol : col);
      return g;
    },
    merge(...parts) {
      const g = newGeo();
      for (const { geo, at = [0, 0, 0], scale = [1, 1, 1] } of parts) {
        for (let i = 0; i < geo.pos.length; i += 3) {
          g.pos.push(geo.pos[i] * scale[0] + at[0], geo.pos[i + 1] * scale[1] + at[1], geo.pos[i + 2] * scale[2] + at[2]);
          const nx = geo.nor[i] / scale[0], ny = geo.nor[i + 1] / scale[1], nz = geo.nor[i + 2] / scale[2];
          const l = Math.hypot(nx, ny, nz) || 1;
          g.nor.push(nx / l, ny / l, nz / l);
        }
        g.col.push(...geo.col);
      }
      return g;
    },
  };

  // ------------------------------------------------------------ renderer
  const VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNor;
  layout(location=2) in vec3 aCol;
  layout(location=3) in mat4 iModel;
  layout(location=7) in vec4 iColor;
  uniform mat4 uViewProj;
  out vec3 vNor; out vec3 vCol; out vec3 vWorld; out float vAlpha;
  void main() {
    vec4 w = iModel * vec4(aPos, 1.0);
    vWorld = w.xyz;
    vNor = normalize(mat3(iModel) * aNor);
    vCol = aCol * iColor.rgb;
    vAlpha = iColor.a;
    gl_Position = uViewProj * w;
  }`;
  const FS = `#version 300 es
  precision highp float;
  in vec3 vNor; in vec3 vCol; in vec3 vWorld; in float vAlpha;
  uniform vec3 uLightDir; uniform vec3 uLightCol; uniform vec3 uSky; uniform vec3 uGround;
  uniform vec3 uFog; uniform vec2 uFogRange; uniform vec3 uEye; uniform float uEmissive; uniform vec3 uRimCol; uniform float uRim; uniform float uFogMul;
  out vec4 outColor;
  void main() {
    vec3 n = normalize(vNor);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(uEye - vWorld);
    float diff = max(dot(n, uLightDir), 0.0);
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
    vec3 c = vCol * (amb + uLightCol * diff);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * uRim;
    c += vCol * uEmissive + uRimCol * rim;
    float d = length(uEye - vWorld);
    float f = smoothstep(uFogRange.x, uFogRange.y, d) * uFogMul;
    outColor = vec4(mix(c, uFog, f), vAlpha);
  }`;

  class Engine {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;
      this.prog = this.#program(VS, FS);
      this.u = {};
      for (const n of ['uViewProj', 'uLightDir', 'uLightCol', 'uSky', 'uGround', 'uFog', 'uFogRange', 'uEye', 'uEmissive', 'uRimCol', 'uRim', 'uFogMul']) {
        this.u[n] = gl.getUniformLocation(this.prog, n);
      }
      this.instData = new Float32Array(20 * 2048);
      this.env = {
        lightDir: [0.35, 0.85, 0.4], lightCol: [0.95, 0.88, 0.75], sky: [0.42, 0.42, 0.62], ground: [0.12, 0.1, 0.18],
        fog: [0.11, 0.09, 0.2], fogRange: [40, 150], rimCol: [0.35, 0.45, 1.0],
      };
      this.dpr = 1;
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }

    #program(vs, fs) {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }

    mesh(geo, { doubleSided = false } = {}) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = (data, loc, size) => {
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      buf(geo.pos, 0, 3); buf(geo.nor, 1, 3); buf(geo.col, 2, 3);
      const inst = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferData(gl.ARRAY_BUFFER, this.instData.byteLength, gl.DYNAMIC_DRAW);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(3 + i);
        gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, 80, i * 16);
        gl.vertexAttribDivisor(3 + i, 1);
      }
      gl.enableVertexAttribArray(7);
      gl.vertexAttribPointer(7, 4, gl.FLOAT, false, 80, 64);
      gl.vertexAttribDivisor(7, 1);
      gl.bindVertexArray(null);
      return { vao, inst, count: geo.pos.length / 3, doubleSided };
    }

    resize(maxDpr = 2) {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.aspect = w / h;
    }

    begin(eye, target, fov = 1.05) {
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.prog);
      const proj = M.perspective(fov, this.aspect || 1, 0.1, 400);
      const view = M.lookAt(eye, target, [0, 1, 0]);
      this.viewProj = M.mul(proj, view);
      gl.uniformMatrix4fv(this.u.uViewProj, false, this.viewProj);
      const e = this.env;
      const l = Math.hypot(...e.lightDir);
      gl.uniform3f(this.u.uLightDir, e.lightDir[0] / l, e.lightDir[1] / l, e.lightDir[2] / l);
      gl.uniform3fv(this.u.uLightCol, e.lightCol);
      gl.uniform3fv(this.u.uSky, e.sky);
      gl.uniform3fv(this.u.uGround, e.ground);
      gl.uniform3fv(this.u.uFog, e.fog);
      gl.uniform2fv(this.u.uFogRange, e.fogRange);
      gl.uniform3fv(this.u.uRimCol, e.rimCol);
      gl.uniform3f(this.u.uEye, eye[0], eye[1], eye[2]);
      this.drawCalls = 0;
    }

    /** Draw `n` instances whose data (20 floats each: mat4 + rgba) is in `data`. */
    /** Project a world point to CSS pixels; returns null when behind the camera. */
    toScreen(x, y, z) {
      const m = this.viewProj; if (!m) return null;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0.01) return null;
      const r = this.canvas.getBoundingClientRect();
      return { x: (cx / cw * 0.5 + 0.5) * r.width, y: (1 - (cy / cw * 0.5 + 0.5)) * r.height, depth: cw };
    }

    draw(mesh, data, n, { emissive = 0, rim = 0.35, transparent = false, fog = 1 } = {}) {
      if (n <= 0) return;
      const gl = this.gl;
      gl.uniform1f(this.u.uEmissive, emissive);
      gl.uniform1f(this.u.uRim, rim);
      gl.uniform1f(this.u.uFogMul, fog);
      if (transparent) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      if (mesh.doubleSided || transparent) gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(mesh.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 20);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, n);
      gl.bindVertexArray(null);
      if (mesh.doubleSided || transparent) gl.enable(gl.CULL_FACE);
      if (transparent) { gl.disable(gl.BLEND); gl.depthMask(true); }
      this.drawCalls++;
    }
  }

  /** Collects instances for one mesh during a frame. */
  class Batch {
    constructor(max = 2048) { this.data = new Float32Array(max * 20); this.n = 0; this.max = max; }
    reset() { this.n = 0; }
    add(x, y, z, rx, ry, rz, sx, sy, sz, r = 1, g = 1, b = 1, a = 1) {
      if (this.n >= this.max) return;
      const o = this.n * 20;
      M.trs(this.data, o, x, y, z, rx, ry, rz, sx, sy, sz);
      this.data[o + 16] = r; this.data[o + 17] = g; this.data[o + 18] = b; this.data[o + 19] = a;
      this.n++;
    }
  }

  SR.M = M;
  SR.Geo = Geo;
  SR.Engine = Engine;
  SR.Batch = Batch;
})();
