import type { ClipInfo } from '../types.js';
import type { SceneNode, Vec3 } from './model.js';

export type PropType = 'string' | 'number' | 'vec3' | 'bool' | 'enum' | 'clip' | 'palette' | 'readonly' | 'action';

export interface PropOption {
  value: string;
  label: string;
}

export interface PropRow {
  key: string;
  label: string;
  type: PropType;
  value?: string | number | boolean | Vec3;
  /** Step for number fields. */
  step?: number;
  min?: number;
  options?: PropOption[];
  /** Clips a `clip` row can choose from. */
  clips?: ClipInfo[];
  /** Palette id for `palette` rows (skin tones use the body palette). */
  palette?: number;
  /** Explains why the row cannot be edited. */
  disabled?: string;
}

export interface PropSection {
  section: string;
  rows: PropRow[];
}

/** What the panel knows about the selected node besides the node itself. */
export interface PropContext {
  node: SceneNode;
  parent?: SceneNode;
  /** Path of names from the root, for the Parent row. */
  path: string[];
  /** Clips the node can play (empty when none). */
  clips: ClipInfo[];
  /** Bones and dummy nodes of the parent character a node can be mounted on. */
  bones: string[];
  /** Default bone of a static item. */
  defaultBone: string;
  /** Items bound to the skeleton follow it and have no offset of their own. */
  skinned: boolean;
  /** Palette of an item (0 = not customisable). */
  palette: number;
}

export const RAD = 180 / Math.PI;
export const BODY_PALETTE = 1;

const KIND_LABELS: Record<SceneNode['kind'], string> = {
  group: 'Group',
  prop: 'Prop',
  npc: 'NPC',
  character: 'Character',
  item: 'Item',
  map: 'Map'
};

export const kindLabel = (kind: SceneNode['kind']) => KIND_LABELS[kind];

const round = (n: number) => Math.round(n * 1000) / 1000;
const vec = (v: Vec3, degrees = false): Vec3 => v.map((x) => round(degrees ? x * RAD : x)) as Vec3;

/** The rows to show for a node, grouped into sections (empty sections are left out). */
export function describeNode(ctx: PropContext): PropSection[] {
  const { node, parent } = ctx;
  const out: PropSection[] = [];
  const add = (section: string, rows: (PropRow | null)[]) => {
    const list = rows.filter((r): r is PropRow => !!r);
    if (list.length) out.push({ section, rows: list });
  };

  add('Data', [
    { key: 'name', label: 'Name', type: 'string', value: node.name },
    { key: 'class', label: 'Class', type: 'readonly', value: KIND_LABELS[node.kind] },
    { key: 'parent', label: 'Parent', type: 'readonly', value: parent ? parent.name : '(scene)' },
    { key: 'id', label: 'Id', type: 'readonly', value: node.id }
  ]);

  const noOffset = node.kind === 'item' && ctx.skinned ? 'Skinned clothes follow the skeleton' : undefined;
  add('Transform', [
    { key: 'position', label: node.kind === 'item' ? 'Offset' : 'Position', type: 'vec3', value: vec(node.position), step: 1, disabled: noOffset },
    { key: 'rotation', label: 'Rotation', type: 'vec3', value: vec(node.rotation, true), step: 1, disabled: noOffset },
    { key: 'scale', label: 'Scale', type: 'vec3', value: vec(node.scale), step: 0.05, disabled: noOffset }
  ]);

  add('Appearance', [
    { key: 'visible', label: 'Visible', type: 'bool', value: node.visible },
    node.kind === 'character'
      ? {
          key: 'gender',
          label: 'Gender',
          type: 'enum',
          value: String(node.gender ?? 1),
          options: [
            { value: '1', label: 'Female' },
            { value: '0', label: 'Male' }
          ]
        }
      : null,
    node.kind === 'character' ? { key: 'skin', label: 'Skin tone', type: 'palette', value: node.skin ?? 0, palette: BODY_PALETTE } : null,
    node.kind === 'item' && ctx.palette
      ? { key: 'color', label: 'Colour', type: 'palette', value: node.color ?? -1, palette: ctx.palette }
      : null
  ]);

  add('Animation', [
    ctx.clips.length ? { key: 'clip', label: 'Clip', type: 'clip', value: node.clip ?? '', clips: ctx.clips } : null,
    ctx.clips.length ? { key: 'speed', label: 'Speed', type: 'number', value: node.speed ?? 1, step: 0.1, min: 0.05 } : null
  ]);

  const mountable = parent?.kind === 'character' && !(node.kind === 'item' && ctx.skinned);
  add('Attachment', [
    mountable
      ? {
          key: 'attachBone',
          label: 'Attach to',
          type: 'enum',
          value: node.attachBone ?? '',
          options: [
            { value: '', label: node.kind === 'item' ? `(default: ${ctx.defaultBone || 'none'})` : '(character root)' },
            ...ctx.bones.map((b) => ({ value: b, label: b.replace(/_/g, ' ') }))
          ]
        }
      : null,
    node.kind === 'item' && !ctx.skinned ? { key: 'resetOffset', label: 'Offset', type: 'action', value: 'Reset offset' } : null
  ]);

  add('Source', [
    node.itemId ? { key: 'itemId', label: 'Item id', type: 'readonly', value: node.itemId } : null,
    node.slots?.length ? { key: 'slots', label: 'Slots', type: 'readonly', value: node.slots.join(', ') } : null,
    node.glb ? { key: 'glb', label: 'Model', type: 'readonly', value: node.glb } : null,
    node.mapId ? { key: 'mapId', label: 'Map id', type: 'readonly', value: node.mapId } : null
  ]);

  add('Behaviour', [{ key: 'locked', label: 'Locked', type: 'bool', value: node.locked }]);
  return out;
}

/** The node patch a property edit stands for, or null when the value is not usable. */
export function applyChange(key: string, value: unknown): Partial<SceneNode> | null {
  switch (key) {
    case 'name':
      return typeof value === 'string' && value.trim() ? { name: value.trim() } : null;
    case 'visible':
    case 'locked':
      return typeof value === 'boolean' ? { [key]: value } : null;
    case 'position':
    case 'scale':
    case 'rotation': {
      if (!Array.isArray(value) || value.length !== 3 || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
      const v = value as Vec3;
      return { [key]: key === 'rotation' ? (v.map((x) => x / RAD) as Vec3) : v };
    }
    case 'gender':
      return value === '0' || value === '1' || value === 0 || value === 1 ? { gender: Number(value) as 0 | 1 } : null;
    case 'skin':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? { skin: value } : null;
    case 'color':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? { color: value } : null;
    case 'clip':
      return typeof value === 'string' ? { clip: value || undefined } : null;
    case 'speed':
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? { speed: value } : null;
    case 'attachBone':
      return typeof value === 'string' ? { attachBone: value || undefined } : null;
    default:
      return null;
  }
}

/** Info shown when a bone of a character is selected. */
export function describeBone(characterName: string, bone: string, childCount: number): PropSection[] {
  return [
    {
      section: 'Data',
      rows: [
        { key: 'bone', label: 'Name', type: 'readonly', value: bone.replace(/_/g, ' ') },
        { key: 'class', label: 'Class', type: 'readonly', value: 'Bone' },
        { key: 'character', label: 'Character', type: 'readonly', value: characterName },
        { key: 'children', label: 'Child bones', type: 'readonly', value: String(childCount) }
      ]
    }
  ];
}
