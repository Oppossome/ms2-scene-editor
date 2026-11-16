import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture
} from 'three';
import { AMBIENT_LIGHT, DIFFUSE_LIGHT, applyRenderState, gammaColor, isAdditive } from './materials.js';
import type { ParticleSimulation } from './particles.js';
import { AlignMethod, type AlignedGenerator, type RenderState, type SystemDesc } from './types.js';

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec2 corner;
attribute vec3 iPosition;
attribute vec3 iVelocity;
attribute vec3 iAxis;
attribute vec4 iColor;
attribute vec2 iSizeAngle;
attribute vec4 iUvRect;
uniform float sizeScale;
uniform int normalMethod;
uniform int upMethod;
uniform vec3 normalDirection;
uniform vec3 upDirection;
uniform vec2 quadScale;
uniform vec2 quadCenter;
varying vec2 vUv;
varying vec4 vColor;

// A direction in view space for an AlignMethod (Camera gives the fallback).
vec3 alignDirection(int method, vec3 fixedDir, vec3 fallback) {
  vec3 d;
  if (method == ${AlignMethod.PerParticle}) d = iAxis;
  else if (method == ${AlignMethod.LocalFixed}) d = fixedDir;
  else if (method == ${AlignMethod.LocalPosition}) d = iPosition;
  else if (method == ${AlignMethod.LocalVelocity}) d = iVelocity;
  else return fallback;
  d = mat3(modelViewMatrix) * d;
  float l = length(d);
  return l > 1e-5 ? d / l : fallback;
}

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPosition, 1.0);
  vec3 toCamera = normalize(-mvPosition.xyz);
  vec3 n = alignDirection(normalMethod, normalDirection, toCamera);
  vec3 up = alignDirection(upMethod, upDirection, vec3(0.0, 1.0, 0.0));
  vec3 right = cross(up, n);
  float rl = length(right);
  right = rl > 1e-4 ? right / rl : normalize(cross(abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
  up = cross(n, right);
  float c = cos(iSizeAngle.y);
  float s = sin(iSizeAngle.y);
  vec2 k = (corner - quadCenter) * quadScale;
  k = vec2(c * k.x - s * k.y, s * k.x + c * k.y);
  mvPosition.xyz += (right * k.x + up * k.y) * iSizeAngle.x * sizeScale;
  gl_Position = projectionMatrix * mvPosition;
  vec2 uv = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  vUv = iUvRect.xy + uv * iUvRect.zw;
  vColor = iColor;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 litColor;
uniform vec3 emissive;
uniform float vertexLight;
uniform float colorBoost;
uniform int vertexMode;
uniform vec3 tint;
uniform float opacity;
uniform float alphaCut;
#ifdef USE_MAP
uniform sampler2D map;
#endif
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 texel = vec4(1.0);
  #ifdef USE_MAP
  texel = texture2D(map, vUv);
  #endif
  // A particle's colour is its vertex colour: it stands in for the emissive (1) or the ambient and diffuse (2)
  // colours, or is ignored (0), as the system's NiVertexColorProperty says. Its alpha always fades the particle.
  vec3 lit = litColor;
  vec3 emi = emissive;
  if (vertexMode == 1) emi = vColor.rgb * colorBoost;
  else if (vertexMode == 2) lit = vColor.rgb * vertexLight;
  vec4 outColor = vec4(texel.rgb * (lit + emi) * tint, texel.a * opacity * vColor.a);
  if (outColor.a <= alphaCut) discard;
  gl_FragColor = outColor;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const INDEX = [0, 1, 2, 0, 2, 3];

/** Material colours of a particle system: the lit part (diffuse and ambient at the nominal light) and emissive. */
function particleColors(state: RenderState) {
  const e = state.emissive ?? [0, 0, 0];
  const d = state.diffuse ?? [0, 0, 0];
  const a = state.ambient ?? [0, 0, 0];
  const boost = state.colorBoost ?? 1;
  const lighting = state.lighting === 'emissive' ? 0 : 1;
  return {
    lit: gammaColor([0, 1, 2].map((i) => (d[i] * DIFFUSE_LIGHT + a[i] * AMBIENT_LIGHT) * boost * lighting)),
    emissive: gammaColor(e.map((v) => v * boost)),
    vertexLight: (DIFFUSE_LIGHT + AMBIENT_LIGHT) * boost * lighting,
    colorBoost: boost,
    // Particle systems without a vertex colour property still show their colour keys.
    vertexMode: { ignore: 0, emissive: 1, ambientDiffuse: 2 }[state.vertexColors ?? 'ambientDiffuse']
  };
}

/** sRGB (gamma) to linear for one channel, matching three.js. */
function toLinear(c: number) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

export interface ParticleRenderer {
  readonly object: Object3D;
  /** Copy the simulation into the GPU buffers; `simToWorld` places sim space in the world. */
  update(sim: ParticleSimulation, simToWorld: Matrix4, sizeScale: number, tint: Color, opacityScale: number): void;
  dispose(): void;
}

/** Camera-facing or aligned quads for a sprite particle system. */
export class QuadParticles implements ParticleRenderer {
  readonly object: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly baseOpacity: number;
  private readonly attributes: Record<string, InstancedBufferAttribute>;
  private readonly generator: SystemDesc['generator'];

  constructor(
    private readonly desc: SystemDesc,
    state: RenderState,
    map: Texture | null
  ) {
    const n = Math.max(1, Math.min(desc.maxParticles || 1, 4096));
    this.generator = desc.generator;
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('corner', new BufferAttribute(CORNERS, 2));
    geometry.setIndex(INDEX);
    const attr = (size: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.attributes = {
      iPosition: attr(3),
      iVelocity: attr(3),
      iAxis: attr(3),
      iColor: attr(4),
      iSizeAngle: attr(2),
      iUvRect: attr(4)
    };
    for (const [name, a] of Object.entries(this.attributes)) geometry.setAttribute(name, a);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    const aligned = desc.generator.kind === 'aligned';
    const g = desc.generator as AlignedGenerator;
    const colors = particleColors(state);
    this.baseOpacity = state.alpha ?? 1;
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          litColor: { value: colors.lit },
          emissive: { value: colors.emissive },
          vertexLight: { value: colors.vertexLight },
          colorBoost: { value: colors.colorBoost },
          vertexMode: { value: colors.vertexMode },
          tint: { value: new Color(1, 1, 1) },
          opacity: { value: this.baseOpacity },
          alphaCut: { value: 0 },
          map: { value: map },
          sizeScale: { value: 1 },
          normalMethod: { value: aligned ? desc.normalMethod : AlignMethod.Camera },
          upMethod: { value: aligned ? desc.upMethod : AlignMethod.Camera },
          normalDirection: { value: new Vector3().fromArray(desc.normalDirection) },
          upDirection: { value: new Vector3().fromArray(desc.upDirection) },
          // Aligned quads keep their rest scale; stretching by speed is not modelled.
          quadScale: { value: aligned ? [g.scaleRestU || 1, g.scaleRestV || 1] : [1, 1] },
          quadCenter: { value: aligned ? [g.centerU, g.centerV] : [0, 0] }
        }
      ]),
      vertexShader,
      fragmentShader,
      fog: true,
      defines: map ? { USE_MAP: '' } : {}
    });
    applyRenderState(this.material, state);
    if (!state.blend) {
      // Sprites always blend in the game; a material without a blend state uses plain alpha.
      this.material.transparent = true;
      this.material.depthWrite = false;
    }
    this.material.uniforms.alphaCut.value = this.material.alphaTest;
    this.material.alphaTest = 0;
    this.material.toneMapped = !isAdditive(state);
    this.object = new Mesh(geometry, this.material);
    this.object.name = `${desc.name || 'particles'} (particles)`;
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.matrixWorldAutoUpdate = false;
    this.object.raycast = () => {};
    this.object.userData.effectParticles = true;
  }

  update(sim: ParticleSimulation, simToWorld: Matrix4, sizeScale: number, tint: Color, opacityScale: number) {
    const count = sim.count;
    const a = this.attributes;
    const pos = a.iPosition.array as Float32Array;
    const vel = a.iVelocity.array as Float32Array;
    const axis = a.iAxis.array as Float32Array;
    const col = a.iColor.array as Float32Array;
    const sa = a.iSizeAngle.array as Float32Array;
    const uv = a.iUvRect.array as Float32Array;
    pos.set(sim.position.subarray(0, count * 3));
    vel.set(sim.velocity.subarray(0, count * 3));
    axis.set(sim.axis.subarray(0, count * 3));
    for (let i = 0; i < count; i++) {
      const c = i * 4;
      col[c] = toLinear(sim.color[c]);
      col[c + 1] = toLinear(sim.color[c + 1]);
      col[c + 2] = toLinear(sim.color[c + 2]);
      col[c + 3] = sim.color[c + 3];
      sa[i * 2] = sim.size[i];
      sa[i * 2 + 1] = sim.angle[i];
      this.frame(sim, i, uv);
    }
    for (const attribute of Object.values(a)) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    this.geometry.instanceCount = count;
    this.material.uniforms.sizeScale.value = sizeScale;
    (this.material.uniforms.tint.value as Color).copy(tint);
    this.material.uniforms.opacity.value = this.baseOpacity * opacityScale;
    this.object.matrixWorld.copy(simToWorld);
  }

  /** Texture rectangle of a particle's flip-book frame (aligned quads with animated textures). */
  private frame(sim: ParticleSimulation, i: number, out: Float32Array) {
    const o = i * 4;
    const g = this.generator;
    if (g.kind !== 'aligned' || !this.desc.hasAnimatedTextures || g.framesAcross * g.framesDown <= 1) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 1;
      out[o + 3] = 1;
      return;
    }
    const total = g.framesAcross * g.framesDown;
    const r = sim.random[i];
    const start = Math.floor(g.initialFrame + r * g.initialFrameVar);
    const frames = Math.max(0, g.numFrames + Math.floor(r * g.numFramesVar));
    const span = g.finalTime - g.initialTime;
    const u = span > 0 ? Math.min(1, Math.max(0, (sim.age[i] / sim.life[i] - g.initialTime) / span)) : 0;
    let step = Math.min(frames - 1, Math.floor(u * frames));
    if (step < 0) step = 0;
    if (g.pingPong && frames > 1) {
      const period = 2 * (frames - 1);
      step %= period;
      if (step >= frames) step = period - step;
    }
    const f = (((start + step) % total) + total) % total;
    out[o] = (f % g.framesAcross) / g.framesAcross;
    out[o + 1] = Math.floor(f / g.framesAcross) / g.framesDown;
    out[o + 2] = 1 / g.framesAcross;
    out[o + 3] = 1 / g.framesDown;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpAxis = new Vector3();
const tmpPos = new Vector3();
const tmpScale = new Vector3();
const tmpColor = new Color();

/** Mesh particles: each particle draws copies of the system's master meshes. */
export class MeshParticles implements ParticleRenderer {
  readonly object = new Object3D();
  private readonly meshes: InstancedMesh[] = [];

  constructor(desc: SystemDesc, masters: Mesh[]) {
    const n = Math.max(1, Math.min(desc.maxParticles || 1, 4096));
    this.object.name = `${desc.name || 'particles'} (mesh particles)`;
    this.object.matrixAutoUpdate = false;
    this.object.matrixWorldAutoUpdate = false;
    for (const master of masters) {
      const mesh = new InstancedMesh(master.geometry as BufferGeometry, master.material as Material, n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.raycast = () => {};
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      // Master meshes keep their own transform inside the particle.
      mesh.userData.masterMatrix = master.matrix.clone();
      this.meshes.push(mesh);
      this.object.add(mesh);
    }
  }

  update(sim: ParticleSimulation, simToWorld: Matrix4, sizeScale: number, tint: Color) {
    for (const mesh of this.meshes) {
      const master = mesh.userData.masterMatrix as Matrix4;
      for (let i = 0; i < sim.count; i++) {
        tmpPos.fromArray(sim.position, i * 3);
        tmpAxis.fromArray(sim.axis, i * 3);
        if (tmpAxis.lengthSq() < 1e-8) tmpAxis.set(0, 0, 1);
        tmpQuat.setFromAxisAngle(tmpAxis.normalize(), sim.angle[i]);
        const s = sim.size[i] * sizeScale;
        tmpScale.set(s, s, s);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale).multiply(master);
        mesh.setMatrixAt(i, tmpMatrix);
        tmpColor.setRGB(sim.color[i * 4], sim.color[i * 4 + 1], sim.color[i * 4 + 2]).multiply(tint);
        mesh.setColorAt(i, tmpColor);
      }
      mesh.count = sim.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.matrixWorld.copy(simToWorld);
    }
  }

  dispose() {
    for (const mesh of this.meshes) mesh.dispose();
  }
}
