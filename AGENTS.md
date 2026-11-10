# MS2SceneEditor – MapleStory 2 studio and asset extraction

> **AI disclaimer:** This project was made with the heavy assistance of AI.

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

Other scripts: `npm run lint` / `npm run lint:fix` (ESLint), `npm run format:check` / `npm run format` (Prettier), `npm run check` (svelte-check), `npm test` (Vitest), `npm run build` (adapter-node, then `node build`). CI runs lint, formatting, types, tests and build. Set `MS2_EXTRACTED` / `MS2_DATA` to move the asset or index folders.

ESLint uses flat configuration with JavaScript, TypeScript and Svelte recommended rules, including rune modules (`*.svelte.ts`); extraction JavaScript is CommonJS. Runtime caches and temporary collections deliberately remain non-reactive because explicit revisions drive updates. Prettier handles Svelte with `prettier-plugin-svelte`, single quotes, no trailing commas and a 120-column print width. Both tools exclude generated output, extracted assets and `vendor/`; Prettier also leaves the generated lockfile alone.

### Docker

The `Dockerfile` hosts the production build. The game's files are not in the image: mount the `extracted` folder (made by the extraction steps below, with `Xml/`, `Resource/` and `converted/` inside) at `/extracted`, read-only is fine, and a volume at `/data` for the search indexes and caches.

```sh
docker build -t ms2sceneeditor .
docker run --rm -p 3000:3000 -v /path/to/extracted:/extracted:ro -v ms2se-data:/data ms2sceneeditor   # http://localhost:3000
```

The first start builds the indexes from the mounted files into `/data` (about a minute; the first animation list takes a little longer), later starts skip that; set `REINDEX=1` to rebuild after the files change. The container runs as the unprivileged `node` user, so a bind-mounted `/data` must be writable by it (`--user` sets another). `PORT` (3000) and `HOST` (0.0.0.0) can be set, and `MS2_EXTRACTED` / `MS2_DATA` move the two folders. There is no login, so keep the port on your own machine or network: the app serves the game's copyrighted files.

The app is a single page, the studio, served at `/`.

Five areas. **Explorer** (right, top): the scene as a tree; a character owns its worn items as child nodes plus a `Skeleton` of bones. Drag to reparent or reorder, drop onto a bone to mount a node there (a sword on a hand, a prop on the head), rename (F2 / double click), hide, lock, filter, right-click menu. **Properties** (right, bottom): sections for the selected node (name, transform with scrubbable fields; groups can center their origin on their children's visible bounds without moving them; gender, skin tone, eye colour and item colours, animation clip, speed and a frame slider (it follows playback; dragging or arrow keys pause the animation on that frame at 30 per second, Resume plays on; `,` / `.` step a frame and Shift ten with the node selected), attach bone, source, locked) or a selected bone. **Viewport**: click to select (Alt+click the top-level node), right-click for the menu, move/rotate/scale gizmos (G/R/S, snap; Move can use local or world axes). **Menu bar** (top): a File menu (Export JSON, Import JSON, Export GLB, Clear scene), a View menu (the ground grid, fog, and the backdrop: the map's own, none, or any of the 131 backdrop images from a picker; remembered between visits) a Help menu (About, which says the project was made with the heavy assistance of AI) and undo/redo icons. **Toolbox** (left, `I` opens it): tabs for Props, NPCs, Maps, Characters (base bodies and saved outfits) and Items. The lists load 60 entries at a time and fetch the next page as you scroll near the end (an IntersectionObserver, `studio/toolbox/nearend.ts`). The NPC list shows NPCs that share a name and a model (the game has one per level) once, as the lowest-level one with its level range and variant count; searching the id of any of them finds it (`groupNpcs` in `server/query.ts`). Click or arrow to select an entry and see it in the preview pane (orbitable; NPCs and characters get an animation picker, maps load progressively with prop counts, items are worn on a mannequin); **Insert**, double click or Enter adds it under the selected node (or the scene root, switchable) and the dock stays open ("N added"). Props show the preview image embedded in their model, items show their icon; everything else is name plus preview. Items go onto the selected character, or onto a new character when none is selected. Also: undo/redo (Ctrl+Z/Y), duplicate (Ctrl+D), group (Ctrl+G), focus (F), autosave, and GLB export of one node with its animation.

### How it works

- A selected group has a **Center on children** action in Properties. It moves the group origin to the center of the children's visible bounds and adjusts their local positions to preserve their world positions.
- `src/routes/api/assets/[...path]` streams files from `extracted/` (only `converted/` and `Resource/Image/`), case-insensitively, with range and ETag support. GLBs reference their textures by relative URL, so they just work through this route.
- `scripts/build-index.ts` reads `Xml/item`, `Xml/npc`, `Xml/map`, the English string tables, `colorpalette.xml`, the flat model definitions and the `asset-web-metadata` N-Triples (llid -> path) into `.data/`. Server routes search those indexes (`/api/items`, `/api/npcs`, `/api/props`, `/api/maps`, `/api/maps/[id]`, `/api/palettes/[id]`, `/api/clips`).
- **Dressing** (`src/lib/entities/character/rig.ts`): clothes are skinned onto the same `Bip01` skeleton as the body, so their meshes are re-bound to the body's bones by name (extra bones are re-parented) and the body meshes they replace (`CL_Skin`, `PA_Skin`, ...) are hidden. Hats, hair, accessories and weapons are static meshes in a mount group parented to a bone or dummy node (`Bip01 Head`, `Weapon_Side_L_Point`, ...); the mount group carries the item's offset and can be moved to any other bone from its Properties or by dragging it onto a bone in the Explorer. Hair replaces the body's default hair node.
- **Dressing is the scene tree** (`src/lib/scene/`, `src/lib/studio/`): right-click a character (or one of its bones) and choose **Add Child...**. That selects it and opens the Toolbox; inserting an item wears it as a child, replacing whatever shares its slot. The scene is a flat list of reactive entities with `parentId`. `CharacterEntity` reconciles its rig with its item children, so editing one item never rebuilds the character.
- **Entities** (`entities/`, `entities/property.svelte.ts`, `entities/render-context.ts`): `GroupEntity`, `PropEntity`, `NpcEntity`, `CharacterEntity`, `ItemEntity` and `LightingEntity` each own their state, their JSON and their three.js objects. `RiggedModel` is the base of everything with a skeleton and clips (`CharacterEntity`, and `ModelEntity` for `NpcEntity`/`PropEntity`): clip, speed and held frame, and the `AnimationPlayer`. A property (`this.define(key, new EntityProperty(schema, default, editorRow))`) holds one immutable reactive value with its Zod rule and its Properties row, so adding one is a single declaration. `render(context)` brings existing three.js objects in line with the properties (cheap and repeatable; it never reloads a model that has not changed), `tick(delta)` advances animation only, `dispose()` releases. Edits go through `SceneState` (`update`, `transaction`, `beginGesture`/`endGesture`): one undo step per action or gesture, validated before anything is applied. Revisions drive rendering and autosave; playback never changes them.
- **Saving** (`entities/registry.ts`, `scene/document.ts`, `entities/validation.ts`): an entity saves as JSON with a `type` tag (`entity.toJSON()`); `restoreEntity` picks the class from an allowlisted registry and the properties validate their values with the same Zod schemas the editor uses. `parseScene` keeps usable siblings, reports field paths and repairs the hierarchy. Scenes save as `{ version: 3, entities }`; versions 1 and 2 (`nodes` tagged with `kind`, a map as one node) still load. Old maps are expanded asynchronously before the scene is replaced (`maps/entities.ts`), and a failed conversion blocks autosave so the original save survives. History and duplication use the same JSON. Outfits are separate compact presets (`entities/character/outfits.ts`, made by `CharacterEntity.captureOutfit`).
- **Animation picker** (`src/lib/studio/preview/ClipPicker.svelte`, `clips.ts`): the Clip row in Properties and the clip control under the Toolbox preview open a searchable list instead of a plain dropdown. Character clips are grouped by the first `_` token of their name (Basic, Emotion, Ride, Music, the classes...; small prefixes fall into Other), every row shows the clip length, and a search matches all terms (`emotion kiss`). Click a clip to preview it, then press **Apply** (or Enter) to use it; **Cancel**, Esc or clicking away leaves things as they were. The preview plays on a small canvas of the picker's own, in Properties showing the selected character with its outfit or the selected NPC and in the Toolbox showing what the preview pane shows, so neither the scene nor the Toolbox pane changes until you apply. Clip lengths come from `/api/clips`, which reads each clip GLB's header once and caches the result in `.data/clips-<gender>.json` (the first request scans about 1,900 files and can take a while on a cold disk).
- **Colours** (`entities/character/tint.ts`): the same maths as the game's character pixel shaders (`MS2CharacterMaterial`, `...HairMaterial`, `...SkinMaterial`; read from the `ps_3_0` bytecode in `Shaders/PreGenerated/*.cache`): the `_c` texture is a mask, `tint = R*ch0 + G*ch1 + (1-R)*ch2` and `albedo = lerp(base, tint, mask.alpha)`, all in gamma space. Alpha is the recoloured region, red grades from the shade colour (ch2) to the main colour (ch0), green adds the accent (ch1) and blue is never read. A patched `MeshStandardMaterial` does it live and the GLB export bakes it into the diffuse texture. The skin parts of clothes (`CL_Skin`, `PA_Skin`, `GL_Skin`, `SH_Skin`...) use the body's colour masks (`m_body_c.png`, `f_skin_body_c.png`), so they take the character's skin colours instead of the item's palette colour and follow skin changes (`isSkinMask`, `CharacterRig.setSkinColors`). The body's own face is the one other masked part (its alpha is the irises): it takes the character's eye colour, an index into palette 3, the face items' colour palette (`eye` on the node and in saved outfits, `CharacterRig.setEyeColors`). A worn face item replaces it. All 189 face items share just two meshes (a male and a female face); what makes each face different is its texture set, the folder `item_face/<id without the leading 1>/` (10300002 -> `00300002/`) with one image per expression, so a worn face swaps the idle image (`01_idle`) and its eye mask (`02_idle_c`) onto the model (`entities/character/face.ts`; the head skin of the model keeps the body's skin texture). Faces take the character's eye colour, so they have no Colour set of their own. A few GM faces have no item-specific textures and keep their original idle look until their common face sequence loads. Items that allow the main and detail palette channels (`ch0`/`ch2` in the item XML `customize` block, indexed as `channels`; no item allows the accent `ch1`, which always follows the colour set) get a "Colour set" row plus a Main and a Detail picker in the Toolbox and Properties; picks are stored as `channelColors` on the node and in saved outfits.
- **Face expressions** (`character/face-animation.ts`, `/api/faces`): character faces follow the current clip's `textureani target="FA"` sequence from `Xml/emotion/common`, resolving the worn face's import in `Xml/emotion/item`. Frames swap the diffuse texture and eye mask together, using the skeletal player's time so speed, pause, scrubbing, and looping stay synchronized. Unmapped clips use the default face sequence. Properties > Appearance > Expression can override this with a static face (idle, blink, talk, attack, focus, pain, or one of the 21 gender-specific shared emote faces); Automatic restores clip-driven faces. Overrides survive scene JSON, autosave, duplication, and saved outfits, and are shown in character/item previews. GLB export bakes the current face frame and tint, not the texture-animation timeline.
- **Maps** (`src/lib/server/xblock.ts`, `src/lib/maps/`): insertion creates a group with ordinary editable prop children and one Lighting child (painted backdrop and distance fog). All resolved placements are included; there is no nearby-extraction step or 300-prop cap. Placement conversion remains cm, Z-up, degrees, Rz*Ry*Rx. `entity-batches.ts` shares static model parts with entity-to-instance picking, per-prop bounds and gizmo proxies; skinned/animated models render as ordinary props. Model loading is progressive and bounded. Large Explorer lists are windowed. Saves contain actual children and edits, not instructions to regenerate a map. Map provenance keeps whole imported groups out of GLB export by default; individual props can be exported.
- **Lighting**: the first effectively visible Lighting entity in depth-first sibling order supplies the environment, including an explicitly empty environment. Hidden ancestors disable it. View menu overrides apply afterward. Lighting has no geometry, bounds or transform gizmo; it does not decode game lights or 3D skyboxes.

Layout: `src/lib/{entities,scene,studio,assets,maps,export,server}`. Entities own their properties and rendering; scene coordinates the document; studio is grouped by editor feature. Routes are in `src/routes`, the index builder in `scripts/`.

### Code ownership

- `entities/`: `base.svelte.ts` owns common state, JSON and object lifecycle; `property.svelte.ts` owns validated reactive properties and editor metadata. Concrete entities keep their property declarations and rendering together. `rigged-model.svelte.ts` shares playback between characters and GLB models; `model.svelte.ts` also contains the small NPC subclass. `registry.ts` is the allowlisted restoration entry point, not an export barrel.
- `entities/character/`: character and item entities, rigging, face animation, tinting, appearance defaults and compact outfit persistence. Start at `character.svelte.ts` for character rendering, or `rig.ts` for low-level skeleton and dressing operations.
- `scene/`: collection transactions (`store.svelte.ts`), document loading and graph repair (`document.ts`), hierarchy queries (`tree.ts`), undo/redo (`history.ts`) and scene-wide rendering/picking/bounds/export coordination (`runtime.svelte.ts`). Per-entity rendering stays in the entity classes.
- `studio/`: the controller coordinates editor actions. UI code is colocated under `explorer/`, `properties/`, `toolbox/`, `preview/`, `viewport/`, `menus/` and `dialogs/`; `controls/` contains widgets shared by those features. Toolbox browsers, list navigation and incremental loading live together. Preview loading, canvases and the clip picker live together.
- `studio/viewport/`: the shared canvas/stage, camera controls, picking and gizmos. `fog.ts` owns fog colour and camera-distance math; `view-settings.ts` owns the editor's backdrop/fog overrides. Neither belongs in scene document persistence.
- `assets/` shares loading, clip discovery, playback and frame navigation. `maps/` owns map validation/composition and instancing; `export/` owns GLB export/baking; `server/` owns filesystem/index/XML access. `types.ts` is the shared API/index contract, not a home for editor-only types.

Dependencies flow from studio to scene/entities, and from entities to asset/domain helpers. Entities receive scene services through `entities/render-context.ts`; they do not import the studio controller, scene store/runtime or registry. The registry imports concrete classes, while shared entity types use type-only imports. Use direct imports rather than forwarding modules or barrel exports. Tests stay beside their owning code; `scene/testing.ts` is a test-only scene fixture helper.

Keep unit suites focused on the owning module: entity controls beside their entity class, schema checks beside the schema, and export/URL helpers beside their implementation. `entities/testing.ts` supplies test-only control/render contexts without constructing a scene. Cross-module contracts such as scene rendering, editable instance batches and map save conversion stay in explicit `*.integration.test.ts` suites; do not replace those interaction checks with disconnected unit assertions.

### Known gaps in the app

- Terrain (`PrecomputedTerrain/*.tok`), skyboxes, lighting and particle effects aren't decoded, so maps show props only.
- Faces use texture sequences, not morph targets. There is no held-weapon pose: weapons sit on their carry points unless you mount them on a hand bone yourself.
- Selection is a single node (no multi-select), bones can't be posed, and the Items preview shows an item at its own attach point even when a bone is selected to mount it on.
- Large maps keep every instance on the GPU; very big maps (like Tria) are slow on weak machines.
- The app has no authentication or sandboxing. It's meant to run locally.

## Extraction

The tools below produce `extracted/`, which the app reads.

## Layout of the game files

| Source                                                            | Format                                          | Handled by                     |
| ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------ |
| `Data/**/*.m2d` + `.m2h` (23 archives listed in `PackClient.ini`) | `MS2F` pack (AES-CTR + zlib, or XOR for movies) | `cmd/extract/extract.js`       |
| `Data/Sound/*.fsb`                                                | FMOD FSB5 banks                                 | `cmd/extract/convert-audio.sh` |
| `Custom/`, `Data/Shaders/`, `Data/Resource/gfx/`                  | loose files                                     | `cmd/extract/copy-loose.js`    |

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
nix shell nixpkgs#imagemagick --command bash cmd/extract/bg-thumbnails.sh                # backdrop PNG -> small JPEGs for the picker
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
- **Skies.** There are no 3D skyboxes. Each map's `Xml/mapxblock/<xblock>.xml` names a painted backdrop, `<clientProperty bgDay="BG_Tria.dds"/>` (an image in `Resource/Image/bg`, about 990x1024; 119 distinct ones are used, 283 maps have none), and distance fog, `<fog color="199,237,255" near="5276" far="20000"/>` (1,122 maps; 476 also have a `<heightfog>` layer, not used yet). The API puts them in a map's data (`environment`, `server/environment.ts`); the viewport draws the backdrop behind the transparent canvas and the fog in the scene, with the fog range moved by how far the camera is from its target (it is set for the game camera, about 1100 units away; the linear fog is an assumption). The map's `<hdr>` bloom, `<shadow>` and `<camera>` settings are not used.
- `extracted/converted/model-previews/` holds the PNG thumbnails stored in each NIF's header metadata (about 9.7k of the 28.6k NIFs have one).
- `.gfx` (Scaleform/SWF-like UI), `.tok` terrain, `.kfm` animation managers (transition tables) and `.fxo` shaders are left as raw extracted files.
- `GfxDebug` and `XmlDebug` archives are listed in `PackClient.ini` but not shipped.
- All 368 non-empty USMs and 51.6k DDS convert without failures, but the converted `Movie/Common` MP4s are **video-only**: ffmpeg can't decode the USM audio track and vgmstream can't open it either.
- Failures are logged to `convert-video.failed.log` / `convert-textures.failed.log`.
