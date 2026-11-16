import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { EffectMaterial } from './materials.js';
import { QuadParticles } from './particle-render.js';
import { EffectPlayer, hasEffects } from './player.js';
import type { ControllerTiming, EffectDescription, SystemDesc } from './types.js';

const loop: ControllerTiming = { start: 0, stop: 2, frequency: 1, phase: 0, cycle: 'loop' };
const clamp: ControllerTiming = { ...loop, cycle: 'clamp' };

const system: SystemDesc = {
  node: 3,
  name: 'sparks',
  mesh: false,
  maxParticles: 50,
  worldSpace: true,
  hasColors: false,
  hasRotations: false,
  hasRotationAxes: false,
  hasAnimatedTextures: false,
  normalMethod: 16,
  normalDirection: [0, 0, 0],
  upMethod: 16,
  upDirection: [0, 0, 0],
  generator: { kind: 'facing' },
  general: null,
  emitters: [
    {
      kind: 'sphere',
      name: 'e',
      radius: 5,
      speed: 50,
      speedVar: 20,
      speedFlipRatio: 0,
      declination: 0,
      declinationVar: 1,
      planarAngle: 0,
      planarAngleVar: 3,
      size: 4,
      sizeVar: 1,
      lifeSpan: 0.8,
      lifeSpanVar: 0.2,
      rotationAngle: 0,
      rotationAngleVar: 0,
      rotationSpeed: 0,
      rotationSpeedVar: 0,
      rotationAxis: [1, 0, 0],
      randomRotSpeedSign: false,
      randomRotAxis: false,
      object: 0
    }
  ],
  forces: [],
  colliders: [],
  controllers: [
    {
      kind: 'emit',
      emitter: 'e',
      ctl: loop,
      rate: { interp: 'step', times: [0], values: [20] },
      active: { interp: 'step', times: [0], values: [1] }
    }
  ]
};

const description: EffectDescription = {
  version: 1,
  duration: 2,
  tracks: [
    {
      kind: 'translation',
      nodes: [0],
      ctl: clamp,
      comps: 3,
      interp: 'linear',
      times: [0, 2],
      values: [0, 0, 0, 0, 0, 100]
    },
    { kind: 'visible', nodes: [2], ctl: clamp, comps: 1, interp: 'step', times: [0, 1], values: [0, 1] },
    { kind: 'alpha', nodes: [1], ctl: clamp, comps: 1, interp: 'linear', times: [0, 2], values: [1, 0] }
  ],
  systems: [system]
};

function quad() {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0], 3));
  return g;
}

/** A scene shaped like a converted effect GLB. */
function effectScene(): { root: Group; nodes: Object3D[] } {
  const root = new Group();
  root.userData.ms2fx = structuredClone(description);
  const mover = new Group();
  mover.userData.ms2 = { fxId: 0 };
  const glowMaterial = new MeshStandardMaterial();
  glowMaterial.userData.ms2 = { state: { blend: { src: 'srcAlpha', dst: 'one' }, emissive: [1, 0.5, 0], alpha: 1 } };
  const glow = new Mesh(quad(), glowMaterial);
  glow.userData.ms2 = { fxId: 1 };
  const flash = new Mesh(quad(), glowMaterial);
  flash.userData.ms2 = { fxId: 2, hidden: true };
  const sparksMaterial = new MeshStandardMaterial();
  sparksMaterial.userData.ms2 = { state: { blend: { src: 'srcAlpha', dst: 'one' }, emissive: [1, 1, 1] } };
  const sparks = new Mesh(quad(), sparksMaterial);
  sparks.userData.ms2 = { fxId: 3, particles: 0 };
  mover.add(glow, flash, sparks);
  root.add(mover);
  return { root, nodes: [mover, glow, flash, sparks] };
}

describe('effect player', () => {
  it('recognises models with effects', () => {
    expect(hasEffects(effectScene().root)).toBe(true);
    expect(hasEffects(new Group().add(new Mesh(quad(), new MeshStandardMaterial())))).toBe(false);
  });

  it('applies transform, visibility and material tracks', () => {
    const { root, nodes } = effectScene();
    const player = new EffectPlayer(root);
    const [mover, glow, flash] = nodes as [Group, Mesh, Mesh];
    expect(flash.visible).toBe(false);
    expect(glow.material).toBeInstanceOf(EffectMaterial);

    player.update(1);
    expect(mover.position.z).toBeCloseTo(50);
    expect(flash.visible).toBe(true);
    expect((glow.material as EffectMaterial).opacityValue).toBeCloseTo(0.5);

    player.update(5);
    expect(mover.position.z).toBeCloseTo(100);
    expect(player.duration).toBe(2);
    expect(player.selfLooping).toBe(false);
  });

  it('hides the particle template and draws the simulated particles', () => {
    const { root, nodes } = effectScene();
    const sparks = nodes[3] as Mesh;
    const player = new EffectPlayer(root);
    player.update(0.5);
    expect((sparks.material as { visible: boolean }).visible).toBe(false);
    const quads = sparks.children[0] as Mesh;
    expect(quads.userData.effectParticles).toBe(true);
    expect((quads.geometry as unknown as { instanceCount: number }).instanceCount).toBeGreaterThan(5);
    expect(player.particleTail).toBeCloseTo(0.9);
  });

  it('reaches the same particles by seeking as by stepping', () => {
    const stepped = effectScene();
    const a = new EffectPlayer(stepped.root, { seed: 9 });
    for (let t = 0; t <= 1.5 + 1e-9; t += 1 / 60) a.update(t);
    const sought = effectScene();
    const b = new EffectPlayer(sought.root, { seed: 9 });
    b.update(1.5);
    const count = (root: Object3D) =>
      ((root.getObjectByName('sparks (particles)') as Mesh).geometry as unknown as { instanceCount: number })
        .instanceCount;
    expect(Math.abs(count(stepped.root) - count(sought.root))).toBeLessThanOrEqual(1);
  });

  it('restores the original materials on dispose', () => {
    const { root, nodes } = effectScene();
    const glow = nodes[1] as Mesh;
    const original = glow.material;
    const player = new EffectPlayer(root);
    expect(glow.material).not.toBe(original);
    player.dispose();
    expect(glow.material).toBe(original);
    expect(nodes[3].children.filter((c) => c instanceof Mesh && c.userData.effectParticles)).toHaveLength(0);
  });

  it('sizes quads by the particle size option', () => {
    const { root, nodes } = effectScene();
    const player = new EffectPlayer(root, { sizeScale: 3 });
    player.update(0.5);
    const quads = nodes[3].children[0] as Mesh;
    expect(quads).toBeInstanceOf(Mesh);
    expect(QuadParticles).toBeDefined();
    expect(
      (quads.material as unknown as { uniforms: Record<string, { value: number }> }).uniforms.sizeScale.value
    ).toBe(3);
  });
});
