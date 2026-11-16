/**
 * The effect description the converter writes on a GLB (scene extras `ms2fx`, see cmd/extract/nif/effects.js).
 * Nodes are named by fx id (`userData.ms2.fxId` on the node), which survives cloning.
 */

/** Gamebryo controller timing: local time = clamp/loop/reflect(time * frequency + phase) over [start, stop]. */
export interface ControllerTiming {
  start: number;
  stop: number;
  frequency: number;
  phase: number;
  cycle: 'loop' | 'reverse' | 'clamp';
}

export interface KeyTrack {
  interp: 'linear' | 'step';
  times: number[];
  /** Flat values, `comps` per key. */
  values: number[];
}

export interface EffectTrack extends KeyTrack {
  kind: 'translation' | 'rotation' | 'euler' | 'scale' | 'visible' | 'alpha' | 'color' | 'uv' | 'flip';
  nodes: number[];
  ctl: ControllerTiming;
  comps: number;
  /** color: which material colour */
  which?: 'ambient' | 'diffuse' | 'specular' | 'emissive';
  /** uv / flip: Gamebryo texture slot (0 base, 1 dark, 2 detail, 3 gloss, 4 glow, 5 bump, 6 normal, 8+ decal) */
  slot?: number | 'shader';
  /** uv: 0 translate u, 1 translate v, 2 rotate, 3 scale u, 4 scale v */
  op?: number;
  /** flip: frame textures, relative to the GLB */
  textures?: (string | null)[];
}

export interface ParticleKey<T> {
  time: number;
  value: T;
}

/** PSLoopBehavior: how particle age maps onto key time. */
export const LoopBehavior = { ClampBirth: 0, ClampDeath: 1, AgeScale: 2, Loop: 3, Reflect: 4 } as const;

/** AlignMethod for aligned quads. */
export const AlignMethod = { PerParticle: 1, LocalFixed: 2, LocalPosition: 5, LocalVelocity: 9, Camera: 16 } as const;

export interface EmitterBase {
  name: string;
  speed: number;
  speedVar: number;
  speedFlipRatio: number;
  declination: number;
  declinationVar: number;
  planarAngle: number;
  planarAngleVar: number;
  size: number;
  sizeVar: number;
  lifeSpan: number;
  lifeSpanVar: number;
  rotationAngle: number;
  rotationAngleVar: number;
  rotationSpeed: number;
  rotationSpeedVar: number;
  rotationAxis: [number, number, number];
  randomRotSpeedSign: boolean;
  randomRotAxis: boolean;
  /** fx id of the emitter object (null: the particle system's own space) */
  object: number | null;
}

export type EmitterDesc =
  | (EmitterBase & { kind: 'box'; width: number; height: number; depth: number })
  | (EmitterBase & { kind: 'sphere'; radius: number })
  | (EmitterBase & { kind: 'cylinder'; radius: number; height: number })
  | (EmitterBase & { kind: 'torus'; radius: number; sectionRadius: number })
  | (EmitterBase & {
      kind: 'mesh';
      meshes: number[];
      /** 0 vertices, 1 face centers, 2 edge centers, 3 face surfaces, 4 edge surfaces */
      emissionType: number;
      /** 0 along normals, 1 random, 2 emitter direction */
      velocityType: number;
    });

interface ForceBase {
  name: string;
  active: boolean;
  /** fx id of the force object (null: the particle system's own space) */
  object: number | null;
}

export type ForceDesc =
  | (ForceBase & {
      kind: 'drag';
      axis: [number, number, number];
      percentage: number;
      range: number;
      rangeFalloff: number;
    })
  | (ForceBase & {
      kind: 'gravity';
      axis: [number, number, number];
      decay: number;
      strength: number;
      /** 0 planar (along the axis), 1 spherical (towards the object) */
      gravityType: number;
      turbulence: number;
      turbulenceScale: number;
    })
  | (ForceBase & {
      kind: 'bomb';
      axis: [number, number, number];
      decay: number;
      deltaV: number;
      /** 0 none, 1 linear, 2 exponential */
      decayType: number;
      /** 0 spherical, 1 cylindrical, 2 planar */
      symmetryType: number;
    });

export type ColliderDesc =
  | {
      kind: 'planar';
      active: boolean;
      bounce: number;
      dieOnCollide: boolean;
      width: number;
      height: number;
      xAxis: [number, number, number];
      yAxis: [number, number, number];
      object: number | null;
    }
  | { kind: 'sphere'; active: boolean; bounce: number; dieOnCollide: boolean; radius: number; object: number | null };

export type SystemController =
  | { kind: 'emit'; emitter: string; ctl: ControllerTiming; rate: KeyTrack | null; active: KeyTrack | null }
  | { kind: 'forceActive' | 'gravityStrength'; force: string; ctl: ControllerTiming; track: KeyTrack | null }
  | { kind: 'emitterFloat'; emitter: string; field: keyof EmitterBase; ctl: ControllerTiming; track: KeyTrack | null }
  | { kind: 'resetOnLoop'; ctl: ControllerTiming };

export interface AlignedGenerator {
  kind: 'aligned';
  scaleAmountU: number;
  scaleLimitU: number;
  scaleRestU: number;
  scaleAmountV: number;
  scaleLimitV: number;
  scaleRestV: number;
  centerU: number;
  centerV: number;
  uvScrolling: boolean;
  framesAcross: number;
  framesDown: number;
  pingPong: boolean;
  initialFrame: number;
  initialFrameVar: number;
  numFrames: number;
  numFramesVar: number;
  initialTime: number;
  finalTime: number;
}

export interface SystemDesc {
  node: number;
  name: string;
  mesh: boolean;
  masterParticles?: number[];
  maxParticles: number;
  worldSpace: boolean;
  hasColors: boolean;
  hasRotations: boolean;
  hasRotationAxes: boolean;
  hasAnimatedTextures: boolean;
  normalMethod: number;
  normalDirection: [number, number, number];
  upMethod: number;
  upDirection: [number, number, number];
  generator: { kind: 'facing' } | AlignedGenerator;
  general: {
    sizeKeys: ParticleKey<number>[];
    sizeLoop: number;
    /** RGBA in 0..1 */
    colorKeys: ParticleKey<[number, number, number, number]>[];
    colorLoop: number;
    rotationKeys: ParticleKey<[number, number, number, number]>[];
    rotationLoop: number;
    growTime: number;
    shrinkTime: number;
    growGeneration: number;
    shrinkGeneration: number;
  } | null;
  emitters: EmitterDesc[];
  forces: ForceDesc[];
  colliders: ColliderDesc[];
  controllers: SystemController[];
}

export interface EffectDescription {
  version: 1;
  /** Longest controller span, seconds. */
  duration: number;
  tracks: EffectTrack[];
  systems: SystemDesc[];
}

/** Per-node extras (`userData.ms2`). */
export interface NodeExtras {
  fxId?: number;
  billboard?: number;
  hidden?: boolean;
  particles?: number;
  sortAdjust?: number;
}

/** Per-material render state (`material.userData.ms2.state`). */
export interface RenderState {
  blend?: { src: string; dst: string };
  alphaTest?: { func: string; ref: number };
  depthTest?: boolean;
  depthWrite?: boolean;
  side?: 'both' | 'front' | 'back';
  ambient?: [number, number, number];
  diffuse?: [number, number, number];
  emissive?: [number, number, number];
  alpha?: number;
  colorBoost?: number;
  /** NiVertexColorProperty: which lights apply ('emissive' only, or 'full'), and what vertex colours stand for. */
  lighting?: 'full' | 'emissive';
  vertexColors?: 'ignore' | 'emissive' | 'ambientDiffuse';
}
