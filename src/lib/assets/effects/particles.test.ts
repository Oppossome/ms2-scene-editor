import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { ParticleSimulation, TriangleMeshSampler, type SimSources } from './particles.js';
import type { ControllerTiming, EmitterDesc, ForceDesc, SystemDesc } from './types.js';

const loop: ControllerTiming = { start: 0, stop: 1, frequency: 1, phase: 0, cycle: 'loop' };

function emitter(extra: Partial<EmitterDesc> = {}): EmitterDesc {
  return {
    kind: 'box',
    name: 'emitter',
    width: 0,
    height: 0,
    depth: 0,
    speed: 100,
    speedVar: 0,
    speedFlipRatio: 0,
    declination: 0,
    declinationVar: 0,
    planarAngle: 0,
    planarAngleVar: 0,
    size: 10,
    sizeVar: 0,
    lifeSpan: 1,
    lifeSpanVar: 0,
    rotationAngle: 0,
    rotationAngleVar: 0,
    rotationSpeed: 0,
    rotationSpeedVar: 0,
    rotationAxis: [1, 0, 0],
    randomRotSpeedSign: false,
    randomRotAxis: false,
    object: null,
    ...extra
  } as EmitterDesc;
}

function system(extra: Partial<SystemDesc> = {}): SystemDesc {
  return {
    node: 0,
    name: 'test',
    mesh: false,
    maxParticles: 100,
    worldSpace: true,
    hasColors: true,
    hasRotations: true,
    hasRotationAxes: false,
    hasAnimatedTextures: false,
    normalMethod: 16,
    normalDirection: [0, 0, 0],
    upMethod: 16,
    upDirection: [0, 0, 0],
    generator: { kind: 'facing' },
    general: null,
    emitters: [emitter()],
    forces: [],
    colliders: [],
    controllers: [
      {
        kind: 'emit',
        emitter: 'emitter',
        ctl: loop,
        rate: { interp: 'step', times: [0], values: [10] },
        active: { interp: 'step', times: [0], values: [1] }
      }
    ],
    ...extra
  };
}

const identity: SimSources = { toSim: () => new Matrix4(), mesh: () => null };

function run(sim: ParticleSimulation, seconds: number, sources = identity) {
  const dt = 1 / 30;
  for (let t = dt; t <= seconds + 1e-9; t += dt) sim.step(dt, t, sources);
  return sim;
}

describe('particle simulation', () => {
  it('emits at the controller rate and keeps particles alive for their life span', () => {
    const sim = run(new ParticleSimulation(system()), 0.5);
    expect(sim.count).toBe(5);
    run(sim, 1.5);
    // Steady state: ten per second, each living one second.
    expect(sim.count).toBeGreaterThanOrEqual(9);
    expect(sim.count).toBeLessThanOrEqual(11);
  });

  it('moves particles along the emitter +Z at their speed', () => {
    const sim = run(new ParticleSimulation(system()), 0.2);
    const oldest = [...sim.age.subarray(0, sim.count)].indexOf(Math.max(...sim.age.subarray(0, sim.count)));
    expect(sim.position[oldest * 3 + 2]).toBeCloseTo(sim.age[oldest] * 100, 3);
    expect(sim.position[oldest * 3]).toBeCloseTo(0);
  });

  it('is reproducible for a seed and differs between seeds', () => {
    const varied = system({ emitters: [emitter({ speedVar: 50, declinationVar: 1, planarAngleVar: Math.PI })] });
    const a = run(new ParticleSimulation(varied, 3), 1);
    const b = run(new ParticleSimulation(varied, 3), 1);
    const c = run(new ParticleSimulation(varied, 4), 1);
    expect([...a.position.subarray(0, a.count * 3)]).toEqual([...b.position.subarray(0, b.count * 3)]);
    expect([...a.position.subarray(0, a.count * 3)]).not.toEqual([...c.position.subarray(0, c.count * 3)]);
  });

  it('stops emitting when the active track turns off and never exceeds its capacity', () => {
    const desc = system({ maxParticles: 3 });
    const emit = desc.controllers[0];
    if (emit.kind === 'emit') {
      emit.ctl = { ...loop, stop: 2, cycle: 'clamp' };
      emit.active = { interp: 'step', times: [0, 0.5], values: [1, 0] };
    }
    const sim = run(new ParticleSimulation(desc), 0.45);
    expect(sim.count).toBe(3);
    const late = new ParticleSimulation(desc);
    for (let t = 0.6; t < 2; t += 1 / 30) late.step(1 / 30, t, identity);
    expect(late.count).toBe(0);
  });

  it('applies gravity, drag and colour keys', () => {
    const gravity: ForceDesc = {
      kind: 'gravity',
      name: 'g',
      active: true,
      object: null,
      axis: [0, 0, -1],
      decay: 0,
      strength: 900,
      gravityType: 0,
      turbulence: 0,
      turbulenceScale: 1
    };
    const fall = run(new ParticleSimulation(system({ emitters: [emitter({ speed: 0 })], forces: [gravity] })), 0.5);
    expect(Math.min(...fall.velocity.filter((_, i) => i % 3 === 2).subarray(0, fall.count))).toBeLessThan(-300);

    const drag: ForceDesc = {
      kind: 'drag',
      name: 'd',
      active: true,
      object: null,
      axis: [0, 0, 1],
      percentage: 0.5,
      range: 3.4e38,
      rangeFalloff: 3.4e38
    };
    const slowed = run(new ParticleSimulation(system({ forces: [drag] })), 0.5);
    for (let i = 0; i < slowed.count; i++) expect(slowed.velocity[i * 3 + 2]).toBeLessThan(100);

    const colored = system({
      general: {
        sizeKeys: [],
        sizeLoop: 2,
        colorKeys: [
          { time: 0, value: [1, 0, 0, 1] },
          { time: 1, value: [0, 0, 1, 0] }
        ],
        colorLoop: 2,
        rotationKeys: [],
        rotationLoop: 2,
        growTime: 0,
        shrinkTime: 0,
        growGeneration: 0,
        shrinkGeneration: 0
      }
    });
    const sim = run(new ParticleSimulation(colored), 0.5);
    for (let i = 0; i < sim.count; i++) {
      const u = sim.age[i] / sim.life[i];
      expect(sim.color[i * 4]).toBeCloseTo(1 - u, 4);
      expect(sim.color[i * 4 + 3]).toBeCloseTo(1 - u, 4);
    }
  });

  it('grows and shrinks particles over their grow and shrink times', () => {
    const desc = system({
      general: {
        sizeKeys: [],
        sizeLoop: 2,
        colorKeys: [],
        colorLoop: 2,
        rotationKeys: [],
        rotationLoop: 2,
        growTime: 0.5,
        shrinkTime: 0.25,
        growGeneration: 0,
        shrinkGeneration: 0
      }
    });
    const sim = run(new ParticleSimulation(desc), 1);
    for (let i = 0; i < sim.count; i++) {
      const { age, life } = { age: sim.age[i], life: sim.life[i] };
      const expected = 10 * Math.min(1, age / 0.5) * Math.min(1, (life - age) / 0.25);
      expect(sim.size[i]).toBeCloseTo(expected, 4);
    }
  });

  it('places particles through the emitter object matrix', () => {
    const moved: SimSources = { toSim: () => new Matrix4().makeTranslation(500, 0, 0), mesh: () => null };
    const sim = run(new ParticleSimulation(system()), 0.2, moved);
    for (let i = 0; i < sim.count; i++) expect(sim.position[i * 3]).toBeCloseTo(500);
  });
});

describe('mesh sampler', () => {
  // One triangle in the XY plane, normals along +Z.
  const sampler = new TriangleMeshSampler([0, 0, 0, 10, 0, 0, 0, 10, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2]);

  it('samples surface points inside the triangle with interpolated normals', () => {
    const pos = new Vector3();
    const normal = new Vector3();
    for (let i = 0; i < 20; i++) {
      sampler.sample(3, Math.random(), Math.random(), Math.random(), pos, normal);
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.x + pos.y).toBeLessThanOrEqual(10 + 1e-6);
      expect(normal.z).toBeCloseTo(1);
    }
  });

  it('samples face centres and vertices', () => {
    const pos = new Vector3();
    sampler.sample(1, 0.1, 0, 0, pos, new Vector3());
    expect(pos.x).toBeCloseTo(10 / 3);
    sampler.sample(0, 0.5, 0, 0, pos, new Vector3());
    expect([0, 10]).toContain(pos.x);
  });
});
