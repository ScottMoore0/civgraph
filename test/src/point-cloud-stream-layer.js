// maplibre-native STREAMING point-cloud layer (LOD / 3D Tiles octree).
//
// Loads a py3dtiles 3D-Tiles tileset (tileset.json + nested tileset.N.json +
// .pnts leaf tiles) and streams it with level-of-detail: coarse nodes show when
// zoomed out, fine nodes load on demand as you zoom in, off-screen nodes are
// culled, and a memory budget evicts least-recently-used nodes. This is what
// deck.gl's Tile3DLayer was meant to do but couldn't paint over maplibre-gl 5.
//
// Per-point CPU work is ZERO: each node's raw local float32 POSITION goes
// straight to a GPU buffer, and a per-node affine matrix (local -> mercator
// offset, fitted once from 4 sample conversions) is folded into maplibre's own
// projection matrix each frame. Precision is kept with a relative-to-center
// (RTC) reference per node.
import maplibregl from 'maplibre-gl';

// ---------- math ----------------------------------------------------------
const A_WGS = 6378137.0;                 // WGS84 semi-major
const F_WGS = 1 / 298.257223563;
const B_WGS = A_WGS * (1 - F_WGS);
const E2 = F_WGS * (2 - F_WGS);
const EP2 = (A_WGS * A_WGS - B_WGS * B_WGS) / (B_WGS * B_WGS);
const D2R = Math.PI / 180;
const EARTH_CIRC = 2 * Math.PI * 6371008.8;

// ECEF (EPSG:4978, metres) -> geodetic lng/lat(deg) + altitude(m), Bowring.
function ecefToGeodetic(x, y, z) {
  const p = Math.hypot(x, y);
  const th = Math.atan2(A_WGS * z, B_WGS * p);
  const st = Math.sin(th), ct = Math.cos(th);
  const lat = Math.atan2(z + EP2 * B_WGS * st * st * st, p - E2 * A_WGS * ct * ct * ct);
  const lng = Math.atan2(y, x);
  const sl = Math.sin(lat);
  const N = A_WGS / Math.sqrt(1 - E2 * sl * sl);
  const alt = p / Math.cos(lat) - N;
  return [lng / D2R, lat / D2R, alt];
}

// geodetic -> web-mercator [0..1] x/y + mercator z; returns [mx,my,mz]
function geodeticToMercator(lngDeg, latDeg, alt) {
  const mx = (lngDeg + 180) / 360;
  const my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + latDeg * D2R / 2))) / 360;
  const mpm = 1 / (EARTH_CIRC * Math.cos(latDeg * D2R));
  return [mx, my, alt * mpm];
}
function ecefToMercator(x, y, z) {
  const g = ecefToGeodetic(x, y, z);
  return geodeticToMercator(g[0], g[1], g[2]);
}

// column-major 4x4 * point(affine, w=1) -> [x,y,z]
function xformPt(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}
// column-major 4x4 * 4x4 (returns a*b)
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ---------- GL ------------------------------------------------------------
const VERT = `
precision highp float;
attribute vec3 a_pos;      // raw local tile coords
attribute vec3 a_color;
uniform mat4 u_matrix;     // local -> clip (mainMatrix . RTC . localToMercatorOffset)
uniform float u_size;
varying vec3 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  gl_PointSize = u_size;
  v_color = a_color;
}`;
const FRAG = `
precision mediump float;
varying vec3 v_color;
uniform float u_opacity;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  gl_FragColor = vec4(v_color, u_opacity);
}`;
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('pc shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) { const u = t * 2; return [0.15 + 0.1 * u, 0.35 + 0.55 * u, 0.9 - 0.5 * u]; }
  const u = (t - 0.5) * 2; return [0.25 + 0.7 * u, 0.9 - 0.55 * u, 0.4 - 0.3 * u];
}

// ---------- tileset helpers ----------------------------------------------
function joinUrl(base, rel) {
  if (/^https?:/i.test(rel)) return rel;
  const b = base.replace(/[^/]*$/, '');
  return b + rel;
}

// Build a runtime node from a raw 3D-Tiles tile. Computes world matrix, the
// local->mercator-offset affine (+ RTC ref), and 8 mercator corners for culling.
function makeNode(raw, parentWorld, baseUrl, parentRefine) {
  const world = raw.transform ? mul4(parentWorld, raw.transform) : parentWorld;
  const box = raw.boundingVolume.box;
  const L0 = [box[0], box[1], box[2]];
  const hx = [box[3], box[4], box[5]];
  const hy = [box[6], box[7], box[8]];
  const hz = [box[9], box[10], box[11]];

  // ref + fitted affine local -> (mercator - ref)
  const e0 = xformPt(world, L0[0], L0[1], L0[2]);
  const ref = ecefToMercator(e0[0], e0[1], e0[2]);
  const cols = [];
  for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const p = xformPt(world, L0[0] + e[0], L0[1] + e[1], L0[2] + e[2]);
    const m = ecefToMercator(p[0], p[1], p[2]);
    cols.push([m[0] - ref[0], m[1] - ref[1], m[2] - ref[2]]);
  }
  const t = [
    -(cols[0][0] * L0[0] + cols[1][0] * L0[1] + cols[2][0] * L0[2]),
    -(cols[0][1] * L0[0] + cols[1][1] * L0[1] + cols[2][1] * L0[2]),
    -(cols[0][2] * L0[0] + cols[1][2] * L0[1] + cols[2][2] * L0[2])
  ];
  // column-major: local -> (mercator - ref)
  const affine = [
    cols[0][0], cols[0][1], cols[0][2], 0,
    cols[1][0], cols[1][1], cols[1][2], 0,
    cols[2][0], cols[2][1], cols[2][2], 0,
    t[0], t[1], t[2], 1
  ];

  // 8 corners -> mercator (for frustum culling)
  const corners = [];
  for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
    const lx = L0[0] + sx * hx[0] + sy * hy[0] + sz * hz[0];
    const ly = L0[1] + sx * hx[1] + sy * hy[1] + sz * hz[1];
    const lz = L0[2] + sx * hx[2] + sy * hy[2] + sz * hz[2];
    const p = xformPt(world, lx, ly, lz);
    corners.push(ecefToMercator(p[0], p[1], p[2]));
  }

  const content = raw.content || raw.contents?.[0];
  const uri = content && (content.uri || content.url);
  const abs = uri ? joinUrl(baseUrl, uri) : null;
  const isPnts = !!abs && /\.pnts(\?|$)/i.test(abs);
  const isExternal = !!abs && /\.json(\?|$)/i.test(abs);

  return {
    world, box, ref, affine, corners,
    geometricError: raw.geometricError ?? 0,
    refine: (raw.refine || parentRefine || 'REPLACE').toUpperCase(),
    baseUrl,
    contentUri: isPnts ? abs : null,
    externalUri: isExternal ? abs : null,
    rawChildren: raw.children || null,
    children: null,        // resolved lazily
    resolving: false,
    state: 'unloaded',     // for pnts content
    buf: null, colBuf: null, count: 0,
    lastFrame: 0
  };
}

export function createStreamingPointCloudLayer(id, tilesetUrl, opts = {}) {
  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    _pointSize: opts.pointSize ?? 1.6,
    _opacity: opts.opacity ?? 1,
    _errK: opts.errorFactor ?? 1.0,          // lower = more detail
    _maxPoints: opts.maxPoints ?? 14_000_000,
    _maxConcurrent: 8,
    _root: null,
    _frame: 0,
    _loadedPoints: 0,
    _inflight: 0,
    _queue: [],
    _loadedNodes: new Set(),
    _visitBudget: 0,          // per-frame traversal cap (set in render)
    _resolving: 0,            // in-flight external-tileset fetches
    _maxResolving: 12,
    _maxVisitsPerFrame: 6000,

    onAdd(map, gl) {
      this._map = map;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('pc link: ' + gl.getProgramInfoLog(prog));
      this._prog = prog;
      this._loc = {
        a_pos: gl.getAttribLocation(prog, 'a_pos'),
        a_color: gl.getAttribLocation(prog, 'a_color'),
        u_matrix: gl.getUniformLocation(prog, 'u_matrix'),
        u_size: gl.getUniformLocation(prog, 'u_size'),
        u_opacity: gl.getUniformLocation(prog, 'u_opacity')
      };
      if (typeof map.setMaxPitch === 'function' && map.getMaxPitch() < 80) map.setMaxPitch(85);
      fetch(tilesetUrl).then((r) => r.json()).then((ts) => {
        const baseUrl = tilesetUrl.split('?')[0];
        this._root = makeNode(ts.root, IDENT, baseUrl, 'REPLACE');
        this._map?.triggerRepaint();
      }).catch((e) => console.error('[pc-stream] tileset load failed', id, e));
    },

    // resolve a node's children (declared children + any external tileset root)
    _resolveChildren(node) {
      if (node.children || node.resolving) return;
      // throttle external fetches so a fast zoom doesn't launch a request storm
      if (node.externalUri && this._resolving >= this._maxResolving) return;
      node.resolving = true;
      if (node.externalUri) this._resolving++;
      const build = (extRoot) => {
        const kids = [];
        if (extRoot) kids.push(makeNode(extRoot, node.world, node._extBase || node.baseUrl, node.refine));
        if (node.rawChildren) for (const c of node.rawChildren) kids.push(makeNode(c, node.world, node.baseUrl, node.refine));
        node.children = kids;
        node.resolving = false;
        this._map?.triggerRepaint();
      };
      if (node.externalUri) {
        fetch(node.externalUri).then((r) => r.json()).then((sub) => {
          node._extBase = node.externalUri.split('?')[0];
          build(sub.root);
        }).catch((e) => { node.children = []; node.resolving = false; })
          .finally(() => { this._resolving--; });
      } else {
        build(null);
      }
    },

    _enqueue(node) {
      if (node.state !== 'unloaded') return;
      node.state = 'queued';
      this._queue.push(node);
    },

    _pump(gl) {
      while (this._inflight < this._maxConcurrent && this._queue.length) {
        // prefer most-recently-wanted nodes
        this._queue.sort((a, b) => b.lastFrame - a.lastFrame);
        const node = this._queue.shift();
        if (node.state !== 'queued') continue;
        node.state = 'loading';
        this._inflight++;
        fetch(node.contentUri).then((r) => r.arrayBuffer()).then((buf) => {
          this._upload(gl, node, buf);
        }).catch(() => { node.state = 'unloaded'; }).finally(() => {
          this._inflight--;
          this._map?.triggerRepaint();
        });
      }
    },

    _upload(gl, node, buf) {
      // parse .pnts feature table: header(28) + ftJSON + ftBinary
      const dv = new DataView(buf);
      const ftjl = dv.getUint32(12, true);
      const ft = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 28, ftjl)));
      const n = ft.POINTS_LENGTH | 0;
      const ftbin = 28 + ftjl;
      const posOff = ftbin + (ft.POSITION?.byteOffset ?? 0);
      const pos = new Float32Array(buf.slice(posOff, posOff + n * 12));
      const cols = new Float32Array(n * 3);
      if (ft.RGB) {
        const rgbOff = ftbin + ft.RGB.byteOffset;
        const rgb = new Uint8Array(buf, rgbOff, n * 3);
        for (let i = 0; i < n * 3; i++) cols[i] = rgb[i] / 255;
      } else {
        // height ramp on local z (cheap, per-node relative)
        let zmin = Infinity, zmax = -Infinity;
        for (let i = 0; i < n; i++) { const z = pos[i * 3 + 2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
        const span = (zmax - zmin) || 1;
        for (let i = 0; i < n; i++) { const c = ramp((pos[i * 3 + 2] - zmin) / span); cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2]; }
      }
      node.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, node.buf);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      node.colBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, node.colBuf);
      gl.bufferData(gl.ARRAY_BUFFER, cols, gl.STATIC_DRAW);
      node.count = n;
      node.state = 'loaded';
      this._loadedPoints += n;
      this._loadedNodes.add(node);
    },

    _evict(gl) {
      if (this._loadedPoints <= this._maxPoints) return;
      const cand = [...this._loadedNodes].filter((n) => n.lastFrame < this._frame).sort((a, b) => a.lastFrame - b.lastFrame);
      for (const node of cand) {
        if (this._loadedPoints <= this._maxPoints * 0.85) break;
        gl.deleteBuffer(node.buf); gl.deleteBuffer(node.colBuf);
        this._loadedPoints -= node.count;
        node.buf = node.colBuf = null; node.count = 0; node.state = 'unloaded';
        this._loadedNodes.delete(node);
      }
    },

    // is the node's box entirely outside the frustum? (project 8 mercator corners)
    _culled(node, m) {
      let l = 0, r = 0, b = 0, t = 0, ne = 0;
      for (const c of node.corners) {
        const cx = m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12];
        const cy = m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13];
        const cw = m[3] * c[0] + m[7] * c[1] + m[11] * c[2] + m[15];
        if (cw <= 0) { ne++; continue; }
        const x = cx / cw, y = cy / cw;
        if (x < -1) l++; if (x > 1) r++; if (y < -1) b++; if (y > 1) t++;
      }
      const N = node.corners.length;
      return l === N || r === N || b === N || t === N || ne === N;
    },

    _selectVisit(gl, node, mainMatrix, budget, out) {
      if (this._visitBudget-- <= 0) {           // per-frame traversal safety cap
        if (node.contentUri && node.state === 'loaded') out.push(node);
        return;
      }
      node.lastFrame = this._frame;
      const wantRefine = node.geometricError > budget;
      if (!wantRefine) {
        if (node.contentUri) { if (node.state === 'loaded') out.push(node); else this._enqueue(node); }
        else if (node.children || node.externalUri || node.rawChildren) {
          if (!node.children) this._resolveChildren(node);
          else for (const c of node.children) { if (!this._culled(c, mainMatrix)) this._selectVisit(gl, c, mainMatrix, budget, out); }
        }
        return;
      }
      if (!node.children) {
        this._resolveChildren(node);
        if (node.contentUri) { if (node.state === 'loaded') out.push(node); else this._enqueue(node); }
        return;
      }
      let anyMissing = false;
      for (const c of node.children) {
        if (this._culled(c, mainMatrix)) continue;
        const before = out.length;
        this._selectVisit(gl, c, mainMatrix, budget, out);
        if (out.length === before && (c.contentUri || c.externalUri || c.rawChildren)) anyMissing = true;
      }
      if ((node.refine === 'ADD' || anyMissing) && node.contentUri) {
        if (node.state === 'loaded') out.push(node); else this._enqueue(node);
      }
    },

    render(gl, args) {
      if (!this._root || !this._prog) return;
      const m = Array.isArray(args) ? args : (args?.defaultProjectionData?.mainMatrix || args?.mainMatrix || args);
      if (!m || m.length !== 16) return;
      this._frame++;

      // LOD budget from current zoom: metres of ground per screen pixel.
      const lat = this._map.getCenter().lat;
      const zoom = this._map.getZoom();
      const mpp = (EARTH_CIRC * Math.cos(lat * D2R)) / (512 * Math.pow(2, zoom));
      const budget = mpp * this._errK;

      const out = [];
      this._visitBudget = this._maxVisitsPerFrame;
      if (!this._culled(this._root, m)) this._selectVisit(gl, this._root, m, budget, out);
      this._pump(gl);
      this._evict(gl);

      gl.useProgram(this._prog);
      gl.uniform1f(this._loc.u_size, this._pointSize * (window.devicePixelRatio || 1));
      gl.uniform1f(this._loc.u_opacity, this._opacity);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      for (const node of out) {
        // rtc = mainMatrix . translate(ref)
        const rx = node.ref[0], ry = node.ref[1], rz = node.ref[2];
        const rtc = m.slice();
        rtc[12] = m[0] * rx + m[4] * ry + m[8] * rz + m[12];
        rtc[13] = m[1] * rx + m[5] * ry + m[9] * rz + m[13];
        rtc[14] = m[2] * rx + m[6] * ry + m[10] * rz + m[14];
        rtc[15] = m[3] * rx + m[7] * ry + m[11] * rz + m[15];
        const M = mul4(rtc, node.affine); // local -> clip
        gl.uniformMatrix4fv(this._loc.u_matrix, false, new Float32Array(M));
        gl.bindBuffer(gl.ARRAY_BUFFER, node.buf);
        gl.enableVertexAttribArray(this._loc.a_pos);
        gl.vertexAttribPointer(this._loc.a_pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, node.colBuf);
        gl.enableVertexAttribArray(this._loc.a_color);
        gl.vertexAttribPointer(this._loc.a_color, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, node.count);
      }
      // keep animating while tiles are still loading
      if (this._queue.length || this._inflight) this._map?.triggerRepaint();
    },

    setOpacity(o) { this._opacity = o; this._map?.triggerRepaint(); },
    setPointSize(s) { this._pointSize = s; this._map?.triggerRepaint(); },

    onRemove(map, gl) {
      try {
        for (const n of this._loadedNodes) { gl.deleteBuffer(n.buf); gl.deleteBuffer(n.colBuf); }
        gl.deleteProgram(this._prog);
      } catch (e) { /* ignore */ }
      this._loadedNodes.clear();
    }
  };
}
