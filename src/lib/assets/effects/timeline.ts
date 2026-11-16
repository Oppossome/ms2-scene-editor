import { Euler, Group, MathUtils, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { EffectDummy, EffectTimeline, EffectTimelineEntry, EffectTimelineNif } from '../../types.js';
import { instantiate } from '../loader.js';
import { EffectPlayer, uriResolver, type EffectOptions } from './player.js';
import { hashRandom } from './timing.js';

/**
 * Plays an effect XML (Xml/effect/*.xml) on a model: each NIF entry starts after its delay, plays for its duration
 * (or its own length, or forever when it loops) and sits on a node of the host (a bone, an effect dummy such as
 * Eff_Body, or "Scene Root"), offset by its transform. Everything here is in Gamebryo's frame (Z up, cm); converted
 * effect models carry their own Z-up-to-Y-up node, which is undone below.
 */

export interface TimelineHost {
  /** Gamebryo-frame root of the host ("Scene Root"); effects that do not follow their node are placed under it. */
  root: Object3D;
  /** A node of the host by its game name (bones, dummy points), or undefined. */
  node(name: string): Object3D | undefined;
}

const timelineCache = new Map<string, Promise<EffectTimeline | null>>();

/** An effect XML as a timeline (null when the game has no such file). */
export function fetchTimeline(path: string): Promise<EffectTimeline | null> {
  const key = path.toLowerCase();
  let hit = timelineCache.get(key);
  if (!hit) {
    hit = fetch(`/api/effects/timeline?path=${encodeURIComponent(path)}`).then((r) =>
      r.ok
        ? (r.json() as Promise<EffectTimeline>)
        : r.status === 404
          ? null
          : Promise.reject(new Error(`HTTP ${r.status}`))
    );
    hit.catch(() => timelineCache.delete(key));
    timelineCache.set(key, hit);
  }
  return hit;
}

const dummyCache = new Map<number, Promise<EffectDummy[]>>();

/** The player characters' effect dummies (Eff_Head, Eff_Body_World, ...) for a gender. */
export function fetchPlayerDummies(gender: 0 | 1): Promise<EffectDummy[]> {
  let hit = dummyCache.get(gender);
  if (!hit) {
    hit = fetch(`/api/effects/dummies?gender=${gender}`).then((r) =>
      r.ok ? (r.json() as Promise<EffectDummy[]>) : Promise.reject(new Error(`HTTP ${r.status}`))
    );
    hit.catch(() => dummyCache.delete(gender));
    dummyCache.set(gender, hit);
  }
  return hit;
}

/** Gamebryo offset (cm, degrees, R = Rz * Ry * Rx) as a matrix. */
function offsetMatrix(translate: readonly number[], rotation: readonly number[], scale: number): Matrix4 {
  const q = new Quaternion().setFromEuler(
    new Euler(MathUtils.degToRad(rotation[0]), MathUtils.degToRad(rotation[1]), MathUtils.degToRad(rotation[2]), 'ZYX')
  );
  return new Matrix4().compose(new Vector3(...translate), q, new Vector3(scale, scale, scale));
}

/** Pick one option of a random group by weight, the same way for the same seed and play. */
export function pickEntry(entry: EffectTimelineEntry, seed: number, index: number): EffectTimelineNif | null {
  if (entry.kind === 'nif') return entry;
  const total = entry.weights.reduce((a, b) => a + b, 0);
  let r = hashRandom(seed, index, 77) * (total || entry.options.length);
  for (let i = 0; i < entry.options.length; i++) {
    r -= total ? entry.weights[i] : 1;
    if (r < 0) return pickEntry(entry.options[i], seed, index * 31 + i + 1);
  }
  return pickEntry(entry.options[entry.options.length - 1], seed, index * 31 + entry.options.length);
}

interface Running {
  entry: EffectTimelineNif;
  /** Placed on the node (or under the host root), carries the entry's offset. */
  holder: Group;
  player: EffectPlayer | null;
  loading: boolean;
  /** Where an unattached effect was left when it started. */
  placed: boolean;
}

const zUp = new Matrix4().makeRotationX(Math.PI / 2);
const tmp = new Matrix4();
const tmpPos = new Vector3();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();

export class TimelinePlayer {
  private readonly running: Running[] = [];
  private readonly dummies = new Map<string, EffectDummy>();
  private readonly dummyNodes = new Map<string, Object3D>();
  private disposed = false;

  constructor(
    readonly timeline: EffectTimeline,
    private readonly host: TimelineHost,
    private readonly options: { dummies?: EffectDummy[]; seed?: number; effect?: EffectOptions } = {}
  ) {
    for (const d of options.dummies ?? []) this.dummies.set(d.name.toLowerCase(), d);
    const seed = options.seed ?? 1;
    timeline.entries.forEach((entry, i) => {
      const nif = pickEntry(entry, seed, i);
      if (!nif?.glb) return;
      const holder = new Group();
      holder.name = nif.file;
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(offsetMatrix(nif.translate, nif.rotation, nif.scale));
      holder.visible = false;
      this.running.push({ entry: nif, holder, player: null, loading: false, placed: false });
    });
  }

  /** Whether every entry repeats on its own (an idle aura); otherwise the timeline has an end. */
  get loops(): boolean {
    return this.running.length > 0 && this.running.every((r) => r.entry.loop);
  }

  /** Seconds until the last non-looping entry ends (entries still loading count by their duration). */
  get length(): number {
    let end = 0;
    for (const r of this.running) {
      const own = r.entry.duration ?? (r.player ? r.player.duration + r.player.particleTail : 0);
      end = Math.max(end, r.entry.startDelay + own);
    }
    return end;
  }

  /** A node by game name: a host node, else an effect dummy built on its parent; "Scene Root" is the root. */
  private resolve(name: string, depth = 0): Object3D {
    const key = name.toLowerCase();
    if (!key || key === 'scene root') return this.host.node('Scene Root') ?? this.host.root;
    const own = this.host.node(name);
    if (own) return own;
    const built = this.dummyNodes.get(key);
    if (built) return built;
    const dummy = this.dummies.get(key);
    if (!dummy || depth > 8) return this.host.node('Scene Root') ?? this.host.root;
    const parent = this.resolve(dummy.parentNode, depth + 1);
    const node = new Group();
    node.name = dummy.name;
    node.matrixAutoUpdate = false;
    node.matrix.copy(offsetMatrix(dummy.translate, dummy.rotation, dummy.scale));
    parent.add(node);
    this.dummyNodes.set(key, node);
    return node;
  }

  private async load(r: Running) {
    r.loading = true;
    try {
      const loaded = await instantiate(r.entry.glb!);
      if (this.disposed) return;
      // The model turns its Z-up content to Y-up; the holder is already in Gamebryo's Z-up frame.
      const content = new Group();
      content.matrixAutoUpdate = false;
      content.matrix.copy(zUp);
      content.add(loaded.object);
      r.holder.add(content);
      r.player = new EffectPlayer(loaded.object, this.options.effect ?? {}, uriResolver(loaded.object));
    } catch {
      // A missing effect model just does not show.
    }
  }

  private place(r: Running) {
    const node = this.resolve(r.entry.parentNode);
    const offset = offsetMatrix(r.entry.translate, r.entry.rotation, r.entry.scale);
    if (r.entry.attachToNode) {
      if (r.holder.parent !== node) node.add(r.holder);
      r.holder.matrix.copy(offset);
    } else {
      // Left where the node was when it started: relative to the host root, without following it afterwards.
      const root = this.host.node('Scene Root') ?? this.host.root;
      root.updateWorldMatrix(true, false);
      node.updateWorldMatrix(true, false);
      tmp.copy(root.matrixWorld).invert().multiply(node.matrixWorld);
      if (!r.entry.applyNodeTransform) {
        tmp.decompose(tmpPos, tmpQuat, tmpScale);
        tmp.makeTranslation(tmpPos.x, tmpPos.y, tmpPos.z);
      }
      if (r.holder.parent !== root) root.add(r.holder);
      r.holder.matrix.multiplyMatrices(tmp, offset);
    }
    r.placed = true;
  }

  /** Show the timeline at `time` seconds (from its start). */
  update(time: number) {
    if (this.disposed) return;
    for (const r of this.running) {
      const local = time - r.entry.startDelay;
      const own = r.entry.duration ?? (r.player ? r.player.duration + r.player.particleTail : Infinity);
      const active = local >= 0 && (r.entry.loop || local < own);
      if (!active) {
        r.holder.visible = false;
        r.placed = false;
        r.player?.restart();
        continue;
      }
      if (!r.player && !r.loading) void this.load(r);
      if (!r.placed) this.place(r);
      r.holder.visible = true;
      if (!r.player) continue;
      const length = r.player.duration + r.player.particleTail;
      const t = r.entry.loop && !r.player.selfLooping && length > 0 ? local % length : local;
      r.player.update(t);
    }
  }

  dispose() {
    this.disposed = true;
    for (const r of this.running) {
      r.player?.dispose();
      r.holder.removeFromParent();
    }
    for (const node of this.dummyNodes.values()) node.removeFromParent();
    this.running.length = 0;
    this.dummyNodes.clear();
  }
}
