import { Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type Mesh } from 'three';
import { loadModel } from '../assets/loader.js';
import type { MapData } from '../types.js';

const DEG = Math.PI / 180;
/** Gamebryo is Z-up, the converted models are Y-up: this is the rotation of their "zup_to_yup" root node. */
const ZUP_TO_YUP = new Matrix4().makeRotationX(-Math.PI / 2);
const YUP_TO_ZUP = ZUP_TO_YUP.clone().invert();

/**
 * Placement of a map entity in Y-up world space, ready to multiply with a model-local transform.
 * Item layout: [model, x, y, z, rotX, rotY, rotZ (degrees), scaleX, scaleY, scaleZ] in Z-up game space.
 * Rotation order is Rz * Ry * Rx (extrinsic X, then Y, then Z).
 */
export function entityMatrix(item: number[], out = new Matrix4()): Matrix4 {
  const rotation = new Quaternion().setFromEuler(new Euler(item[4] * DEG, item[5] * DEG, item[6] * DEG, 'ZYX'));
  const placement = new Matrix4().compose(
    new Vector3(item[1], item[2], item[3]),
    rotation,
    new Vector3(item[7], item[8], item[9])
  );
  // world = ZUP_TO_YUP * placement * YUP_TO_ZUP, so that (ZUP_TO_YUP * modelNodes) stays the model's own Y-up pose.
  return out.copy(ZUP_TO_YUP).multiply(placement).multiply(YUP_TO_ZUP);
}

export interface MapProgress {
  modelsLoaded: number;
  modelsTotal: number;
  instances: number;
  failed: number;
}

export interface BuiltMap {
  group: Group;
  /** Resolves when every model has finished loading (or failed). */
  done: Promise<void>;
  /** Release the per-instance buffers (geometry and textures are shared with the model cache). */
  dispose(): void;
}

/**
 * Draw a map's props with one InstancedMesh per mesh of each distinct model.
 * Models load concurrently and appear as soon as they are ready.
 */
export function buildMap(
  data: MapData,
  options: { concurrency?: number; onProgress?: (p: MapProgress) => void; cancelled?: () => boolean } = {}
): BuiltMap {
  const { concurrency = 6, onProgress, cancelled } = options;
  const group = new Group();
  const meshes: InstancedMesh[] = [];

  const placements: number[][][] = data.models.map(() => []);
  for (const item of data.items) placements[item[0]]?.push(item);

  const progress: MapProgress = { modelsLoaded: 0, modelsTotal: data.models.length, instances: 0, failed: 0 };
  let next = 0;

  async function worker() {
    while (next < data.models.length && !cancelled?.()) {
      const index = next++;
      const items = placements[index];
      try {
        const model = await loadModel(data.models[index]);
        if (cancelled?.()) return;
        model.scene.updateMatrixWorld(true);
        const parts: Mesh[] = [];
        model.scene.traverse((o) => {
          const mesh = o as Mesh;
          if (mesh.isMesh && !(mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) parts.push(mesh);
        });
        const matrix = new Matrix4();
        for (const part of parts) {
          const instanced = new InstancedMesh(part.geometry, part.material, items.length);
          items.forEach((item, i) =>
            instanced.setMatrixAt(i, matrix.multiplyMatrices(entityMatrix(item), part.matrixWorld))
          );
          instanced.instanceMatrix.needsUpdate = true;
          instanced.computeBoundingSphere();
          instanced.computeBoundingBox();
          meshes.push(instanced);
          group.add(instanced);
        }
        progress.instances += items.length;
      } catch (e) {
        progress.failed++;
        console.warn(`Map model failed: ${data.models[index]}`, e);
      }
      progress.modelsLoaded++;
      onProgress?.({ ...progress });
    }
  }

  const done = Promise.all(Array.from({ length: Math.min(concurrency, data.models.length) }, worker)).then(
    () => undefined
  );
  return {
    group,
    done,
    dispose() {
      for (const m of meshes) m.dispose();
      group.removeFromParent();
    }
  };
}
