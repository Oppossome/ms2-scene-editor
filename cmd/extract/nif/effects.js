// Effect description for the glTF converter: what glTF cannot express (Gamebryo time controllers, billboards, render
// state, PS particle systems) is written as JSON on scene and node extras and evaluated by the app at runtime.
//
// Scene extras `ms2fx` (version 1):
//   duration      longest controller span (seconds)
//   tracks[]      { kind, nodes: [fxId], ctl, interp, comps, times, values, ...kind fields }
//                 kinds: translation | rotation (xyzw) | euler (xyz radians, R = Rz*Ry*Rx) | scale | visible (node),
//                        alpha | color (+ which) |
//                        uv (+ slot, op) | flip (+ slot, textures[uri]) (the nodes are the meshes using the property)
//   systems[]     particle systems (see describeSystem), referencing nodes by fxId
// Node extras `ms2`: { fxId, billboard, hidden, particles (index into systems), sortAdjust, zMode }
// `ctl` is the Gamebryo controller timing: { start, stop, frequency, phase, cycle: 'loop' | 'reverse' | 'clamp' }.
const { evaluateTransform } = require('./animation');

const CYCLES = ['loop', 'reverse', 'clamp'];

/** A copy of a parsed block without bookkeeping and reference fields. */
function omit(o, keys) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v;
  return out;
}
const ctlTiming = (c) => ({
  start: c.startTime,
  stop: c.stopTime,
  frequency: c.frequency,
  phase: c.phase,
  cycle: CYCLES[(c.flags >> 1) & 3] || 'clamp'
});

/** Every controller on an object, following the `next` chain. */
function controllersOf(get, obj) {
  const out = [];
  const seen = new Set();
  for (let c = obj && obj.controller; c !== undefined && c >= 0 && !seen.has(c); c = get(c) && get(c).next) {
    seen.add(c);
    const ctl = get(c);
    if (!ctl) break;
    out.push(ctl);
  }
  return out;
}

// KeyGroup -> { interp, times, values } (values flat). Quadratic and TBC keys are treated as linear; constant keys step.
function keyTrack(group, comps, toValue = (v) => v) {
  const times = [],
    values = [];
  for (const k of group.keys) {
    times.push(k.time);
    const v = toValue(k.value);
    if (comps === 1) values.push(v);
    else values.push(...v);
  }
  return { interp: group.interpolation === 5 ? 'step' : 'linear', times, values };
}

function sampleLinear(keys, t) {
  if (!keys.length) return 0;
  if (t <= keys[0].time) return keys[0].value;
  for (let k = 1; k < keys.length; k++)
    if (t <= keys[k].time) {
      const a = keys[k - 1],
        b = keys[k];
      return b.time === a.time ? b.value : a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time);
    }
  return keys[keys.length - 1].value;
}

/** Float, bool or point3 interpolator -> key track (a constant interpolator becomes one key). */
function interpolatorTrack(get, ref, comps) {
  const it = get(ref);
  if (!it) return null;
  const data = get(it.data);
  if (data && data.keys && data.keys.keys.length) {
    const track = keyTrack(data.keys, comps);
    if (it.type === 'NiBoolInterpolator' || it.type === 'NiBoolTimelineInterpolator') track.interp = 'step';
    return track;
  }
  const v = it.value;
  if (v === undefined) return null;
  if (comps === 1) {
    if (typeof v !== 'number' || Math.abs(v) > 1e30 || (it.type.startsWith('NiBool') && v > 1)) return null;
    return { interp: 'step', times: [0], values: [v] };
  }
  if (!Array.isArray(v) || v.some((x) => Math.abs(x) > 1e30)) return null;
  return { interp: 'step', times: [0], values: [...v] };
}

const MATERIAL_COLORS = ['ambient', 'diffuse', 'specular', 'emissive'];

/**
 * @param ctx.get        block index -> parsed block
 * @param ctx.blocks     header blocks
 * @param ctx.fxIdOf     block index -> fx id (assigns one on first use; marks the glTF node)
 * @param ctx.meshNodesOfProperty  property block index -> [mesh block index] using it
 * @param ctx.textureUri NiSourceTexture block index -> uri relative to the GLB (or null)
 * @param ctx.systemOf   particle system block index -> its systems[] index (set while building nodes)
 */
function describeEffects(ctx) {
  const { get, blocks, fxIdOf, meshNodesOfProperty, textureUri } = ctx;
  const tracks = [];
  let duration = 0;
  const addTrack = (kind, targets, ctl, track, comps, extra = {}) => {
    if (!track || !targets.length) return;
    const nodes = targets.map(fxIdOf).filter((n) => n !== undefined);
    if (!nodes.length) return;
    const t = ctlTiming(ctl);
    if (Number.isFinite(t.stop) && t.stop < 1e30) duration = Math.max(duration, t.stop);
    tracks.push({ kind, nodes, ctl: t, comps, ...track, ...extra });
  };

  blocks.forEach((b, i) => {
    const obj = get(i);
    if (!obj || obj.controller === undefined || obj.controller < 0) return;
    for (const ctl of controllersOf(get, obj)) {
      switch (ctl.type) {
        case 'NiTransformController': {
          const it = get(ctl.interpolator);
          if (!it || it.type !== 'NiTransformInterpolator') break;
          // Euler keys can turn by more than half a circle between keys (a full spin is 0 -> 2pi), which sampling
          // to quaternions at the key times would lose, so they stay euler angles (R = Rz * Ry * Rx).
          const data = get(it.data);
          const euler = data && !data.rotationKeys.length && data.xyzRotations?.some((g) => g.keys.length);
          if (euler) {
            const times = [...new Set(data.xyzRotations.flatMap((g) => g.keys.map((k) => k.time)))].sort(
              (a, b) => a - b
            );
            const values = times.flatMap((t) => data.xyzRotations.map((g) => sampleLinear(g.keys, t)));
            addTrack('euler', [i], ctl, { interp: 'linear', times, values }, 3);
          }
          for (const ch of evaluateTransform({ nodeName: obj.name, data: it.data, value: it.value }, get)) {
            if (euler && ch.path === 'rotation') continue;
            const comps = ch.path === 'rotation' ? 4 : ch.path === 'translation' ? 3 : 1;
            addTrack(
              ch.path,
              [i],
              ctl,
              { interp: 'linear', times: Array.from(ch.times), values: Array.from(ch.values) },
              comps
            );
          }
          break;
        }
        case 'NiVisController':
          addTrack('visible', [i], ctl, interpolatorTrack(get, ctl.interpolator, 1), 1);
          break;
        case 'NiAlphaController':
          addTrack('alpha', meshNodesOfProperty(i), ctl, interpolatorTrack(get, ctl.interpolator, 1), 1);
          break;
        case 'NiMaterialColorController':
          addTrack('color', meshNodesOfProperty(i), ctl, interpolatorTrack(get, ctl.interpolator, 3), 3, {
            which: MATERIAL_COLORS[ctl.targetColor] || 'diffuse'
          });
          break;
        case 'NiTextureTransformController':
          addTrack('uv', meshNodesOfProperty(i), ctl, interpolatorTrack(get, ctl.interpolator, 1), 1, {
            slot: ctl.shaderMap ? 'shader' : ctl.textureSlot,
            op: ctl.operation
          });
          break;
        case 'NiFlipController':
          addTrack('flip', meshNodesOfProperty(i), ctl, interpolatorTrack(get, ctl.interpolator, 1), 1, {
            slot: ctl.textureSlot,
            textures: ctl.sources.map(textureUri)
          });
          break;
        default:
          break; // particle controllers are read by describeSystem; morph weights are not supported
      }
    }
  });
  return { tracks, duration };
}

/** Particle system block -> description for the app's simulator. Object references become fx ids. */
function describeSystem(ctx, i) {
  const { get, fxIdOf } = ctx;
  const ps = get(i);
  const node = (ref) => (ref >= 0 ? fxIdOf(ref) : null);
  const sys = {
    node: fxIdOf(i),
    name: ps.name,
    mesh: ps.type === 'NiPSMeshParticleSystem',
    maxParticles: ps.maxParticles,
    worldSpace: ps.worldSpace,
    hasColors: ps.hasColors,
    hasRotations: ps.hasRotations,
    hasRotationAxes: ps.hasRotationAxes,
    hasAnimatedTextures: ps.hasAnimatedTextures,
    normalMethod: ps.normalMethod,
    normalDirection: ps.normalDirection,
    upMethod: ps.upMethod,
    upDirection: ps.upDirection,
    generator: { kind: 'facing' },
    general: null,
    meshAlign: null,
    emitters: [],
    forces: [],
    colliders: [],
    controllers: []
  };
  if (sys.mesh) sys.masterParticles = ps.masterParticles.map(node).filter((n) => n != null);

  for (const m of ps.modifiers.map(get)) {
    if (!m) continue;
    if (m.type === 'NiPSAlignedQuadGenerator') {
      sys.generator = { kind: 'aligned', ...omit(m, ['type', 'consumed']) };
    }
  }
  const sim = get(ps.simulator);
  for (const step of (sim ? sim.steps : []).map(get)) {
    if (!step) continue;
    if (step.type === 'NiPSSimulatorGeneralStep') {
      sys.general = {
        sizeKeys: step.sizeKeys,
        sizeLoop: step.sizeLoop,
        colorKeys: step.colorKeys.map((k) => ({ time: k.time, value: k.value.map((c) => c / 255) })),
        colorLoop: step.colorLoop,
        rotationKeys: step.rotationKeys,
        rotationLoop: step.rotationLoop,
        growTime: step.growTime,
        shrinkTime: step.shrinkTime,
        growGeneration: step.growGeneration,
        shrinkGeneration: step.shrinkGeneration
      };
    } else if (step.type === 'NiPSSimulatorMeshAlignStep') {
      sys.meshAlign = { rotationKeys: step.rotationKeys, rotationLoop: step.rotationLoop };
    } else if (step.type === 'NiPSSimulatorForcesStep') {
      for (const f of step.forces.map(get)) {
        if (!f) continue;
        const kind = { NiPSDragForce: 'drag', NiPSGravityForce: 'gravity', NiPSBombForce: 'bomb' }[f.type];
        if (kind) sys.forces.push({ kind, ...omit(f, ['type', 'consumed', 'object']), object: node(f.object) });
      }
    } else if (step.type === 'NiPSSimulatorCollidersStep') {
      for (const c of step.colliders.map(get)) {
        if (!c) continue;
        const kind = { NiPSPlanarCollider: 'planar', NiPSSphericalCollider: 'sphere' }[c.type];
        if (kind)
          sys.colliders.push({ kind, ...omit(c, ['type', 'consumed', 'object', 'spawner']), object: node(c.object) });
      }
    }
  }
  for (const e of ps.emitters.map(get)) {
    if (!e) continue;
    const kind = {
      NiPSBoxEmitter: 'box',
      NiPSSphereEmitter: 'sphere',
      NiPSCylinderEmitter: 'cylinder',
      NiPSTorusEmitter: 'torus',
      NiPSMeshEmitter: 'mesh'
    }[e.type];
    if (!kind) continue;
    const out = { kind, ...omit(e, ['type', 'consumed', 'emitterObject', 'meshes']), object: node(e.emitterObject) };
    if (e.meshes) out.meshes = e.meshes.map(node).filter((n) => n != null);
    sys.emitters.push(out);
  }
  for (const c of controllersOf(get, ps)) {
    const timing = ctlTiming(c);
    switch (c.type) {
      case 'NiPSEmitParticlesCtlr':
        sys.controllers.push({
          kind: 'emit',
          emitter: c.emitterName,
          ctl: timing,
          rate: interpolatorTrack(get, c.interpolator, 1),
          active: interpolatorTrack(get, c.activeInterpolator, 1)
        });
        break;
      case 'NiPSForceActiveCtlr':
        sys.controllers.push({
          kind: 'forceActive',
          force: c.forceName,
          ctl: timing,
          track: interpolatorTrack(get, c.interpolator, 1)
        });
        break;
      case 'NiPSGravityStrengthCtlr':
        sys.controllers.push({
          kind: 'gravityStrength',
          force: c.forceName,
          ctl: timing,
          track: interpolatorTrack(get, c.interpolator, 1)
        });
        break;
      case 'NiPSResetOnLoopCtlr':
        sys.controllers.push({ kind: 'resetOnLoop', ctl: timing });
        break;
      default: {
        const field = {
          NiPSEmitterSpeedCtlr: 'speed',
          NiPSEmitterRadiusCtlr: 'size',
          NiPSEmitterLifeSpanCtlr: 'lifeSpan',
          NiPSEmitterDeclinationCtlr: 'declination',
          NiPSEmitterDeclinationVarCtlr: 'declinationVar',
          NiPSEmitterPlanarAngleCtlr: 'planarAngle',
          NiPSEmitterPlanarAngleVarCtlr: 'planarAngleVar',
          NiPSEmitterRotAngleCtlr: 'rotationAngle',
          NiPSEmitterRotAngleVarCtlr: 'rotationAngleVar',
          NiPSEmitterRotSpeedCtlr: 'rotationSpeed',
          NiPSEmitterRotSpeedVarCtlr: 'rotationSpeedVar'
        }[c.type];
        if (field)
          sys.controllers.push({
            kind: 'emitterFloat',
            emitter: c.emitterName,
            field,
            ctl: timing,
            track: interpolatorTrack(get, c.interpolator, 1)
          });
      }
    }
  }
  return sys;
}

/** Blocks a particle system needs as glTF nodes (emitter, force and collider objects, emitter meshes, master particles). */
function systemReferences(get, i) {
  const ps = get(i);
  const out = [];
  const add = (r) => r !== undefined && r >= 0 && out.push(r);
  for (const e of ps.emitters.map(get)) {
    if (!e) continue;
    add(e.emitterObject);
    if (e.meshes) e.meshes.forEach(add);
  }
  const sim = get(ps.simulator);
  for (const step of (sim ? sim.steps : []).map(get)) {
    if (!step) continue;
    for (const f of (step.forces || []).map(get)) if (f) add(f.object);
    for (const c of (step.colliders || []).map(get)) if (c) add(c.object);
  }
  if (ps.masterParticles) ps.masterParticles.forEach(add);
  return out;
}

const isParticleSystem = (o) => !!o && (o.type === 'NiPSParticleSystem' || o.type === 'NiPSMeshParticleSystem');
const hasController = (get, o, type) => controllersOf(get, o).some((c) => c.type === type);

/** Blend factor names (NiAlphaProperty flags bits 1-4 source, 5-8 destination). */
const BLEND = [
  'one',
  'zero',
  'srcColor',
  'oneMinusSrcColor',
  'dstColor',
  'oneMinusDstColor',
  'srcAlpha',
  'oneMinusSrcAlpha',
  'dstAlpha',
  'oneMinusDstAlpha',
  'srcAlphaSaturate'
];
const TESTS = ['always', 'less', 'equal', 'lessEqual', 'greater', 'notEqual', 'greaterEqual', 'never'];

/** Render state the glTF material model lacks, for material extras. */
function renderState({ alpha, zbuffer, stencil, vertexColor, material, colorBoost }) {
  const s = {};
  // NiVertexColorProperty: bit 3 lighting (0 emissive only, 1 emissive + ambient + diffuse), bits 4-5 what vertex
  // (and particle) colours stand for (0 ignored, 1 emissive, 2 ambient and diffuse). Without one, Gamebryo lights
  // everything and ignores vertex colours.
  if (vertexColor) {
    s.lighting = (vertexColor.flags >> 3) & 1 ? 'full' : 'emissive';
    s.vertexColors = ['ignore', 'emissive', 'ambientDiffuse'][(vertexColor.flags >> 4) & 3] || 'ignore';
  }
  if (alpha) {
    if (alpha.flags & 1)
      s.blend = { src: BLEND[(alpha.flags >> 1) & 15] || 'srcAlpha', dst: BLEND[(alpha.flags >> 5) & 15] || 'one' };
    if (alpha.flags & 0x200) s.alphaTest = { func: TESTS[(alpha.flags >> 10) & 7], ref: alpha.threshold / 255 };
  }
  if (zbuffer) {
    s.depthTest = !!(zbuffer.flags & 1);
    s.depthWrite = !!(zbuffer.flags & 2);
  }
  if (stencil) s.side = ['both', 'front', 'back', 'both'][(stencil.flags >> 10) & 3];
  if (material) {
    s.ambient = material.ambient;
    s.diffuse = material.diffuse;
    s.emissive = material.emissive;
    s.alpha = material.alpha;
  }
  if (colorBoost !== undefined && colorBoost !== 1) s.colorBoost = colorBoost;
  return s;
}

module.exports = {
  describeEffects,
  describeSystem,
  systemReferences,
  isParticleSystem,
  hasController,
  controllersOf,
  renderState
};
