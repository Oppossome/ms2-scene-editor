// KF (animation) files -> sampled keyframe clips ready for glTF.
// Evaluators target nodes by name. B-spline evaluators are sampled at a fixed rate; keyframed ones keep their key times.
// Quadratic/TBC interpolation is approximated as linear (rotations as slerp).
const fs = require('fs');
const path = require('path');
const { parseHeader } = require('./header');
const { parseBlock } = require('./parse');

const FLT_MAX_HALF = 1.5e38;
const INVALID_HANDLE = 0xffff;
const SAMPLE_FPS = 30;
const EPS = 1e-5;

const valid = (v) => Math.abs(v) < FLT_MAX_HALF;

// Clamped (open) uniform B-spline basis values for parameter u in [0, 1].
function basisFunctions(n, degree, u) {
  const knotCount = n + degree + 1;
  const knots = new Float64Array(knotCount);
  for (let i = 0; i < knotCount; i++) {
    if (i <= degree) knots[i] = 0;
    else if (i >= n) knots[i] = 1;
    else knots[i] = (i - degree) / (n - degree);
  }
  let span = n - 1;
  if (u < 1) {
    span = degree;
    while (span < n - 1 && u >= knots[span + 1]) span++;
  }
  const basis = new Float64Array(degree + 1);
  const left = new Float64Array(degree + 1),
    right = new Float64Array(degree + 1);
  basis[0] = 1;
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const tmp = denom === 0 ? 0 : basis[r] / denom;
      basis[r] = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    basis[j] = saved;
  }
  return { span, basis };
}

function sampleSpline(controlPoints, comps, count, degree, u, out) {
  const { span, basis } = basisFunctions(count, degree, u);
  for (let c = 0; c < comps; c++) {
    let v = 0;
    for (let j = 0; j <= degree; j++) v += basis[j] * controlPoints[(span - degree + j) * comps + c];
    out[c] = v;
  }
}

function normalizeQuat(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// NIF quaternions are (w, x, y, z); glTF wants (x, y, z, w).
const toGltfQuat = (w, x, y, z) => normalizeQuat([x, y, z, w]);

// Euler (x, y, z radians) -> quaternion (x, y, z, w), applying X then Y then Z (R = Rz * Ry * Rx).
function eulerToQuat(x, y, z) {
  const cx = Math.cos(x / 2),
    sx = Math.sin(x / 2),
    cy = Math.cos(y / 2),
    sy = Math.sin(y / 2),
    cz = Math.cos(z / 2),
    sz = Math.sin(z / 2);
  return normalizeQuat([
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz
  ]);
}

function sampleKeys(keys, time, lerp) {
  if (time <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value;
  let lo = 0,
    hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = keys[lo],
    b = keys[hi];
  return lerp(a.value, b.value, b.time === a.time ? 0 : (time - a.time) / (b.time - a.time));
}
const lerpVec = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * t) : a + (b - a) * t);

// Collapse a channel to one key when every sample is (nearly) identical.
function finishChannel(nodeName, pathName, times, values, comps) {
  let constant = true;
  for (let i = comps; i < values.length && constant; i++)
    if (Math.abs(values[i] - values[i % comps]) > EPS) constant = false;
  if (constant && pathName === 'rotation') {
    // q and -q are the same rotation; sampled data keeps sign continuity so a plain compare is enough here.
  }
  if (constant)
    return {
      nodeName,
      path: pathName,
      times: Float32Array.of(times[0]),
      values: Float32Array.from(values.slice(0, comps))
    };
  return { nodeName, path: pathName, times: Float32Array.from(times), values: Float32Array.from(values) };
}

function evaluateBSplineComp(e, get) {
  const data = get(e.data),
    basis = get(e.basis);
  const channels = [];
  if (!data || !basis) return channels;
  const n = basis.numControlPoints;
  const degree = Math.min(3, n - 1);
  const span = e.endTime - e.startTime;
  const samples = Math.max(2, Math.ceil(span * SAMPLE_FPS) + 1);
  const times = new Float64Array(samples);
  for (let k = 0; k < samples; k++) times[k] = e.startTime + (span * k) / (samples - 1);

  const decode = (handle, comps, offset, halfRange) => {
    const cps = new Float64Array(n * comps);
    for (let i = 0; i < n * comps; i++) cps[i] = offset + halfRange * (data.compact[handle + i] / 32767);
    return cps;
  };
  const run = (handle, comps, offset, halfRange, pathName) => {
    if (handle === INVALID_HANDLE || !valid(offset) || handle + n * comps > data.compact.length) return false;
    const cps = decode(handle, comps, offset, halfRange);
    const values = new Float64Array(samples * (pathName === 'rotation' ? 4 : comps));
    const tmp = new Float64Array(comps);
    let prev = null;
    for (let k = 0; k < samples; k++) {
      sampleSpline(cps, comps, n, degree, samples === 1 ? 0 : k / (samples - 1), tmp);
      if (pathName === 'rotation') {
        let q = toGltfQuat(tmp[0], tmp[1], tmp[2], tmp[3]);
        if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((v) => -v);
        prev = q;
        values.set(q, k * 4);
      } else values.set(tmp, k * comps);
    }
    channels.push(finishChannel(e.nodeName, pathName, times, values, pathName === 'rotation' ? 4 : comps));
    return true;
  };
  run(e.translationHandle, 3, e.translationOffset, e.translationHalfRange, 'translation');
  run(e.rotationHandle, 4, e.rotationOffset, e.rotationHalfRange, 'rotation');
  run(e.scaleHandle, 1, e.scaleOffset, e.scaleHalfRange, 'scale');
  addConstants(e, channels, e.startTime);
  return channels;
}

// Components with no animation data but a valid constant in the evaluator's NiQuatTransform.
function addConstants(e, channels, time) {
  const has = (p) => channels.some((c) => c.path === p);
  const v = e.value;
  if (!has('translation') && v.translation.every(valid))
    channels.push({
      nodeName: e.nodeName,
      path: 'translation',
      times: Float32Array.of(time),
      values: Float32Array.from(v.translation)
    });
  if (!has('rotation') && v.rotation.every(valid))
    channels.push({
      nodeName: e.nodeName,
      path: 'rotation',
      times: Float32Array.of(time),
      values: Float32Array.from(toGltfQuat(...v.rotation))
    });
  if (!has('scale') && valid(v.scale))
    channels.push({
      nodeName: e.nodeName,
      path: 'scale',
      times: Float32Array.of(time),
      values: Float32Array.of(v.scale)
    });
}

function evaluateTransform(e, get) {
  const channels = [];
  const d = get(e.data);
  if (d) {
    if (d.translations.keys.length) {
      const keys = d.translations.keys;
      channels.push(
        finishChannel(
          e.nodeName,
          'translation',
          keys.map((k) => k.time),
          keys.flatMap((k) => k.value),
          3
        )
      );
    }
    if (d.rotationKeys.length) {
      let prev = null;
      const keys = d.rotationKeys;
      const values = [];
      for (const k of keys) {
        let q = toGltfQuat(...k.value);
        if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((v) => -v);
        prev = q;
        values.push(...q);
      }
      channels.push(
        finishChannel(
          e.nodeName,
          'rotation',
          keys.map((k) => k.time),
          values,
          4
        )
      );
    } else if (d.xyzRotations && d.xyzRotations.some((g) => g.keys.length)) {
      const timeSet = new Set();
      for (const g of d.xyzRotations) for (const k of g.keys) timeSet.add(k.time);
      const times = [...timeSet].sort((a, b) => a - b);
      const values = [];
      let prev = null;
      for (const t of times) {
        const ang = d.xyzRotations.map((g) => (g.keys.length ? sampleKeys(g.keys, t, lerpVec) : 0));
        let q = eulerToQuat(...ang);
        if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((v) => -v);
        prev = q;
        values.push(...q);
      }
      channels.push(finishChannel(e.nodeName, 'rotation', times, values, 4));
    }
    if (d.scales.keys.length) {
      const keys = d.scales.keys;
      channels.push(
        finishChannel(
          e.nodeName,
          'scale',
          keys.map((k) => k.time),
          keys.map((k) => k.value),
          1
        )
      );
    }
  }
  addConstants(e, channels, 0);
  return channels;
}

function loadClip(kfPath) {
  const buf = fs.readFileSync(kfPath);
  const h = parseHeader(buf);
  const cache = new Map();
  const get = (i) => {
    if (i < 0 || i >= h.blocks.length) return null;
    if (!cache.has(i)) cache.set(i, parseBlock(buf, h, h.blocks[i]));
    return cache.get(i);
  };
  const seqIndex = h.blocks.findIndex((b) => b.type === 'NiSequenceData');
  if (seqIndex < 0) return null;
  const seq = get(seqIndex);
  const channels = [];
  for (const ei of seq.evaluators) {
    const e = get(ei);
    if (!e) continue; // float/bool/point3 evaluators (material and visibility animation) are not exported
    if (e.type === 'NiBSplineCompTransformEvaluator') channels.push(...evaluateBSplineComp(e, get));
    else if (e.type === 'NiTransformEvaluator') channels.push(...evaluateTransform(e, get));
  }
  const tk = get(seq.textKeys);
  return {
    name: path.basename(kfPath).replace(/\.kf$/i, ''),
    duration: seq.duration,
    cycleType: seq.cycleType,
    frequency: seq.frequency,
    textKeys: tk ? tk.keys.map((k) => ({ time: k.time, text: k.text })) : [],
    channels
  };
}

module.exports = { loadClip, basisFunctions };
