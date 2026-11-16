// Parsers for effect blocks: Gamebryo PS particle systems (NiPS*), legacy time controllers and their interpolators/data,
// node subclasses (billboard, sort adjust) and the small render-state properties effects use.
// Layouts follow niftools nif.xml for version 30.2.0.3; verify.js (fx mode) checks every one against the header sizes.

const v3 = (r) => [r.f32(), r.f32(), r.f32()];
const ref = (r) => r.i32();
const refs = (r) => {
  const n = r.u32();
  const out = [];
  for (let i = 0; i < n; i++) out.push(r.i32());
  return out;
};

function register(PARSERS, { readObjectNET, parseNiNode, parseNiMesh, readKeyGroup, readQuatTransform, str }) {
  // ---- Node subclasses ----
  PARSERS.NiBillboardNode = (r, h) => {
    const o = parseNiNode(r, h);
    o.type = 'NiBillboardNode';
    o.billboardMode = r.u16();
    return o;
  };
  PARSERS.NiSortAdjustNode = (r, h) => {
    const o = parseNiNode(r, h);
    o.type = 'NiSortAdjustNode';
    o.sortingMode = r.u32();
    return o;
  };

  // ---- Properties ----
  PARSERS.NiZBufferProperty = (r, h) => {
    const o = { type: 'NiZBufferProperty' };
    readObjectNET(r, h, o);
    o.flags = r.u16(); // bit 0 test, bit 1 write, bits 2-5 function
    return o;
  };
  PARSERS.NiStencilProperty = (r, h) => {
    const o = { type: 'NiStencilProperty' };
    readObjectNET(r, h, o);
    o.flags = r.u16(); // bits 10-11 draw mode: 0 CCW_OR_BOTH, 1 CCW, 2 CW, 3 BOTH
    o.ref = r.u32();
    o.mask = r.u32();
    return o;
  };
  PARSERS.NiVertexColorProperty = (r, h) => {
    const o = { type: 'NiVertexColorProperty' };
    readObjectNET(r, h, o);
    o.flags = r.u16();
    return o;
  };

  // ---- Extra data ----
  PARSERS.NiStringExtraData = (r, h) => ({ type: 'NiStringExtraData', name: str(h, r.i32()), value: str(h, r.i32()) });
  PARSERS.NiFloatExtraData = (r, h) => ({ type: 'NiFloatExtraData', name: str(h, r.i32()), value: r.f32() });
  PARSERS.NiBooleanExtraData = (r, h) => ({ type: 'NiBooleanExtraData', name: str(h, r.i32()), value: r.u8() });
  PARSERS.NiColorExtraData = (r, h) => ({
    type: 'NiColorExtraData',
    name: str(h, r.i32()),
    value: [r.f32(), r.f32(), r.f32(), r.f32()]
  });

  // ---- Time controllers ----
  function timeController(r, o) {
    o.next = ref(r);
    o.flags = r.u16(); // bit 3 active; bits 1-2 cycle: 0 loop, 1 reverse, 2 clamp
    o.frequency = r.f32();
    o.phase = r.f32();
    o.startTime = r.f32();
    o.stopTime = r.f32();
    o.target = ref(r);
    return o;
  }
  const single = (type, extra) => (r, h) => {
    const o = timeController(r, { type });
    o.interpolator = ref(r);
    if (extra) extra(r, h, o);
    return o;
  };
  PARSERS.NiTransformController = single('NiTransformController');
  PARSERS.NiAlphaController = single('NiAlphaController');
  PARSERS.NiVisController = single('NiVisController');
  PARSERS.NiTextureTransformController = single('NiTextureTransformController', (r, h, o) => {
    o.shaderMap = r.bool();
    o.textureSlot = r.u32(); // 0 base, 1 dark, 2 detail, 3 gloss, 4 glow, 5 bump, 6 normal, 7 parallax, 8+ decal
    o.operation = r.u32(); // 0 translate u, 1 translate v, 2 rotate, 3 scale u, 4 scale v
  });
  PARSERS.NiFlipController = single('NiFlipController', (r, h, o) => {
    o.textureSlot = r.u32();
    o.sources = refs(r);
  });
  PARSERS.NiMaterialColorController = single('NiMaterialColorController', (r, h, o) => {
    o.targetColor = r.u16(); // 0 ambient, 1 diffuse, 2 specular, 3 self illum
  });
  PARSERS.NiPSResetOnLoopCtlr = (r) => timeController(r, { type: 'NiPSResetOnLoopCtlr' });
  const emitterCtlr = (type) =>
    single(type, (r, h, o) => {
      o.emitterName = str(h, r.i32());
    });
  for (const t of [
    'NiPSEmitterSpeedCtlr',
    'NiPSEmitterRadiusCtlr',
    'NiPSEmitterDeclinationCtlr',
    'NiPSEmitterDeclinationVarCtlr',
    'NiPSEmitterPlanarAngleCtlr',
    'NiPSEmitterPlanarAngleVarCtlr',
    'NiPSEmitterRotAngleCtlr',
    'NiPSEmitterRotAngleVarCtlr',
    'NiPSEmitterRotSpeedCtlr',
    'NiPSEmitterRotSpeedVarCtlr',
    'NiPSEmitterLifeSpanCtlr'
  ])
    PARSERS[t] = emitterCtlr(t);
  PARSERS.NiPSEmitParticlesCtlr = single('NiPSEmitParticlesCtlr', (r, h, o) => {
    o.emitterName = str(h, r.i32());
    o.activeInterpolator = ref(r);
  });
  for (const t of [
    'NiPSForceActiveCtlr',
    'NiPSGravityStrengthCtlr',
    'NiPSFieldAttenuationCtlr',
    'NiPSFieldMagnitudeCtlr',
    'NiPSFieldMaxDistanceCtlr'
  ])
    PARSERS[t] = single(t, (r, h, o) => {
      o.forceName = str(h, r.i32());
    });

  // ---- Interpolators and key data ----
  PARSERS.NiFloatInterpolator = (r) => ({ type: 'NiFloatInterpolator', value: r.f32(), data: ref(r) });
  PARSERS.NiBoolInterpolator = (r) => ({ type: 'NiBoolInterpolator', value: r.u8(), data: ref(r) });
  PARSERS.NiBoolTimelineInterpolator = (r) => ({ type: 'NiBoolTimelineInterpolator', value: r.u8(), data: ref(r) });
  PARSERS.NiPoint3Interpolator = (r) => ({ type: 'NiPoint3Interpolator', value: v3(r), data: ref(r) });
  PARSERS.NiTransformInterpolator = (r) => ({
    type: 'NiTransformInterpolator',
    value: readQuatTransform(r),
    data: ref(r)
  });
  PARSERS.NiPathInterpolator = (r) => ({
    type: 'NiPathInterpolator',
    flags: r.u16(),
    bankDir: r.i32(),
    maxBankAngle: r.f32(),
    smoothing: r.f32(),
    followAxis: r.u16(),
    pathData: ref(r),
    percentData: ref(r)
  });
  PARSERS.NiFloatData = (r) => ({ type: 'NiFloatData', keys: readKeyGroup(r, (rr) => rr.f32()) });
  PARSERS.NiBoolData = (r) => ({ type: 'NiBoolData', keys: readKeyGroup(r, (rr) => rr.u8()) });
  PARSERS.NiPosData = (r) => ({ type: 'NiPosData', keys: readKeyGroup(r, v3) });

  // ---- Particle systems ----
  function particleSystem(r, h, type) {
    const o = parseNiMesh(r, h);
    o.type = type;
    o.simulator = ref(r);
    o.boundUpdater = ref(r);
    o.emitters = refs(r);
    o.spawners = refs(r);
    o.deathSpawner = ref(r);
    o.maxParticles = r.u32();
    o.hasColors = r.bool();
    o.hasRotations = r.bool();
    o.hasRotationAxes = r.bool();
    o.hasAnimatedTextures = r.bool();
    o.worldSpace = r.bool();
    o.normalMethod = r.u32(); // AlignMethod: 1 per particle, 2 local fixed, 5 local position, 9 local velocity, 16 camera
    o.normalDirection = v3(r);
    o.upMethod = r.u32();
    o.upDirection = v3(r);
    o.livingSpawner = ref(r);
    const nk = r.u8();
    o.spawnRateKeys = [];
    for (let i = 0; i < nk; i++) o.spawnRateKeys.push({ value: r.f32(), time: r.f32() });
    o.preRPI = r.bool();
    return o;
  }
  PARSERS.NiPSParticleSystem = (r, h) => particleSystem(r, h, 'NiPSParticleSystem');
  PARSERS.NiPSMeshParticleSystem = (r, h) => {
    const o = particleSystem(r, h, 'NiPSMeshParticleSystem');
    o.masterParticles = refs(r);
    o.poolSize = r.u32();
    o.autoFillPools = r.bool();
    return o;
  };

  function meshModifier(r, o) {
    const ns = r.u32();
    r.pos += 2 * ns;
    const nc = r.u32();
    r.pos += 2 * nc;
    return o;
  }
  PARSERS.NiPSFacingQuadGenerator = (r) => meshModifier(r, { type: 'NiPSFacingQuadGenerator' });
  PARSERS.NiPSAlignedQuadGenerator = (r) => {
    const o = meshModifier(r, { type: 'NiPSAlignedQuadGenerator' });
    o.scaleAmountU = r.f32();
    o.scaleLimitU = r.f32();
    o.scaleRestU = r.f32();
    o.scaleAmountV = r.f32();
    o.scaleLimitV = r.f32();
    o.scaleRestV = r.f32();
    o.centerU = r.f32();
    o.centerV = r.f32();
    o.uvScrolling = r.bool();
    o.framesAcross = r.u16();
    o.framesDown = r.u16();
    o.pingPong = r.bool();
    o.initialFrame = r.u16();
    o.initialFrameVar = r.f32();
    o.numFrames = r.u16();
    o.numFramesVar = r.f32();
    o.initialTime = r.f32();
    o.finalTime = r.f32();
    return o;
  };
  PARSERS.NiPSSimulator = (r) => {
    const o = meshModifier(r, { type: 'NiPSSimulator' });
    o.steps = refs(r);
    return o;
  };
  PARSERS.NiPSBoundUpdater = (r) => ({ type: 'NiPSBoundUpdater', updateSkip: r.u16() });

  // PS keys are always linear and store the value before the time (nif.xml has time first; the colour keys of every
  // MS2 file only make sense as value, time: times 0, 0.2, ..., 1 after the RGBA bytes).
  const keys = (r, readValue) => {
    const n = r.u8();
    const out = [];
    for (let i = 0; i < n; i++) {
      const value = readValue(r);
      out.push({ time: r.f32(), value });
    }
    return out;
  };
  const quat = (r) => [r.f32(), r.f32(), r.f32(), r.f32()]; // w, x, y, z
  const color = (r) => [r.u8(), r.u8(), r.u8(), r.u8()];
  PARSERS.NiPSSimulatorGeneralStep = (r) => {
    const o = { type: 'NiPSSimulatorGeneralStep' };
    o.sizeKeys = keys(r, (rr) => rr.f32());
    o.sizeLoop = r.u32(); // PSLoopBehavior: 0 clamp birth, 1 clamp death, 2 age scale, 3 loop, 4 reflect
    o.colorKeys = keys(r, color);
    o.colorLoop = r.u32();
    o.rotationKeys = keys(r, quat);
    o.rotationLoop = r.u32();
    o.growTime = r.f32();
    o.shrinkTime = r.f32();
    o.growGeneration = r.u16();
    o.shrinkGeneration = r.u16();
    return o;
  };
  PARSERS.NiPSSimulatorForcesStep = (r) => ({ type: 'NiPSSimulatorForcesStep', forces: refs(r) });
  PARSERS.NiPSSimulatorCollidersStep = (r) => ({ type: 'NiPSSimulatorCollidersStep', colliders: refs(r) });
  PARSERS.NiPSSimulatorMeshAlignStep = (r) => {
    const o = { type: 'NiPSSimulatorMeshAlignStep' };
    o.rotationKeys = keys(r, quat);
    o.rotationLoop = r.u32();
    return o;
  };
  PARSERS.NiPSSimulatorFinalStep = () => ({ type: 'NiPSSimulatorFinalStep' });

  // ---- Emitters ----
  function emitter(r, h, type) {
    return {
      type,
      name: str(h, r.i32()),
      speed: r.f32(),
      speedVar: r.f32(),
      speedFlipRatio: r.f32(),
      declination: r.f32(),
      declinationVar: r.f32(),
      planarAngle: r.f32(),
      planarAngleVar: r.f32(),
      size: r.f32(),
      sizeVar: r.f32(),
      lifeSpan: r.f32(),
      lifeSpanVar: r.f32(),
      rotationAngle: r.f32(),
      rotationAngleVar: r.f32(),
      rotationSpeed: r.f32(),
      rotationSpeedVar: r.f32(),
      rotationAxis: v3(r),
      randomRotSpeedSign: r.bool(),
      randomRotAxis: r.bool()
    };
  }
  const volume = (type, extra) => (r, h) => {
    const o = emitter(r, h, type);
    o.emitterObject = ref(r);
    extra(r, o);
    return o;
  };
  PARSERS.NiPSBoxEmitter = volume('NiPSBoxEmitter', (r, o) => {
    o.width = r.f32();
    o.height = r.f32();
    o.depth = r.f32();
  });
  PARSERS.NiPSSphereEmitter = volume('NiPSSphereEmitter', (r, o) => {
    o.radius = r.f32();
  });
  PARSERS.NiPSCylinderEmitter = volume('NiPSCylinderEmitter', (r, o) => {
    o.radius = r.f32();
    o.height = r.f32();
  });
  PARSERS.NiPSTorusEmitter = volume('NiPSTorusEmitter', (r, o) => {
    o.radius = r.f32();
    o.sectionRadius = r.f32();
  });
  PARSERS.NiPSMeshEmitter = (r, h) => {
    const o = emitter(r, h, 'NiPSMeshEmitter');
    o.meshes = refs(r);
    o.emitterObject = ref(r);
    o.emissionType = r.u32(); // EmitFrom: 0 vertices, 1 face center, 2 edge center, 3 face surface, 4 edge surface
    o.velocityType = r.u32(); // VelocityType: 0 normals, 1 random, 2 direction
    return o;
  };

  // ---- Forces ----
  function force(r, h, type) {
    return { type, name: str(h, r.i32()), forceType: r.u32(), active: r.bool() };
  }
  PARSERS.NiPSDragForce = (r, h) => {
    const o = force(r, h, 'NiPSDragForce');
    o.axis = v3(r);
    o.percentage = r.f32();
    o.range = r.f32();
    o.rangeFalloff = r.f32();
    o.object = ref(r);
    return o;
  };
  PARSERS.NiPSGravityForce = (r, h) => {
    const o = force(r, h, 'NiPSGravityForce');
    o.axis = v3(r);
    o.decay = r.f32();
    o.strength = r.f32();
    o.gravityType = r.u32(); // ForceType: 0 planar, 1 spherical
    o.turbulence = r.f32();
    o.turbulenceScale = r.f32();
    o.object = ref(r);
    return o;
  };
  PARSERS.NiPSBombForce = (r, h) => {
    const o = force(r, h, 'NiPSBombForce');
    o.axis = v3(r);
    o.decay = r.f32();
    o.deltaV = r.f32();
    o.decayType = r.u32(); // DecayType: 0 none, 1 linear, 2 exponential
    o.symmetryType = r.u32(); // SymmetryType: 0 spherical, 1 cylindrical, 2 planar
    o.object = ref(r);
    return o;
  };

  // ---- Colliders ----
  function collider(r, type) {
    return {
      type,
      spawner: ref(r),
      colliderType: r.u32(),
      active: r.bool(),
      bounce: r.f32(),
      spawnOnCollide: r.bool(),
      dieOnCollide: r.bool()
    };
  }
  PARSERS.NiPSPlanarCollider = (r) => {
    const o = collider(r, 'NiPSPlanarCollider');
    o.width = r.f32();
    o.height = r.f32();
    o.xAxis = v3(r);
    o.yAxis = v3(r);
    o.object = ref(r);
    return o;
  };
  PARSERS.NiPSSphericalCollider = (r) => {
    const o = collider(r, 'NiPSSphericalCollider');
    o.radius = r.f32();
    o.object = ref(r);
    return o;
  };
  PARSERS.NiPSSpawner = (r) => ({
    type: 'NiPSSpawner',
    master: ref(r),
    percentage: r.f32(),
    speedFactor: r.f32(),
    speedFactorVar: r.f32(),
    dirChaos: r.f32(),
    lifeSpan: r.f32(),
    lifeSpanVar: r.f32(),
    generations: r.u16(),
    minToSpawn: r.u32(),
    maxToSpawn: r.u32()
  });
}

// Block types the fx parsers cover, for verify.js.
const FX_TYPES = [
  'NiBillboardNode',
  'NiSortAdjustNode',
  'NiZBufferProperty',
  'NiStencilProperty',
  'NiVertexColorProperty',
  'NiStringExtraData',
  'NiFloatExtraData',
  'NiBooleanExtraData',
  'NiColorExtraData',
  'NiTransformController',
  'NiAlphaController',
  'NiVisController',
  'NiTextureTransformController',
  'NiFlipController',
  'NiMaterialColorController',
  'NiPSResetOnLoopCtlr',
  'NiPSEmitterSpeedCtlr',
  'NiPSEmitterRadiusCtlr',
  'NiPSEmitterLifeSpanCtlr',
  'NiPSEmitterPlanarAngleVarCtlr',
  'NiPSEmitParticlesCtlr',
  'NiPSForceActiveCtlr',
  'NiPSGravityStrengthCtlr',
  'NiFloatInterpolator',
  'NiBoolInterpolator',
  'NiBoolTimelineInterpolator',
  'NiPoint3Interpolator',
  'NiTransformInterpolator',
  'NiPathInterpolator',
  'NiFloatData',
  'NiBoolData',
  'NiPosData',
  'NiPSParticleSystem',
  'NiPSMeshParticleSystem',
  'NiPSFacingQuadGenerator',
  'NiPSAlignedQuadGenerator',
  'NiPSSimulator',
  'NiPSBoundUpdater',
  'NiPSSimulatorGeneralStep',
  'NiPSSimulatorForcesStep',
  'NiPSSimulatorCollidersStep',
  'NiPSSimulatorMeshAlignStep',
  'NiPSSimulatorFinalStep',
  'NiPSBoxEmitter',
  'NiPSSphereEmitter',
  'NiPSCylinderEmitter',
  'NiPSMeshEmitter',
  'NiPSDragForce',
  'NiPSGravityForce',
  'NiPSBombForce',
  'NiPSPlanarCollider',
  'NiPSSphericalCollider',
  'NiPSSpawner'
];

module.exports = { register, FX_TYPES };
