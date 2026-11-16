import {
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type Camera,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture
} from 'three';
import { EffectMaterial, isAdditive, loadEffectTexture, SLOTS } from './materials.js';
import { MeshParticles, QuadParticles, type ParticleRenderer } from './particle-render.js';
import { ParticleSimulation, TriangleMeshSampler, type MeshSampler, type SimSources } from './particles.js';
import { controllerTime, sampleTrack } from './timing.js';
import type { EffectDescription, EffectTrack, NodeExtras, RenderState, SystemDesc } from './types.js';

/** Fixed step for particle simulation (seconds). */
const STEP = 1 / 30;
/** Largest time jump simulated step by step; anything bigger re-simulates from a window before the target. */
const MAX_INCREMENT = 0.5;
/** Hard cap on steps per update, so a huge seek cannot freeze the page. */
const MAX_STEPS = 300;

export interface EffectOptions {
  seed?: number;
  /** Multiplies particle emission (0 hides particles). */
  emissionScale?: number;
  /** Multiplies particle and billboard sizes. */
  sizeScale?: number;
  /** Multiplies every effect colour. */
  tint?: Color;
}

const nodeExtras = (o: Object3D): NodeExtras | undefined => o.userData.ms2 as NodeExtras | undefined;
const stateOf = (m: Material | undefined): RenderState | undefined =>
  (m?.userData?.ms2 as { state?: RenderState } | undefined)?.state;

/** The effect description stored on a loaded model's scene (or undefined). */
export function effectDescription(root: Object3D): EffectDescription | undefined {
  let found: EffectDescription | undefined;
  root.traverse((o) => {
    if (!found && o.userData.ms2fx) found = o.userData.ms2fx as EffectDescription;
  });
  return found;
}

/** Whether a loaded model needs an EffectPlayer: effect description, billboards or effect render states. */
export function hasEffects(root: Object3D): boolean {
  let yes = false;
  root.traverse((o) => {
    if (yes) return;
    if (o.userData.ms2fx || nodeExtras(o)?.billboard !== undefined) yes = true;
    const m = (o as Mesh).material as Material | Material[] | undefined;
    for (const material of [m].flat()) if (isEffectState(stateOf(material))) yes = true;
  });
  return yes;
}

/** Materials that only look right with the effect material: additive, or blended without depth writes. */
function isEffectState(state: RenderState | undefined) {
  return !!state && (isAdditive(state) || (!!state.blend && state.depthWrite === false));
}

const hiddenMaterial = new MeshBasicMaterial({ visible: false });

/** Meshes a node stands for: itself, or the primitive meshes directly below it. */
function meshesOf(node: Object3D): Mesh[] {
  if ((node as Mesh).isMesh) return [node as Mesh];
  return node.children.filter((c) => (c as Mesh).isMesh && !nodeExtras(c)) as Mesh[];
}

interface SystemRuntime {
  desc: SystemDesc;
  node: Object3D;
  sim: ParticleSimulation;
  renderer: ParticleRenderer;
}

const tmpMatrix = new Matrix4();
const tmpInverse = new Matrix4();
const tmpPos = new Vector3();
const tmpScale = new Vector3();
const tmpQuat = new Quaternion();
const tmpCamPos = new Vector3();
const tmpCamQuat = new Quaternion();
const tmpVec = new Vector3();
const tmpVec2 = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const sampled: number[] = [];

/**
 * Plays a converted Gamebryo effect on an instantiated model: controller tracks (transforms, visibility, material
 * alpha/colour, scrolling and flip-book textures), billboards and particle systems. `update(time)` is cheap to call
 * every frame; seeking (a time jump backwards or far ahead) re-simulates the particles.
 */
export class EffectPlayer {
  readonly description: EffectDescription | undefined;
  readonly duration: number;
  /** Whether everything repeats on its own (looping controllers): a "loop" effect then needs no restart. */
  readonly selfLooping: boolean;
  private readonly nodes = new Map<number, Object3D>();
  private readonly materials = new Map<Mesh, EffectMaterial>();
  private readonly systems: SystemRuntime[] = [];
  private readonly samplers = new Map<number, MeshSampler | null>();
  private readonly restore: (() => void)[] = [];
  private readonly flipFrames = new Map<string, Texture>();
  private lastTime: number | undefined;
  private options: Required<EffectOptions>;
  private disposed = false;

  constructor(
    readonly root: Object3D,
    options: EffectOptions = {},
    /** Resolves a texture URI from the model's extras (relative to its GLB). */
    private readonly resolveUri: (uri: string) => string | undefined = () => undefined
  ) {
    this.options = { seed: 1, emissionScale: 1, sizeScale: 1, tint: new Color(1, 1, 1), ...options };
    this.description = effectDescription(root);
    root.traverse((o) => {
      const extras = nodeExtras(o);
      if (extras?.fxId !== undefined) this.nodes.set(extras.fxId, o);
    });
    this.setupMaterials();
    this.setupNodes();
    this.setupSystems();
    const desc = this.description;
    this.duration = desc?.duration ?? 0;
    const oneShot =
      !!desc &&
      (desc.tracks.some((t) => t.ctl.cycle === 'clamp' && t.times.length > 1) ||
        desc.systems.some((s) => s.controllers.some((c) => c.kind === 'emit' && c.ctl.cycle === 'clamp')));
    this.selfLooping = !oneShot;
  }

  /** Longest particle life (seconds), for letting the last particles fade before a restart. */
  get particleTail(): number {
    return this.systems.reduce((max, s) => Math.max(max, s.sim.maxLife), 0);
  }

  setOptions(options: EffectOptions) {
    const before = this.options;
    this.options = { ...before, ...options };
    for (const s of this.systems) s.sim.emissionScale = this.options.emissionScale;
    if (options.seed !== undefined && options.seed !== before.seed) this.lastTime = undefined;
  }

  /** Swap the materials of effect meshes for EffectMaterials (per instance, so tracks animate this copy only). */
  private setupMaterials() {
    const all = !!this.description;
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || nodeExtras(mesh)?.particles !== undefined) return;
      const source = mesh.material as MeshStandardMaterial;
      if (Array.isArray(source)) return;
      const state = stateOf(source);
      if (!state || !(all || isEffectState(state))) return;
      const extras = (source.userData.ms2 ?? {}) as Record<string, unknown>;
      const material = new EffectMaterial(
        state,
        { base: source.map ?? null },
        {
          vertexColors: source.vertexColors,
          uvTransforms: extras.uvTransforms as Record<string, unknown> | undefined
        }
      );
      material.name = source.name;
      material.userData = source.userData;
      for (const slot of ['glow', 'detail'] as const) {
        const uri = extras[slot];
        const url = typeof uri === 'string' ? this.resolveUri(uri) : undefined;
        if (url)
          void loadEffectTexture(url).then((texture) => {
            if (!this.disposed) material.setMap(slot, texture);
          });
      }
      mesh.material = material;
      this.materials.set(mesh, material);
      this.restore.push(() => {
        mesh.material = source;
        material.dispose();
      });
    });
  }

  /** Hidden-until-shown nodes and billboards. */
  private setupNodes() {
    this.root.traverse((node) => {
      const extras = nodeExtras(node);
      if (!extras) return;
      if (extras.hidden) node.visible = false;
      if (extras.billboard !== undefined) this.setupBillboard(node, extras.billboard & 7);
    });
  }

  /**
   * Gamebryo billboards turn their local +Z towards the camera with +Y up: modes 0 and 2 take the camera's
   * orientation, 1 turns about the node's own +Y, 3 and 4 face the camera position. The world matrix of every mesh
   * below is fixed up right before it is drawn, so each camera (scene and previews) sees it facing itself.
   */
  private setupBillboard(node: Object3D, mode: number) {
    const facing = new Matrix4();
    const relative = new Matrix4();
    const turn = new Quaternion();
    const face = (camera: Camera) => {
      node.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
      camera.matrixWorld.decompose(tmpCamPos, tmpCamQuat, tmpVec);
      const s = this.options.sizeScale;
      if (s !== 1) tmpScale.multiplyScalar(s);
      if (mode === 1) {
        // Turn about the node's +Y so its +Z points at the camera.
        tmpInverse.copy(node.matrixWorld).invert();
        tmpVec.copy(tmpCamPos).applyMatrix4(tmpInverse);
        tmpQuat.multiply(turn.setFromAxisAngle(yAxis, Math.atan2(tmpVec.x, tmpVec.z)));
      } else if (mode === 3 || mode === 4) {
        const z = tmpVec.subVectors(tmpCamPos, tmpPos).normalize();
        const up = tmpVec2.set(0, 1, 0).applyQuaternion(tmpCamQuat);
        const x = new Vector3().crossVectors(up, z).normalize();
        const y = new Vector3().crossVectors(z, x);
        tmpQuat.setFromRotationMatrix(tmpMatrix.makeBasis(x, y, z));
      } else {
        tmpQuat.copy(tmpCamQuat);
      }
      facing.compose(tmpPos, tmpQuat, tmpScale);
    };
    node.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || mesh === node) return;
      const previous = mesh.onBeforeRender;
      mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
        face(camera);
        // The mesh's place relative to the billboard node stays as authored.
        relative.copy(node.matrixWorld).invert().multiply(mesh.matrixWorld);
        mesh.matrixWorld.multiplyMatrices(facing, relative);
        mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
        mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
        previous.call(this, renderer, scene, camera, geometry, material, group);
      };
      this.restore.push(() => (mesh.onBeforeRender = previous));
    });
    if ((node as Mesh).isMesh) {
      // A billboard that is itself a mesh: fix up its own matrix the same way.
      const mesh = node as Mesh;
      const previous = mesh.onBeforeRender;
      mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
        face(camera);
        mesh.matrixWorld.copy(facing);
        mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
        mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
        previous.call(this, renderer, scene, camera, geometry, material, group);
      };
      this.restore.push(() => (mesh.onBeforeRender = previous));
    }
  }

  private setupSystems() {
    const desc = this.description;
    if (!desc) return;
    this.root.traverse((o) => {
      const index = nodeExtras(o)?.particles;
      if (index === undefined || !(o as Mesh).isMesh) return;
      const sys = desc.systems[index];
      if (!sys) return;
      const mesh = o as Mesh;
      const template = mesh.material as MeshStandardMaterial;
      const state = stateOf(template) ?? {};
      // The template quad only carries the material: never draw or pick it.
      mesh.material = hiddenMaterial;
      const raycast = mesh.raycast;
      mesh.raycast = () => {};
      let renderer: ParticleRenderer;
      if (sys.mesh) {
        const masters = (sys.masterParticles ?? [])
          .map((id) => this.nodes.get(id))
          .flatMap((n) => (n ? meshesOf(n) : []));
        // Master particles are templates, not part of the scene.
        for (const m of masters) m.visible = false;
        renderer = new MeshParticles(sys, masters);
      } else {
        renderer = new QuadParticles(sys, state, template.map ?? null);
      }
      mesh.add(renderer.object);
      const sim = new ParticleSimulation(sys, this.options.seed + index * 7919, this.options.emissionScale);
      this.systems.push({ desc: sys, node: mesh, sim, renderer });
      this.restore.push(() => {
        mesh.material = template;
        mesh.raycast = raycast;
        renderer.object.removeFromParent();
        renderer.dispose();
      });
    });
  }

  /** Bring everything to `time` seconds of effect time. */
  update(time: number) {
    if (this.disposed) return;
    this.applyTracks(time);
    if (!this.systems.length) return;
    this.root.updateWorldMatrix(true, true);
    const last = this.lastTime;
    if (last === undefined || time < last || time - last > MAX_INCREMENT) this.resimulate(time);
    else this.advance(last, time);
    this.lastTime = time;
    this.draw();
  }

  /** Drop particle state; the next update re-simulates from scratch. */
  restart() {
    this.lastTime = undefined;
  }

  private advance(from: number, to: number) {
    let t = from;
    let steps = 0;
    while (to - t > 1e-6 && steps++ < MAX_STEPS) {
      const dt = Math.min(STEP, to - t);
      t += dt;
      this.stepAll(dt, t);
    }
  }

  private resimulate(time: number) {
    for (const s of this.systems) s.sim.reset();
    const window = this.particleTail + 0.5;
    const start = Math.max(0, time - window);
    let t = start;
    let steps = 0;
    while (time - t > 1e-6 && steps++ < MAX_STEPS) {
      const dt = Math.min(STEP, time - t);
      t += dt;
      this.stepAll(dt, t);
    }
  }

  private stepAll(dt: number, time: number) {
    for (const s of this.systems) s.sim.step(dt, time, this.sources(s));
  }

  /** Object-to-sim matrices and mesh samplers for one system. */
  private sources(s: SystemRuntime): SimSources {
    const simInverse = s.desc.worldSpace ? null : new Matrix4().copy(s.node.matrixWorld).invert();
    const cache = new Map<number | null, Matrix4>();
    return {
      toSim: (id) => {
        let m = cache.get(id);
        if (!m) {
          const object = id === null ? s.node : (this.nodes.get(id) ?? s.node);
          m = simInverse ? new Matrix4().multiplyMatrices(simInverse, object.matrixWorld) : object.matrixWorld.clone();
          cache.set(id, m);
        }
        return m;
      },
      mesh: (id) => this.sampler(id)
    };
  }

  private sampler(id: number): MeshSampler | null {
    if (this.samplers.has(id)) return this.samplers.get(id)!;
    const node = this.nodes.get(id);
    const mesh = node ? meshesOf(node)[0] : undefined;
    let sampler: MeshSampler | null = null;
    if (mesh && !(mesh instanceof SkinnedMesh)) {
      const g = mesh.geometry;
      const pos = g.getAttribute('position');
      const normal = g.getAttribute('normal');
      const index = g.getIndex();
      if (pos) {
        const idx = index ? Array.from(index.array) : Array.from({ length: pos.count }, (_, i) => i);
        // Mesh positions are relative to the mesh; when the node is a group, they still are (meshesOf picks a child).
        sampler = new TriangleMeshSampler(
          pos.array as ArrayLike<number>,
          (normal?.array as ArrayLike<number> | undefined) ?? null,
          idx
        );
        if (mesh !== node) {
          // Positions are in the child mesh's space; toSim(id) is for the node, so bake the child's local matrix in.
          const local = mesh.matrix.clone();
          const inner = sampler;
          sampler = {
            sample(type, r1, r2, r3, p, n) {
              inner.sample(type, r1, r2, r3, p, n);
              p.applyMatrix4(local);
              n.transformDirection(local);
            }
          };
        }
      }
    }
    this.samplers.set(id, sampler);
    return sampler;
  }

  private draw() {
    const tint = this.options.tint;
    for (const s of this.systems) {
      s.node.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
      const nodeScale = (Math.abs(tmpScale.x) + Math.abs(tmpScale.y) + Math.abs(tmpScale.z)) / 3;
      const simToWorld = s.desc.worldSpace ? tmpMatrix.identity() : s.node.matrixWorld;
      // Quads add their size in view space, so they always need the node's scale; mesh particles only in world space.
      const sizeScale =
        (s.renderer instanceof QuadParticles || s.desc.worldSpace ? nodeScale : 1) * this.options.sizeScale;
      s.renderer.update(s.sim, simToWorld, sizeScale, tint, 1);
    }
  }

  private applyTracks(time: number) {
    const desc = this.description;
    if (!desc) return;
    for (const material of this.materials.values()) material.resetUvs();
    for (const track of desc.tracks) {
      if (!track.times.length) continue;
      const t = controllerTime(track.ctl, time);
      sampleTrack(track, track.comps, t, sampled);
      for (const id of track.nodes) {
        const node = this.nodes.get(id);
        if (node) this.applyTrack(track, node, sampled);
      }
    }
  }

  private applyTrack(track: EffectTrack, node: Object3D, v: number[]) {
    switch (track.kind) {
      case 'translation':
        node.position.set(v[0], v[1], v[2]);
        return;
      case 'rotation':
        node.quaternion.set(v[0], v[1], v[2], v[3]).normalize();
        return;
      case 'euler':
        // Gamebryo's R = Rz * Ry * Rx is three.js's 'ZYX' order.
        node.rotation.set(v[0], v[1], v[2], 'ZYX');
        return;
      case 'scale':
        node.scale.setScalar(v[0]);
        return;
      case 'visible':
        node.visible = v[0] >= 0.5;
        return;
    }
    for (const mesh of meshesOf(node)) {
      const material = this.materials.get(mesh);
      if (!material) continue;
      switch (track.kind) {
        case 'alpha':
          material.opacityValue = v[0];
          break;
        case 'color':
          if (track.which) material.setColor(track.which, v);
          break;
        case 'uv': {
          const slot = slotName(track.slot);
          if (slot) material.setUvMember(slot, track.op ?? 0, v[0]);
          break;
        }
        case 'flip': {
          const slot = slotName(track.slot);
          const textures = track.textures ?? [];
          if (!slot || !textures.length) break;
          const uri = textures[Math.max(0, Math.floor(v[0])) % textures.length];
          if (uri) this.flip(material, slot, uri);
          break;
        }
      }
    }
  }

  private flip(material: EffectMaterial, slot: 'base' | 'glow' | 'detail', uri: string) {
    const url = this.resolveUri(uri);
    if (!url) return;
    const ready = this.flipFrames.get(url);
    if (ready) {
      if (material.getMap(slot) !== ready) material.setMap(slot, ready);
      return;
    }
    void loadEffectTexture(url).then((texture) => {
      if (!this.disposed) this.flipFrames.set(url, texture);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const undo of this.restore.reverse()) undo();
    this.restore.length = 0;
    this.materials.clear();
    this.systems.length = 0;
  }
}

function slotName(slot: number | 'shader' | undefined): 'base' | 'glow' | 'detail' | undefined {
  if (slot === SLOTS.base) return 'base';
  if (slot === SLOTS.glow) return 'glow';
  if (slot === SLOTS.detail) return 'detail';
  return undefined;
}

/** Whether a Material is one of the effect materials (for code that must leave them alone, like tinting). */
export function isEffectMaterial(material: unknown): material is EffectMaterial {
  return !!(material as { isEffectMaterial?: boolean } | null)?.isEffectMaterial;
}

/** Resolve texture URIs from a model's extras (relative to its GLB) against the URL it was loaded from. */
export function uriResolver(root: Object3D): (uri: string) => string | undefined {
  const href = root.userData.modelHref as string | undefined;
  if (!href) return () => undefined;
  const base = new URL(href, globalThis.location?.href ?? 'http://localhost/');
  return (uri) => {
    const url = new URL(uri, base);
    return url.origin === base.origin ? url.pathname : url.href;
  };
}
