import { Box3, Group, InstancedMesh, Matrix4, Mesh, type Intersection } from 'three';
import { loadModel } from '../assets/loader.js';
import type { PropEntity } from '../entities/prop.svelte.js';

/** A gizmo target with local mesh bounds but no cloned render hierarchy. */
export class InstanceTarget extends Group {
  boundingBox = new Box3();
}

interface Batch {
  path: string;
  members: PropEntity[];
  parts: { source: Mesh; mesh: InstancedMesh }[];
  ids: string[];
  capacity: number;
  loaded: boolean;
  matrices: Map<string, Matrix4>;
  bounds: Box3;
  dynamic: boolean;
}

export class EntityBatches {
  private batches = new Map<string, Batch>();
  private owners = new WeakMap<InstancedMesh, Batch>();
  private disposed = false;
  private running = 0;
  private queue: Batch[] = [];
  private pending = new Set<Promise<void>>();

  constructor(
    private readonly root: Group,
    private readonly changed: () => void,
    private readonly error: (message: string, error: unknown) => void,
    private readonly fallback: (path: string) => void
  ) {}

  sync(props: PropEntity[], dynamicIds: ReadonlySet<string> = new Set()) {
    const groups = new Map<string, PropEntity[]>();
    for (const prop of props) {
      const path = prop.glb;
      const members = groups.get(path) ?? [];
      members.push(prop);
      groups.set(path, members);
    }
    for (const [path, batch] of this.batches) if (!groups.has(path)) {
      this.release(batch);
      this.batches.delete(path);
    }
    for (const [path, members] of groups) {
      let batch = this.batches.get(path);
      if (!batch) {
        batch = { path, members, parts: [], ids: [], capacity: 0, loaded: false, matrices: new Map(), bounds: new Box3(), dynamic: false };
        this.batches.set(path, batch);
        this.queue.push(batch);
      }
      batch.members = members;
      batch.dynamic = members.some((member) => dynamicIds.has(member.id));
      if (batch.loaded) this.apply(batch);
    }
    this.pump();
  }

  updateAnimated() {
    for (const batch of this.batches.values()) if (batch.loaded && batch.dynamic) this.apply(batch);
  }

  private pump() {
    while (this.running < 6 && this.queue.length && !this.disposed) {
      const batch = this.queue.shift()!;
      if (this.batches.get(batch.path) !== batch) continue;
      this.running++;
      const task = this.load(batch).finally(() => {
        this.running--;
        this.pending.delete(task);
        this.pump();
      });
      this.pending.add(task);
    }
  }

  private async load(batch: Batch) {
    try {
      const model = await loadModel(batch.path);
      if (this.disposed || this.batches.get(batch.path) !== batch) return;
      model.scene.updateWorldMatrix(true, true);
      let skinned = false;
      model.scene.traverse((object) => { if ('isSkinnedMesh' in object) skinned = true; });
      if (skinned || model.animations.length) {
        this.batches.delete(batch.path);
        this.fallback(batch.path);
        return;
      }
      model.scene.traverse((object) => {
        if (!(object instanceof Mesh) || 'isSkinnedMesh' in object) return;
        object.geometry.computeBoundingBox();
        if (object.geometry.boundingBox) batch.bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
        const mesh = new InstancedMesh(object.geometry, object.material, batch.members.length);
        batch.parts.push({ source: object, mesh });
        this.owners.set(mesh, batch);
        this.root.add(mesh);
      });
      batch.capacity = batch.members.length;
      batch.loaded = true;
      this.apply(batch);
      this.changed();
    } catch (error) { this.error(`Map model failed: ${batch.path}`, error); }
  }

  private apply(batch: Batch) {
    let resized = false;
    if (batch.members.length > batch.capacity) {
      for (const part of batch.parts) {
        part.mesh.removeFromParent();
        part.mesh.dispose();
        part.mesh = new InstancedMesh(part.source.geometry, part.source.material, batch.members.length);
        this.owners.set(part.mesh, batch);
        this.root.add(part.mesh);
      }
      batch.capacity = batch.members.length;
      resized = true;
    }
    const active = batch.members.filter((member) => {
      for (let object: Group | null = member.object; object; object = object.parent as Group | null) if (!object.visible) return false;
      return true;
    });
    const ids = active.map((member) => member.id);
    const remapped = resized || ids.length !== batch.ids.length || ids.some((id, slot) => batch.ids[slot] !== id);
    batch.ids = ids;
    this.root.updateWorldMatrix(true, false);
    const inverseRoot = this.root.matrixWorld.clone().invert();
    const matrix = new Matrix4();
    for (const member of batch.members) {
      if (!(member.object instanceof InstanceTarget)) continue;
      member.object.boundingBox.copy(batch.bounds);
    }
    const changed = new Set<number>();
    active.forEach((member, slot) => {
      member.object!.updateWorldMatrix(true, false);
      matrix.copy(inverseRoot).multiply(member.object!.matrixWorld);
      if (remapped || !batch.matrices.get(member.id)?.equals(matrix)) {
        batch.matrices.set(member.id, matrix.clone());
        changed.add(slot);
      }
    });
    const activeIds = new Set(ids);
    for (const id of batch.matrices.keys()) if (!activeIds.has(id)) batch.matrices.delete(id);
    if (!changed.size && !remapped) return;
    for (const { source, mesh } of batch.parts) {
      mesh.count = active.length;
      mesh.instanceMatrix.clearUpdateRanges();
      for (const slot of changed) {
        const member = active[slot];
        matrix.copy(batch.matrices.get(member.id)!).multiply(source.matrixWorld);
        mesh.setMatrixAt(slot, matrix);
        mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
  }

  pick(hit: Intersection): string | undefined {
    if (!(hit.object instanceof InstancedMesh) || hit.instanceId === undefined) return undefined;
    return this.owners.get(hit.object)?.ids[hit.instanceId];
  }

  private release(batch: Batch) {
    for (const { mesh } of batch.parts) { mesh.removeFromParent(); mesh.dispose(); }
  }
  dispose() {
    this.disposed = true;
    this.queue = [];
    for (const batch of this.batches.values()) this.release(batch);
    this.batches.clear();
  }
}
