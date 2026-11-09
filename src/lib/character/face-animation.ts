import { DataTexture, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader, type Object3D, type Texture } from 'three';
import { assetUrl } from '../assets/urls.js';
import { faceFrameAt, type FaceAnimations, type FaceExpression, type FaceFrame, type FaceSequence } from './expressions.js';
import { getTintInfo, isSkinMask, loadMask, setTintMask } from './tint.js';

const loader = new TextureLoader();
const textures = new Map<string, Promise<Texture>>();
const definitions = new Map<string, Promise<FaceAnimations>>();
const noMask = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
noMask.needsUpdate = true;

function loadBase(path: string): Promise<Texture> {
  let promise = textures.get(path);
  if (!promise) {
    promise = loader.loadAsync(assetUrl(path)).then((texture) => {
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      return texture;
    });
    textures.set(path, promise);
    void promise.catch(() => textures.delete(path));
  }
  return promise;
}

function loadDefinitions(gender: 0 | 1, itemId?: string): Promise<FaceAnimations> {
  const query = `gender=${gender}${itemId ? `&itemId=${itemId}` : ''}`;
  let promise = definitions.get(query);
  if (!promise) {
    promise = fetch(`/api/faces?${query}`).then(async (response) => {
      if (!response.ok) throw new Error(`Face animations: ${response.status}`);
      return await response.json() as FaceAnimations;
    });
    definitions.set(query, promise);
    void promise.catch(() => definitions.delete(query));
  }
  return promise;
}

interface FaceMaterial {
  material: MeshStandardMaterial;
  base: Texture;
  mask: Texture | undefined;
}

/** Owns no meshes: swaps the rig's per-instance face materials, leaving skin materials alone. */
export class FaceAnimator {
  private materials: FaceMaterial[] = [];
  private generation = 0;
  private key = '';
  private sequence: FaceSequence | null = null;
  private loaded = new Map<FaceFrame, { base: Texture; mask: Texture }>();
  private time = 0;
  private current: FaceFrame | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(private gender: 0 | 1) {}

  setTargets(roots: Object3D[]) {
    this.restore();
    this.generation++;
    this.key = '';
    this.sequence = null;
    this.loaded.clear();
    const seen = new Set<MeshStandardMaterial>();
    this.materials = [];
    for (const root of roots) root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial) || !material.map || seen.has(material)) continue;
        const maskUri = material.userData.ms2?.shader0 ?? '';
        if (isSkinMask(maskUri)) continue;
        seen.add(material);
        this.materials.push({ material, base: material.map, mask: getTintInfo(material)?.mask });
      }
    });
  }

  update(clip: string, seconds: number, expression?: FaceExpression, itemId?: string) {
    this.time = seconds;
    if (!this.materials.length) return;
    const key = JSON.stringify([clip.toLowerCase(), expression, itemId]);
    if (key !== this.key) {
      this.key = key;
      const generation = ++this.generation;
      this.restore();
      this.sequence = null;
      this.pending = this.load(clip, expression, itemId, generation).catch((cause) => {
        if (generation === this.generation) console.warn('Could not animate face', cause);
      });
    }
    this.apply();
  }

  private async load(clip: string, expression: FaceExpression | undefined, itemId: string | undefined, generation: number) {
    const data = await loadDefinitions(this.gender, itemId);
    const override = expression ? data.overrides[expression] : undefined;
    if (expression && !override) throw new Error(`Unsupported face expression: ${expression}`);
    const sequence = override ? { frames: [override], loopStart: null } : data.sequences[clip.toLowerCase()] ?? data.sequences.default;
    if (!sequence) return;
    const loaded = new Map<FaceFrame, { base: Texture; mask: Texture }>();
    await Promise.all(sequence.frames.map(async (frame) => {
      const [base, mask] = await Promise.all([loadBase(frame.base), frame.mask ? loadMask(assetUrl(frame.mask)) : noMask]);
      loaded.set(frame, { base, mask });
    }));
    if (generation !== this.generation) return;
    this.loaded = loaded;
    this.sequence = sequence;
    this.apply();
  }

  private apply() {
    const frame = this.sequence ? faceFrameAt(this.sequence, this.time) : undefined;
    if (!frame || frame === this.current) return;
    const textures = this.loaded.get(frame);
    if (!textures) return;
    for (const { material } of this.materials) {
      material.map = textures.base;
      setTintMask(material, textures.mask, frame.mask !== null);
    }
    this.current = frame;
  }

  private restore() {
    for (const { material, base, mask } of this.materials) {
      material.map = base;
      if (mask) setTintMask(material, mask);
    }
    this.current = undefined;
  }

  async ready() {
    await this.pending;
  }

  dispose() {
    this.generation++;
    this.restore();
    this.materials = [];
  }
}
