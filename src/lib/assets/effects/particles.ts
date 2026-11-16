import { Matrix4, Vector3 } from 'three';
import type { EmitterBase, EmitterDesc, ForceDesc, SystemDesc } from './types.js';
import { controllerTime, hashRandom, particleKeyTime, sampleParticleKeys, sampleScalar } from './timing.js';

/**
 * Gamebryo PS particle simulation (NiPSSimulator's general, forces, colliders and final steps) on the CPU.
 *
 * Particles live in "sim space": the world when the system is world-space, otherwise the particle system node's own
 * space. Positions and directions of emitters, forces and colliders come in through `SimSources` as object-to-sim
 * matrices each step. Randomness is a hash of the seed and each particle's birth index, so a run is reproducible.
 *
 * Units follow the converted data: distances in the model's units (cm), times in seconds. The exporter already turned
 * 3ds Max per-frame accelerations into per-second ones for gravity strength and bomb delta-v (they are 900 = 30^2
 * times round Max values); drag percentages and turbulence are still per frame at 30 fps and are converted here.
 */

const MAX_FPS = 30;

export interface MeshSampler {
  /** Fill `pos` and `normal` (object space) with a point on the mesh, using `r1`..`r3` in [0, 1). */
  sample(type: number, r1: number, r2: number, r3: number, pos: Vector3, normal: Vector3): void;
}

export interface SimSources {
  /** Object-to-sim matrix for an fx node (null: the particle system node). */
  toSim(id: number | null): Matrix4;
  mesh(id: number): MeshSampler | null;
}

/** Salts for the per-particle random numbers. */
const R = {
  pos1: 1,
  pos2: 2,
  pos3: 3,
  speed: 4,
  flip: 5,
  decl: 6,
  planar: 7,
  size: 8,
  life: 9,
  angle: 10,
  spin: 11,
  spinSign: 12,
  axis1: 13,
  axis2: 14,
  mesh: 15,
  frame: 16,
  frames: 17,
  perturb: 18
};

const tmpPos = new Vector3();
const tmpNormal = new Vector3();
const tmpDir = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();

/** Emitter values with controller overrides applied. */
type EmitterState = EmitterBase & { desc: EmitterDesc; accumulator: number; rate: number; active: boolean };

export class ParticleSimulation {
  readonly desc: SystemDesc;
  readonly capacity: number;
  count = 0;
  /** Sim-space positions and velocities. */
  readonly position: Float32Array;
  readonly velocity: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** Base radius at birth. */
  readonly radius: Float32Array;
  readonly angle: Float32Array;
  readonly spin: Float32Array;
  readonly axis: Float32Array;
  /** Per-particle random in [0, 1) for texture frames. */
  readonly random: Float32Array;
  readonly birth: Uint32Array;
  /** Outputs of `step`: current radius (size keys, grow and shrink) and colour. */
  readonly size: Float32Array;
  readonly color: Float32Array;

  private births = 0;
  private steps = 0;
  private readonly emitters: EmitterState[];
  private readonly forceActive = new Map<string, boolean>();
  private readonly gravityStrength = new Map<string, number>();
  private readonly colorOut = [1, 1, 1, 1];
  private readonly sizeOut = [1];

  constructor(
    desc: SystemDesc,
    readonly seed = 1,
    /** Multiplies every emission rate (an editor setting). */
    public emissionScale = 1
  ) {
    this.desc = desc;
    this.capacity = Math.max(1, Math.min(desc.maxParticles || 1, 4096));
    const n = this.capacity;
    this.position = new Float32Array(n * 3);
    this.velocity = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.radius = new Float32Array(n);
    this.angle = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.axis = new Float32Array(n * 3);
    this.random = new Float32Array(n);
    this.birth = new Uint32Array(n);
    this.size = new Float32Array(n);
    this.color = new Float32Array(n * 4);
    this.emitters = desc.emitters.map((e) => ({ ...e, desc: e, accumulator: 0, rate: 0, active: false }));
  }

  /** The longest a particle can live (for warming up and seeking). */
  get maxLife(): number {
    let max = 0;
    for (const e of this.emitters) max = Math.max(max, e.lifeSpan + Math.abs(e.lifeSpanVar) / 2);
    return max;
  }

  reset() {
    this.count = 0;
    this.births = 0;
    this.steps = 0;
    for (const e of this.emitters) e.accumulator = 0;
  }

  /** Advance by `dt` seconds; `time` is the effect time at the end of the step (drives the controllers). */
  step(dt: number, time: number, sources: SimSources) {
    if (dt <= 0) return;
    this.steps++;
    this.applyControllers(time);
    this.emit(dt, sources);
    this.applyForces(dt, sources);
    this.integrate(dt, sources);
    this.updateAppearance();
  }

  private applyControllers(time: number) {
    for (const e of this.emitters) {
      e.rate = 0;
      e.active = false;
    }
    this.forceActive.clear();
    this.gravityStrength.clear();
    for (const c of this.desc.controllers) {
      const t = controllerTime(c.ctl, time);
      switch (c.kind) {
        case 'emit':
          for (const e of this.emitters) {
            if (e.name !== c.emitter) continue;
            e.rate = c.rate && c.rate.times.length ? sampleScalar(c.rate, t) : 0;
            e.active = c.active && c.active.times.length ? sampleScalar(c.active, t) >= 0.5 : true;
          }
          break;
        case 'forceActive':
          if (c.track?.times.length) this.forceActive.set(c.force, sampleScalar(c.track, t) >= 0.5);
          break;
        case 'gravityStrength':
          if (c.track?.times.length) this.gravityStrength.set(c.force, sampleScalar(c.track, t));
          break;
        case 'emitterFloat':
          if (!c.track?.times.length) break;
          for (const e of this.emitters)
            if (e.name === c.emitter) (e as unknown as Record<string, number>)[c.field] = sampleScalar(c.track, t);
          break;
        default:
          break;
      }
    }
  }

  private emit(dt: number, sources: SimSources) {
    for (const e of this.emitters) {
      if (!e.active || e.rate <= 0) continue;
      e.accumulator += e.rate * this.emissionScale * dt;
      const n = Math.floor(e.accumulator);
      e.accumulator -= n;
      for (let k = 0; k < n && this.count < this.capacity; k++) {
        // Spread the births over the step so a burst does not start as one clump: a particle born `a` seconds
        // before the end of the step starts `dt - a` behind, and the step's integration brings it to age `a`.
        this.spawn(e, sources, dt * ((k + 0.5) / n) - dt);
      }
    }
  }

  /** Add a particle; `age` (at most 0) is how long before the current step's integration it was born. */
  private spawn(e: EmitterState, sources: SimSources, age: number) {
    const index = this.births++;
    const rnd = (salt: number) => hashRandom(this.seed, index, salt);
    const sym = (salt: number) => rnd(salt) * 2 - 1;
    const i = this.count++;
    const desc = e.desc;

    // Initial position and direction in the emitter object's space.
    let dirFromNormal = false;
    tmpPos.set(0, 0, 0);
    tmpNormal.set(0, 0, 1);
    switch (desc.kind) {
      case 'box':
        tmpPos.set(sym(R.pos1) * desc.width * 0.5, sym(R.pos2) * desc.height * 0.5, sym(R.pos3) * desc.depth * 0.5);
        break;
      case 'sphere': {
        randomUnit(rnd(R.pos1), rnd(R.pos2), tmpPos);
        tmpPos.multiplyScalar(desc.radius * Math.cbrt(rnd(R.pos3)));
        break;
      }
      case 'cylinder': {
        const a = rnd(R.pos1) * Math.PI * 2;
        const r = desc.radius * Math.sqrt(rnd(R.pos2));
        tmpPos.set(Math.cos(a) * r, Math.sin(a) * r, sym(R.pos3) * desc.height * 0.5);
        break;
      }
      case 'torus': {
        const a = rnd(R.pos1) * Math.PI * 2;
        const b = rnd(R.pos2) * Math.PI * 2;
        const s = desc.sectionRadius * Math.sqrt(rnd(R.pos3));
        const ring = desc.radius + Math.cos(b) * s;
        tmpPos.set(Math.cos(a) * ring, Math.sin(a) * ring, Math.sin(b) * s);
        break;
      }
      case 'mesh': {
        const meshId = desc.meshes.length ? desc.meshes[Math.floor(rnd(R.mesh) * desc.meshes.length)] : undefined;
        const sampler = meshId === undefined ? null : sources.mesh(meshId);
        if (sampler) {
          sampler.sample(desc.emissionType, rnd(R.pos1), rnd(R.pos2), rnd(R.pos3), tmpPos, tmpNormal);
          // Mesh positions are in the mesh's own space: move them into sim space directly.
          const toSim = sources.toSim(meshId!);
          tmpPos.applyMatrix4(toSim);
          tmpNormal.transformDirection(toSim);
          dirFromNormal = desc.velocityType === 0;
          if (desc.velocityType === 1) randomUnit(rnd(R.decl), rnd(R.planar), tmpNormal);
        }
        break;
      }
    }

    const declination = e.declination + e.declinationVar * sym(R.decl);
    const planar = e.planarAngle + e.planarAngleVar * sym(R.planar);
    if (desc.kind === 'mesh' && dirFromNormal) {
      tmpDir.copy(tmpNormal);
      if (e.declinationVar) perturb(tmpDir, e.declinationVar * rnd(R.perturb), planar);
    } else if (desc.kind === 'mesh' && desc.velocityType === 1) {
      tmpDir.copy(tmpNormal);
    } else {
      const s = Math.sin(declination);
      tmpDir.set(s * Math.cos(planar), s * Math.sin(planar), Math.cos(declination));
    }
    if (desc.kind !== 'mesh') {
      const toSim = sources.toSim(desc.object);
      tmpPos.applyMatrix4(toSim);
      tmpDir.transformDirection(toSim);
    } else if (!dirFromNormal && desc.velocityType !== 1) {
      tmpDir.transformDirection(sources.toSim(desc.object));
    }

    let speed = e.speed + e.speedVar * (rnd(R.speed) - 0.5);
    if (e.speedFlipRatio > 0 && rnd(R.flip) < e.speedFlipRatio) speed = -speed;

    const p = i * 3;
    this.position[p] = tmpPos.x + tmpDir.x * speed * age;
    this.position[p + 1] = tmpPos.y + tmpDir.y * speed * age;
    this.position[p + 2] = tmpPos.z + tmpDir.z * speed * age;
    this.velocity[p] = tmpDir.x * speed;
    this.velocity[p + 1] = tmpDir.y * speed;
    this.velocity[p + 2] = tmpDir.z * speed;
    this.radius[i] = Math.max(0, e.size + e.sizeVar * (rnd(R.size) - 0.5));
    this.life[i] = Math.max(1e-3, e.lifeSpan + e.lifeSpanVar * (rnd(R.life) - 0.5));
    this.age[i] = age;
    this.angle[i] = this.desc.hasRotations ? e.rotationAngle + e.rotationAngleVar * sym(R.angle) : 0;
    let spin = e.rotationSpeed + e.rotationSpeedVar * sym(R.spin);
    if (e.randomRotSpeedSign && rnd(R.spinSign) < 0.5) spin = -spin;
    this.spin[i] = this.desc.hasRotations ? spin : 0;
    if (e.randomRotAxis) randomUnit(rnd(R.axis1), rnd(R.axis2), tmpA);
    else tmpA.fromArray(e.rotationAxis).normalize();
    tmpA.toArray(this.axis, p);
    this.random[i] = rnd(R.frame);
    this.birth[i] = index;
  }

  private applyForces(dt: number, sources: SimSources) {
    for (const force of this.desc.forces) {
      const active = this.forceActive.get(force.name) ?? force.active;
      if (!active) continue;
      this.applyForce(force, dt, sources);
    }
  }

  private applyForce(force: ForceDesc, dt: number, sources: SimSources) {
    const toSim = sources.toSim(force.object);
    const origin = tmpB.setFromMatrixPosition(toSim);
    const axis = tmpA.fromArray(force.axis).transformDirection(toSim);
    const pos = this.position;
    const vel = this.velocity;
    switch (force.kind) {
      case 'drag': {
        // Damping per 30 fps frame, along the axis (the game uses one drag force per axis).
        const keep = Math.pow(Math.max(0, 1 - Math.min(1, force.percentage)), dt * MAX_FPS);
        const ranged = force.range < 1e30;
        for (let i = 0; i < this.count; i++) {
          const p = i * 3;
          let k = 1 - keep;
          if (ranged) {
            const d = Math.hypot(pos[p] - origin.x, pos[p + 1] - origin.y, pos[p + 2] - origin.z);
            if (d > force.range) {
              const fall = force.rangeFalloff - force.range;
              k *= fall > 0 ? Math.max(0, 1 - (d - force.range) / fall) : 0;
            }
          }
          const along = vel[p] * axis.x + vel[p + 1] * axis.y + vel[p + 2] * axis.z;
          vel[p] -= axis.x * along * k;
          vel[p + 1] -= axis.y * along * k;
          vel[p + 2] -= axis.z * along * k;
        }
        break;
      }
      case 'gravity': {
        const strength = this.gravityStrength.get(force.name) ?? force.strength;
        const turbulence = force.turbulence * force.turbulenceScale * MAX_FPS * MAX_FPS;
        for (let i = 0; i < this.count; i++) {
          const p = i * 3;
          let gx = axis.x,
            gy = axis.y,
            gz = axis.z,
            scale = strength;
          if (force.gravityType === 1) {
            gx = origin.x - pos[p];
            gy = origin.y - pos[p + 1];
            gz = origin.z - pos[p + 2];
            const d = Math.hypot(gx, gy, gz) || 1;
            gx /= d;
            gy /= d;
            gz /= d;
            if (force.decay > 0) scale *= Math.exp(-force.decay * d);
          }
          vel[p] += gx * scale * dt;
          vel[p + 1] += gy * scale * dt;
          vel[p + 2] += gz * scale * dt;
          if (turbulence) {
            const salt = this.steps * 7;
            vel[p] += (hashRandom(this.seed, this.birth[i], 100 + salt) * 2 - 1) * turbulence * dt;
            vel[p + 1] += (hashRandom(this.seed, this.birth[i], 101 + salt) * 2 - 1) * turbulence * dt;
            vel[p + 2] += (hashRandom(this.seed, this.birth[i], 102 + salt) * 2 - 1) * turbulence * dt;
          }
        }
        break;
      }
      case 'bomb': {
        for (let i = 0; i < this.count; i++) {
          const p = i * 3;
          tmpC.set(pos[p] - origin.x, pos[p + 1] - origin.y, pos[p + 2] - origin.z);
          if (force.symmetryType === 1) tmpC.addScaledVector(axis, -tmpC.dot(axis));
          else if (force.symmetryType === 2) tmpC.copy(axis).multiplyScalar(Math.sign(tmpC.dot(axis)) || 1);
          const d = tmpC.length();
          if (d < 1e-6) continue;
          let f = 1;
          if (force.decayType === 1) f = force.decay > 0 ? Math.max(0, 1 - d / force.decay) : 0;
          else if (force.decayType === 2) f = force.decay > 0 ? Math.exp(-d / force.decay) : 0;
          const k = (force.deltaV * f * dt) / d;
          vel[p] += tmpC.x * k;
          vel[p + 1] += tmpC.y * k;
          vel[p + 2] += tmpC.z * k;
        }
        break;
      }
    }
  }

  private integrate(dt: number, sources: SimSources) {
    const pos = this.position;
    const vel = this.velocity;
    for (let i = 0; i < this.count; i++) {
      const p = i * 3;
      pos[p] += vel[p] * dt;
      pos[p + 1] += vel[p + 1] * dt;
      pos[p + 2] += vel[p + 2] * dt;
      this.age[i] += dt;
      this.angle[i] += this.spin[i] * dt;
    }
    for (const c of this.desc.colliders) if (c.active) this.collide(c, sources);
    // Remove the dead by moving the last particle into their slot.
    for (let i = 0; i < this.count;) {
      if (this.age[i] < this.life[i]) {
        i++;
        continue;
      }
      this.move(--this.count, i);
    }
  }

  private collide(c: SystemDesc['colliders'][number], sources: SimSources) {
    const toSim = sources.toSim(c.object);
    const origin = tmpB.setFromMatrixPosition(toSim);
    const pos = this.position;
    const vel = this.velocity;
    if (c.kind === 'planar') {
      const x = tmpA.fromArray(c.xAxis).transformDirection(toSim);
      const y = tmpC.fromArray(c.yAxis).transformDirection(toSim);
      const n = tmpNormal.crossVectors(x, y).normalize();
      for (let i = 0; i < this.count; i++) {
        const p = i * 3;
        tmpPos.set(pos[p] - origin.x, pos[p + 1] - origin.y, pos[p + 2] - origin.z);
        const dist = tmpPos.dot(n);
        const vn = vel[p] * n.x + vel[p + 1] * n.y + vel[p + 2] * n.z;
        if (dist >= 0 || vn >= 0) continue;
        if (Math.abs(tmpPos.dot(x)) > c.width / 2 || Math.abs(tmpPos.dot(y)) > c.height / 2) continue;
        if (c.dieOnCollide) {
          this.age[i] = this.life[i];
          continue;
        }
        pos[p] -= n.x * dist;
        pos[p + 1] -= n.y * dist;
        pos[p + 2] -= n.z * dist;
        const k = (1 + c.bounce) * vn;
        vel[p] -= n.x * k;
        vel[p + 1] -= n.y * k;
        vel[p + 2] -= n.z * k;
      }
    } else {
      for (let i = 0; i < this.count; i++) {
        const p = i * 3;
        tmpPos.set(pos[p] - origin.x, pos[p + 1] - origin.y, pos[p + 2] - origin.z);
        const d = tmpPos.length();
        if (d >= c.radius || d < 1e-6) continue;
        if (c.dieOnCollide) {
          this.age[i] = this.life[i];
          continue;
        }
        tmpPos.divideScalar(d);
        const vn = vel[p] * tmpPos.x + vel[p + 1] * tmpPos.y + vel[p + 2] * tmpPos.z;
        if (vn < 0) {
          const k = (1 + c.bounce) * vn;
          vel[p] -= tmpPos.x * k;
          vel[p + 1] -= tmpPos.y * k;
          vel[p + 2] -= tmpPos.z * k;
        }
      }
    }
  }

  private move(from: number, to: number) {
    if (from === to) return;
    const f3 = from * 3,
      t3 = to * 3;
    for (let c = 0; c < 3; c++) {
      this.position[t3 + c] = this.position[f3 + c];
      this.velocity[t3 + c] = this.velocity[f3 + c];
      this.axis[t3 + c] = this.axis[f3 + c];
    }
    this.age[to] = this.age[from];
    this.life[to] = this.life[from];
    this.radius[to] = this.radius[from];
    this.angle[to] = this.angle[from];
    this.spin[to] = this.spin[from];
    this.random[to] = this.random[from];
    this.birth[to] = this.birth[from];
  }

  /** Size and colour from the general step's keys, grow and shrink times. */
  private updateAppearance() {
    const g = this.desc.general;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i];
      const life = this.life[i];
      let size = this.radius[i];
      if (g) {
        if (g.sizeKeys.length)
          size *= sampleParticleKeys(g.sizeKeys, particleKeyTime(g.sizeKeys, g.sizeLoop, age, life), this.sizeOut)[0];
        if (g.growTime > 0 && g.growGeneration === 0) size *= Math.min(1, age / g.growTime);
        if (g.shrinkTime > 0 && g.shrinkGeneration === 0) size *= Math.min(1, Math.max(0, life - age) / g.shrinkTime);
      }
      this.size[i] = size;
      const c = i * 4;
      if (g && this.desc.hasColors && g.colorKeys.length) {
        sampleParticleKeys(g.colorKeys, particleKeyTime(g.colorKeys, g.colorLoop, age, life), this.colorOut);
        this.color[c] = this.colorOut[0];
        this.color[c + 1] = this.colorOut[1];
        this.color[c + 2] = this.colorOut[2];
        this.color[c + 3] = this.colorOut[3];
      } else {
        this.color[c] = this.color[c + 1] = this.color[c + 2] = this.color[c + 3] = 1;
      }
    }
  }
}

/** Uniform random direction from two numbers in [0, 1). */
function randomUnit(u: number, v: number, out: Vector3) {
  const z = u * 2 - 1;
  const a = v * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(r * Math.cos(a), r * Math.sin(a), z);
}

/** Tilt a unit direction by `angle` radians, around an axis at `around` radians in its perpendicular plane. */
function perturb(dir: Vector3, angle: number, around: number) {
  const helper = Math.abs(dir.z) < 0.9 ? tmpB.set(0, 0, 1) : tmpB.set(1, 0, 0);
  const u = tmpC.crossVectors(dir, helper).normalize();
  const w = tmpA.crossVectors(dir, u);
  const side = u.multiplyScalar(Math.cos(around)).addScaledVector(w, Math.sin(around));
  dir.multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).normalize();
}

/** Samples points on a triangle mesh (positions, normals, index), area-weighted for surface emission. */
export class TriangleMeshSampler implements MeshSampler {
  private readonly cdf: Float32Array;
  private readonly total: number;

  constructor(
    private readonly positions: ArrayLike<number>,
    private readonly normals: ArrayLike<number> | null,
    private readonly index: ArrayLike<number>
  ) {
    const tris = Math.floor(index.length / 3);
    this.cdf = new Float32Array(tris);
    let sum = 0;
    for (let t = 0; t < tris; t++) {
      this.vertex(index[t * 3], tmpA);
      this.vertex(index[t * 3 + 1], tmpB);
      this.vertex(index[t * 3 + 2], tmpC);
      sum += tmpB.sub(tmpA).cross(tmpC.sub(tmpA)).length() / 2;
      this.cdf[t] = sum;
    }
    this.total = sum;
  }

  private vertex(i: number, out: Vector3) {
    return out.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
  }

  private normal(i: number, out: Vector3) {
    if (!this.normals) return out.set(0, 0, 1);
    return out.set(this.normals[i * 3], this.normals[i * 3 + 1], this.normals[i * 3 + 2]);
  }

  private triangle(r: number): number {
    const target = r * this.total;
    let lo = 0,
      hi = this.cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  sample(type: number, r1: number, r2: number, r3: number, pos: Vector3, normal: Vector3) {
    const tris = this.cdf.length;
    if (!tris) {
      const n = Math.floor(this.positions.length / 3);
      if (!n) return void pos.set(0, 0, 0);
      const v = Math.min(n - 1, Math.floor(r1 * n));
      this.vertex(v, pos);
      this.normal(v, normal);
      return;
    }
    if (type === 0) {
      // A vertex.
      const v = this.index[Math.min(this.index.length - 1, Math.floor(r1 * this.index.length))];
      this.vertex(v, pos);
      this.normal(v, normal).normalize();
      return;
    }
    const t = type === 3 ? this.triangle(r1) : Math.min(tris - 1, Math.floor(r1 * tris));
    const ia = this.index[t * 3],
      ib = this.index[t * 3 + 1],
      ic = this.index[t * 3 + 2];
    const a = this.vertex(ia, new Vector3());
    const b = this.vertex(ib, new Vector3());
    const c = this.vertex(ic, new Vector3());
    let wa: number, wb: number, wc: number;
    if (type === 1) [wa, wb, wc] = [1 / 3, 1 / 3, 1 / 3];
    else if (type === 2 || type === 4) {
      // An edge: its centre (2) or a point along it (4).
      const edge = Math.floor(r2 * 3) % 3;
      const f = type === 2 ? 0.5 : r3;
      [wa, wb, wc] = edge === 0 ? [1 - f, f, 0] : edge === 1 ? [0, 1 - f, f] : [f, 0, 1 - f];
    } else {
      let u = r2,
        v = r3;
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      [wa, wb, wc] = [1 - u - v, u, v];
    }
    pos.set(0, 0, 0).addScaledVector(a, wa).addScaledVector(b, wb).addScaledVector(c, wc);
    if (this.normals) {
      const na = this.normal(ia, new Vector3()),
        nb = this.normal(ib, new Vector3()),
        nc = this.normal(ic, new Vector3());
      normal.set(0, 0, 0).addScaledVector(na, wa).addScaledVector(nb, wb).addScaledVector(nc, wc).normalize();
    } else normal.subVectors(b, a).cross(c.sub(a)).normalize();
  }
}
