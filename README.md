# BannedStory2 – MapleStory 2 studio and asset extraction

Two parts: tools that unpack the (discontinued) MapleStory 2 Steam install (`cmd/extract/`), and a local SvelteKit app (`src/`) that uses the result as a Roblox-style studio: a model hierarchy, a properties list, character dressing and real game maps. Personal use only; don't redistribute the assets.

Node isn't installed globally on this machine, so every command runs inside `nix shell nixpkgs#nodejs --command ...`. The repo's `shell.nix` bundles Node plus the converters the extraction scripts use (ffmpeg, vgmstream, ImageMagick), so `nix-shell` gives you all of them at once.

## The app

Svelte 5 + SvelteKit + Threlte (three.js), TypeScript. It serves the extracted assets itself (there is no copy step) and keeps everything local: saves go to the browser's localStorage, with JSON and GLB export.

```sh
# one-time: extract and convert the game assets first (see "Extraction" below), then
nix shell nixpkgs#nodejs --command npm install
nix shell nixpkgs#nodejs --command npm run index     # builds .data/*.json from the extracted XML (items, NPCs, maps, ...)
nix shell nixpkgs#nodejs --command npm run dev       # http://localhost:5173
```

Other scripts: `npm run check` (svelte-check), `npm test` (Vitest), `npm run build` (adapter-node, then `node build`). Set `MS2_EXTRACTED` / `MS2_DATA` to move the asset or index folders.

The app is a single page, the studio, served at `/`.

Four areas. **Explorer** (right, top): the scene as a tree; a character owns its worn items as child nodes plus a `Skeleton` of bones. Drag to reparent or reorder, drop onto a bone to mount a node there (a sword on a hand, a prop on the head), rename (F2 / double click), hide, lock, filter, right-click menu. **Properties** (right, bottom): sections for the selected node (name, transform with scrubbable fields, gender, skin tone and item colours, animation clip and speed, attach bone, source, locked) or a selected bone. **Viewport**: click to select (Alt+click the top-level node), right-click for the menu, move/rotate/scale gizmos (G/R/S, snap). **Toolbox** (left, `I` opens it): tabs for Props, NPCs, Maps, Characters (base bodies and saved outfits) and Items. Click or arrow to select an entry and see it in the preview pane (orbitable; NPCs and characters get an animation picker, maps load progressively with prop counts, items are worn on a mannequin); **Insert**, double click or Enter adds it under the selected node (or the scene root, switchable) and the dock stays open ("N added"). Props show the preview image embedded in their model, items show their icon; everything else is name plus preview. Items go onto the selected character, or onto a new character when none is selected. Also: undo/redo (Ctrl+Z/Y), duplicate (Ctrl+D), group (Ctrl+G), focus (F), autosave, JSON import/export, GLB export of the scene or of one node with its animation.

### How it works

- `src/routes/api/assets/[...path]` streams files from `extracted/` (only `converted/` and `Resource/Image/`), case-insensitively, with range and ETag support. GLBs reference their textures by relative URL, so they just work through this route.
- `scripts/build-index.ts` reads `Xml/item`, `Xml/npc`, `Xml/map`, the English string tables, `colorpalette.xml`, the flat model definitions and the `asset-web-metadata` N-Triples (llid -> path) into `.data/`. Server routes search those indexes (`/api/items`, `/api/npcs`, `/api/props`, `/api/maps`, `/api/maps/[id]`, `/api/palettes/[id]`, `/api/clips`).
- **Dressing** (`src/lib/character/rig.ts`): clothes are skinned onto the same `Bip01` skeleton as the body, so their meshes are re-bound to the body's bones by name (extra bones are re-parented) and the body meshes they replace (`CL_Skin`, `PA_Skin`, ...) are hidden. Hats, hair, accessories and weapons are static meshes in a mount group parented to a bone or dummy node (`Bip01 Head`, `Weapon_Side_L_Point`, ...); the mount group carries the item's offset and can be moved to any other bone from its Properties or by dragging it onto a bone in the Explorer. Hair replaces the body's default hair node.
- **Dressing is the scene tree** (`src/lib/scene/`, `src/lib/studio/`): right-click a character (or one of its bones) and choose **Add Child...**. The item browser previews whatever you hover or arrow to on the real character (`rig.previewEquip` covers the item it would replace and puts it back afterwards; nothing is saved or recorded), and a click wears it as a child node. A click on a worn item takes it off. The tree is a flat list of nodes with `parentId`; `SceneRuntime` (`runtime.svelte.ts`) mirrors it into a three.js graph and reconciles each character's rig with its item children, so editing one item never rebuilds the character.
- **Colours** (`tint.ts`): `_c` textures are RGB masks that select the item's three palette channels; a patched `MeshStandardMaterial` re-colours masked regions from the palette, keeping the base lightness. The exact blend is approximated by eye against the in-game icons. Export bakes it into the diffuse texture.
- **Maps** (`src/lib/server/xblock.ts`, `src/lib/maps/`): an xblock lists entities by flat-model name with position (cm, Z-up), rotation (degrees, applied as Rz*Ry*Rx) and scale. Each is resolved to a converted model and drawn with one `InstancedMesh` per mesh part. About 98% of entities resolve; waypoints, triggers and spawners have no model.

Layout: `src/lib/{assets,character,maps,scene,studio,export,stores,server,components}` (the Toolbox is `studio/Toolbox.svelte`, its preview is `studio/preview.svelte.ts` + `PreviewStage.svelte`), routes in `src/routes`, index builder in `scripts/`.

### Known gaps in the app

- Terrain (`PrecomputedTerrain/*.tok`), skyboxes, lighting and particle effects aren't decoded, so maps show props only.
- Faces are static (no morph targets/expressions), and there is no held-weapon pose: weapons sit on their carry points unless you mount them on a hand bone yourself.
- Selection is a single node (no multi-select), bones can't be posed, and the Add Child preview of a static item ignores a bone override (it shows at the item's own attach point).
- Large maps keep every instance on the GPU; very big maps (like Tria) are slow on weak machines.
- The app has no authentication or sandboxing. It's meant to run locally.

## Extraction

The tools below produce `extracted/`, which the app reads.

## Layout of the game files

| Source | Format | Handled by |
| --- | --- | --- |
| `Data/**/*.m2d` + `.m2h` (23 archives listed in `PackClient.ini`) | `MS2F` pack (AES-CTR + zlib, or XOR for movies) | `cmd/extract/extract.js` |
| `Data/Sound/*.fsb` | FMOD FSB5 banks | `cmd/extract/convert-audio.sh` |
| `Custom/`, `Data/Shaders/`, `Data/Resource/gfx/` | loose files | `cmd/extract/copy-loose.js` |

`vendor/maple2-file-io` is [shuabritze/maple2-file-io](https://github.com/shuabritze/maple2-file-io) (MIT) with two local fixes:

- `AESCipher.transformBlock` now uses Node's native `aes-256-ctr` (output verified byte-identical; the original was ~1 MB/s, now it extracts all 17 GB in a few minutes).
- XOR-flagged entries (`0xFF000000`, used by `Movie/*` and one Gfx file) were decrypted through the AES path and the XOR routine ignored its key. XOR is checked first and is now `data[i] ^= key[i % 2048]`.

## Usage

```sh
# one-time: build the vendored reader
nix shell nixpkgs#nodejs --command npm run build:vendor

# extract every archive to extracted/ (resumable; pass substrings to select archives, --list to only list entries)
nix shell nixpkgs#nodejs --command node cmd/extract/extract.js [Model/Npc ...]

# loose files
nix shell nixpkgs#nodejs --command node cmd/extract/copy-loose.js

# conversions (output in extracted/converted/)
nix shell nixpkgs#vgmstream nixpkgs#ffmpeg --command bash cmd/extract/convert-audio.sh   # FSB  -> OGG, one folder per bank
nix shell nixpkgs#imagemagick --command bash cmd/extract/convert-textures.sh [Resource]  # DDS  -> PNG
nix shell nixpkgs#ffmpeg nixpkgs#vgmstream --command bash cmd/extract/convert-video.sh   # USM  -> MP4
nix shell nixpkgs#nodejs --command node cmd/extract/nif-thumbnails.js                    # NIF  -> embedded PNG previews
nix shell nixpkgs#nodejs --command node cmd/extract/nif/convert-all.js [Npc Map ...]     # NIF  -> GLB (needs the DDS->PNG step first)
nix shell nixpkgs#nodejs --command node cmd/extract/nif/to-gltf.js in.nif out.glb [--external-textures] [--animations]   # single file, textures embedded by default
nix shell nixpkgs#nodejs --command node cmd/extract/nif/verify.js [nif|kf]        # re-check parsers against every block size
```

### Model format notes

The NIFs are standard Gamebryo 4 files, version **30.2.0.3** (a handful are 30.1.0.3/30.0.0.2/20.9.0.x), as described by the [niftools nif.xml](https://github.com/niftools/nifxml) spec, which lists MapleStory 2 under that version. They use NiMesh + NiDataStream (interleaved vertex streams) rather than NiTriShape. Header quirks: a `Metadata` byte array (holds the PNG thumbnail) follows the block count, and block-type indices carry a high flag bit (mask `0x7FFF`).

`cmd/extract/nif/` has hand-written parsers for the geometry, material, skinning and animation blocks (NiNode, NiMesh, NiDataStream, NiTexturingProperty, NiSourceTexture, NiMaterialProperty, NiAlphaProperty, NiSkinningMeshModifier, NiSequenceData, NiTransformEvaluator, NiBSplineCompTransformEvaluator, NiBSplineData, NiBSplineBasisData, NiTransformData, NiTextKeyExtraData). `verify.js` checks each parser against the exact per-block size in the NIF header (`node cmd/extract/nif/verify.js nif` and `... kf`): all 779k geometry blocks, 334k material/texture blocks, 16k skinning modifiers and 2M animation blocks match.

**Skinning.** Skinned meshes store bind-pose streams (`POSITION_BP`, `NORMAL_BP`), `BLENDINDICES` (u8x4) and `BLENDWEIGHT` (only 3 floats, the 4th is implied), plus a per-submesh `BONE_PALETTE` that maps local indices to the modifier's bone list. The modifier's bone transforms are the glTF inverse bind matrices.

**Animation.** `.kf` files use Gamebryo's evaluator system. Most channels are `NiBSplineCompTransformEvaluator`: 16-bit compressed control points (`offset + halfRange * short / 32767`) on a clamped uniform cubic B-spline, which `animation.js` samples at 30 fps. Keyframed channels keep their key times, and channels that never change collapse to a single key. Clips target bones by node name, and quaternions are stored `w, x, y, z`.

**Pairing and layout.** A model's clips are the `.kf` files in its folder (in folders holding several models, only clips whose bones mostly exist in the model).
- Up to 64 clips are embedded in the model's GLB.
- Larger sets (the 1,900-clip male/female bodies) get one skeleton-only GLB per clip in `<model>.anims/`, or in `<folder>/_clips/` when the folder holds several models that share a skeleton. Load those onto the model in Blender or similar by matching bone names.
- Text keys (`start`, `end`, `hit`, ...) are in each animation's `extras.textKeys`.

Override the game location with `MS2_DIR=/path/to/MapleStory\ 2`.

## Extracted content (`extracted/`)

- `Xml/` (115k XML: items, NPCs, skills, maps, quests...), `Resource/Exported` (`.flat`/`.xblock` map definitions), `Resource/Library`, `lua/`.
- `Resource/Image` (UI/item icons, DDS + PNG), `Resource/Gfx` (Scaleform `.gfx` + DDS).
- `Resource/Model/*` – Gamebryo `.nif` meshes, `.kf`/`.kfm` animations, `Textures` (DDS, `.ifl` flipbooks), `Resource/PrecomputedTerrain` (`.tok`).
- `Resource/Movie` – CRI `.usm` videos.
- `manifest`: each archive folder has `_manifest.json` (entry names, sizes, failures).

## Known gaps

- **Models are exported with skeletons, skins and skeletal animation**, but without morph targets (facial/blend shapes), particle systems, material/visibility animation (float and bool evaluators) or shader effects. The character body renders white because the game tints skin at runtime. Quadratic/TBC key interpolation is approximated as linear. 2,113 NIFs have no renderable geometry (lights, cameras, pure particle/effect nodes) and produce no GLB; 41 referenced textures don't exist in the archives.
- The `Path` and `Camera` NIFs are mostly helper nodes, so few of them produce GLBs.
- `extracted/converted/model-previews/` holds the PNG thumbnails stored in each NIF's header metadata (about 9.7k of the 28.6k NIFs have one).
- `.gfx` (Scaleform/SWF-like UI), `.tok` terrain, `.kfm` animation managers (transition tables) and `.fxo` shaders are left as raw extracted files.
- `GfxDebug` and `XmlDebug` archives are listed in `PackClient.ini` but not shipped.
- All 368 non-empty USMs and 51.6k DDS convert without failures, but the converted `Movie/Common` MP4s are **video-only**: ffmpeg can't decode the USM audio track and vgmstream can't open it either.
- Failures are logged to `convert-video.failed.log` / `convert-textures.failed.log`.
