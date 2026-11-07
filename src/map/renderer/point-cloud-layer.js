// maplibre-native custom WebGL point-cloud layer.
// deck.gl 9.3.6 does not paint point geometry over maplibre-gl 5.24, so we render
// point clouds directly as a maplibre CustomLayerInterface using maplibre's own
// projection matrix (guaranteed to composite + align). Data is a pre-flattened
// point file (see flatten_cloud.py): a JSON header + a binary of ENU meter offsets
// from a center (+ optional RGB). We convert to mercator once on load and render
// with a relative-to-center (RTC) matrix each frame for float precision.
import maplibregl from 'maplibre-gl';

const VERT = `
precision highp float;
attribute vec3 a_off;          // mercator offset from reference
attribute vec3 a_color;        // rgb 0..1 (or height-encoded)
uniform mat4 u_matrix;         // RTC: maplibre matrix * translate(reference)
uniform float u_size;
varying vec3 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_off, 1.0);
  gl_PointSize = u_size;
  v_color = a_color;
}`;

const FRAG = `
precision mediump float;
varying vec3 v_color;
uniform float u_opacity;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;      // round points
  gl_FragColor = vec4(v_color, u_opacity);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('pc shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

// simple blue->green->red height ramp
function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) { const u = t * 2; return [0.15 + 0.1 * u, 0.35 + 0.55 * u, 0.9 - 0.5 * u]; }
  const u = (t - 0.5) * 2; return [0.25 + 0.7 * u, 0.9 - 0.55 * u, 0.4 - 0.3 * u];
}

export function createPointCloudLayer(id, headerUrl, opts = {}) {
  const binUrl = headerUrl.replace(/pc\.json(\?.*)?$/, 'pc.bin$1');
  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    _pointSize: opts.pointSize ?? 2.5,
    _opacity: opts.opacity ?? 1,
    _ready: false,
    _n: 0,

    onAdd(map, gl) {
      this._map = map;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      this._prog = prog;
      this._loc = {
        a_off: gl.getAttribLocation(prog, 'a_off'),
        a_color: gl.getAttribLocation(prog, 'a_color'),
        u_matrix: gl.getUniformLocation(prog, 'u_matrix'),
        u_size: gl.getUniformLocation(prog, 'u_size'),
        u_opacity: gl.getUniformLocation(prog, 'u_opacity')
      };
      this._offBuf = gl.createBuffer();
      this._colBuf = gl.createBuffer();
      this._load(gl).catch((e) => console.error('[pointcloud] load failed', id, e));
    },

    async _load(gl) {
      const hdr = await fetch(headerUrl).then((r) => r.json());
      const buf = await fetch(binUrl).then((r) => r.arrayBuffer());
      const stride = hdr.stride || (hdr.hasColor ? 16 : 12);
      // Clamp to the bytes actually present. A stale-cached binary (e.g. a header
      // updated to a higher point count while the CDN/browser still serves the old
      // shorter .bin under the same URL) would otherwise overrun the DataView and
      // throw RangeError, rendering nothing. Render whatever points we really have.
      const n = Math.min(hdr.count, Math.floor(buf.byteLength / stride));
      if (n < hdr.count) console.warn('[pointcloud] binary shorter than header', id, hdr.count, '->', n);
      const dv = new DataView(buf);
      const [clng, clat, calt] = hdr.center;
      const cm = maplibregl.MercatorCoordinate.fromLngLat([clng, clat], calt);
      const mpm = cm.meterInMercatorCoordinateUnits(); // mercator units per meter
      this._ref = [cm.x, cm.y, cm.z];
      const offs = new Float32Array(n * 3);
      const cols = new Float32Array(n * 3);
      const [umin, umax] = hdr.upRange || [0, 1];
      const span = (umax - umin) || 1;
      for (let i = 0; i < n; i++) {
        const b = i * stride;
        const east = dv.getFloat32(b, true);
        const north = dv.getFloat32(b + 4, true);
        const up = dv.getFloat32(b + 8, true);
        offs[i * 3] = east * mpm;          // mercator X (east +)
        offs[i * 3 + 1] = -north * mpm;    // mercator Y (north is -Y)
        offs[i * 3 + 2] = up * mpm;        // mercator Z (up +)
        if (hdr.hasColor) {
          cols[i * 3] = dv.getUint8(b + 12) / 255;
          cols[i * 3 + 1] = dv.getUint8(b + 13) / 255;
          cols[i * 3 + 2] = dv.getUint8(b + 14) / 255;
        } else {
          const c = ramp((up - umin) / span);
          cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._offBuf);
      gl.bufferData(gl.ARRAY_BUFFER, offs, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._colBuf);
      gl.bufferData(gl.ARRAY_BUFFER, cols, gl.STATIC_DRAW);
      this._n = n;
      this._ready = true;
      this._map?.triggerRepaint();
    },

    render(gl, args) {
      if (!this._ready || !this._n) return;
      // maplibre v5 passes an object (mercator matrix in defaultProjectionData);
      // older/mercator passes the matrix array directly.
      const m = Array.isArray(args) ? args
        : (args?.defaultProjectionData?.mainMatrix || args?.mainMatrix || args);
      if (!m || m.length !== 16) return;
      const [rx, ry, rz] = this._ref;
      const rtc = new Float32Array(16);
      for (let i = 0; i < 16; i++) rtc[i] = m[i];
      rtc[12] = m[0] * rx + m[4] * ry + m[8] * rz + m[12];
      rtc[13] = m[1] * rx + m[5] * ry + m[9] * rz + m[13];
      rtc[14] = m[2] * rx + m[6] * ry + m[10] * rz + m[14];
      rtc[15] = m[3] * rx + m[7] * ry + m[11] * rz + m[15];

      gl.useProgram(this._prog);
      gl.uniformMatrix4fv(this._loc.u_matrix, false, rtc);
      gl.uniform1f(this._loc.u_size, this._pointSize * (window.devicePixelRatio || 1));
      gl.uniform1f(this._loc.u_opacity, this._opacity);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._offBuf);
      gl.enableVertexAttribArray(this._loc.a_off);
      gl.vertexAttribPointer(this._loc.a_off, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._colBuf);
      gl.enableVertexAttribArray(this._loc.a_color);
      gl.vertexAttribPointer(this._loc.a_color, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.drawArrays(gl.POINTS, 0, this._n);
    },

    setOpacity(o) { this._opacity = o; this._map?.triggerRepaint(); },
    setPointSize(s) { this._pointSize = s; this._map?.triggerRepaint(); },

    onRemove(map, gl) {
      try {
        gl.deleteProgram(this._prog);
        gl.deleteBuffer(this._offBuf);
        gl.deleteBuffer(this._colBuf);
      } catch (e) { /* ignore */ }
    }
  };
}
