/** Shared data shapes produced by scripts/build-index.ts and consumed by the server routes and UI. */

export type Gender = 0 | 1 | 2; // 0 male, 1 female, 2 both

export interface ItemAsset {
  /** Slot the asset belongs to (CL, PA, SH, GL, CP, HR, FA, RH, ...). */
  slot: string;
  /** Path of the converted model relative to converted/models (case-insensitive on disk). */
  glb: string;
  gender: Gender;
  /** Node inside the item model that is placed. */
  selfnode: string;
  /** Bone of the character skeleton it attaches to (empty for skinned clothes). */
  targetnode: string;
  /** Node inside the item model used as the grip/attach point. */
  attachnode: string;
  /** Whether the matching body mesh is hidden. */
  replace: boolean;
  earfold: boolean;
  weapon: boolean;
}

export interface ItemRecord {
  id: string;
  name: string;
  /** Item class from the string table: hair, hat, coat, pants, shoes, gloves, longsword, ... */
  cls: string;
  /** URL path (under /api/assets) of the inventory icon, if any. */
  icon: string;
  /** Distinct slot names of the assets. */
  slots: string[];
  assets: ItemAsset[];
  /** Colour palette id from the item's customize block (0 = not customisable). */
  palette: number;
  /** Index (colorSN) of the palette colour the item uses by default. */
  defaultColor: number;
  /** Whether the game lets the player change the palette's main (ch0) and detail (ch2) colours. */
  channels: [main: boolean, detail: boolean];
  type: number;
  subtype: number;
  category: string;
  /**
   * Effect XMLs (relative to Xml/effect) the item plays: `characterIdle` on the character wearing it,
   * `characterBattleIdle` instead while weapons are drawn, `idle`/`battleIdle` on the item itself when it lies alone.
   */
  effects?: Partial<Record<'idle' | 'battleIdle' | 'characterIdle' | 'characterBattleIdle', string>>;
}

/** An animation clip a body or model can play, with its length in seconds (0 when unknown). */
export interface ClipInfo {
  name: string;
  duration: number;
}

export interface NpcRecord {
  id: string;
  name: string;
  /** Converted model path relative to converted/models. */
  glb: string;
  scale: number;
  level: number;
  /** Effect XML (relative to Xml/effect) the NPC always shows, like a ghost's glow. */
  keepEffect?: string;
}

/** A placeable prop (flat model) resolved to a converted model. */
export interface PropRecord {
  /** Lowercase flat model name. */
  id: string;
  name: string;
  glb: string;
}

export interface MapRecord {
  id: string;
  name: string;
  /** Name of the xblock file (without extension, lowercase) under Resource/Exported/xblock. */
  xblock: string;
}

/** What a map sets for its surroundings: a painted backdrop image and distance fog. */
export interface MapEnvironment {
  /** Backdrop image, a path under `converted/textures` (e.g. "Resource/Image/bg/bg_tria.png"). */
  background?: string;
  /** Linear fog in world units, measured from the camera. */
  fog?: { color: [number, number, number]; near: number; far: number };
}

/** A map's props: placements are [modelIndex, x, y, z, rotX, rotY, rotZ, scaleX, scaleY, scaleZ] (Z-up, cm, degrees). */
export interface MapData {
  id: string;
  name: string;
  /** Converted model paths, referenced by index from the items. */
  models: string[];
  items: number[][];
  /** Entities in the xblock vs how many were placeable. */
  total: number;
  unresolved: number;
  /** Backdrop and fog; absent for maps that set neither. */
  environment?: MapEnvironment;
}

export interface PaletteColor {
  sn: number;
  ch0: string;
  ch1: string;
  ch2: string;
  palette: string;
}

/** A converted effect model (under converted/models/Effect). */
export interface EffectRecord {
  /** Lowercase path relative to Effect/, without .glb. */
  id: string;
  /** Path relative to Effect/, without .glb (folders say what it belongs to: bg, ch/skill/..., npc, item). */
  name: string;
  glb: string;
}

/** One motion of an emote: the clip the caster plays and the effect XMLs that go with it (relative to Xml/effect). */
export interface EmoteMotion {
  clip: string;
  /** Played from the start of the clip. */
  cast?: string;
  /** Repeats while the clip plays. */
  loop?: string;
}

/**
 * An emote: a skill with effects or an emote clip (from its first level), or an instrument. What the Emotes row lists
 * and applies to a character or NPC.
 */
export interface EmoteRecord {
  id: string;
  name: string;
  motions: EmoteMotion[];
  /**
   * Models shown with every motion, for as long as the emote is set: an instrument (`instrument-<id>`, from
   * Xml/table/instrumentinfo.xml) puts its stand (a piano, a drum) at the model's origin and its held parts in the hands.
   */
  props?: EffectTimelineNif[];
}

/** One NIF of an effect timeline (Xml/effect/*.xml), placed on a node of the model that plays it. */
export interface EffectTimelineNif {
  kind: 'nif';
  /** The NIF as the XML names it, relative to Model/Effect. */
  file: string;
  /** Converted model (relative to converted/models), or null when it was not converted. */
  glb: string | null;
  startDelay: number;
  /** Seconds it plays; null: until its own animation ends (or forever when it loops). */
  duration: number | null;
  loop: boolean;
  /** Node it is placed on: a bone, a dummy (Eff_Body, ...) or "Scene Root". */
  parentNode: string;
  /** Follow the node while playing (false: placed where the node was when it started). */
  attachToNode: boolean;
  /** Take the node's rotation and scale too (false: only its position). */
  applyNodeTransform: boolean;
  /** Offset on the node, Gamebryo units (cm, Z up), rotation in degrees. */
  translate: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

/** One of several entries, picked at random by weight each time the timeline plays. */
export interface EffectTimelineRandom {
  kind: 'random';
  weights: number[];
  options: EffectTimelineEntry[];
}

export type EffectTimelineEntry = EffectTimelineNif | EffectTimelineRandom;

export interface EffectTimeline {
  path: string;
  entries: EffectTimelineEntry[];
}

/** A named effect attachment point (Eff_Head, Eff_Body_World, ...) defined on a bone or another dummy. */
export interface EffectDummy {
  name: string;
  parentNode: string;
  translate: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  /** Keeps world orientation instead of following the parent's rotation. */
  world: boolean;
}

export interface IndexMeta {
  builtAt: string;
  items: number;
  npcs: number;
  maps: number;
  flatModels: number;
  llidModels: number;
  /** Absent in indexes built before effects were indexed. */
  effects?: number;
  emotes?: number;
  palettes: number;
  warnings: Record<string, number>;
}
