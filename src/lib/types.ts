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
  type: number;
  subtype: number;
  category: string;
}

export interface NpcRecord {
  id: string;
  name: string;
  /** Converted model path relative to converted/models. */
  glb: string;
  scale: number;
  level: number;
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
}

export interface PaletteColor {
  sn: number;
  ch0: string;
  ch1: string;
  ch2: string;
  palette: string;
}

export interface IndexMeta {
  builtAt: string;
  items: number;
  npcs: number;
  maps: number;
  flatModels: number;
  llidModels: number;
  palettes: number;
  warnings: Record<string, number>;
}
