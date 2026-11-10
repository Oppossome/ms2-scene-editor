# MS2SceneEditor

> **AI disclaimer:** This project was made with the heavy assistance of AI. Review the code and behaviour before relying on it.

<img width="2429" height="1833" alt="image" src="https://github.com/user-attachments/assets/59ea5617-95fb-4974-a02e-927a86cb5987" />

MS2SceneEditor is a local toolset for MapleStory 2, the Nexon game that has been discontinued. It has two parts:

- **Extraction tools** (`cmd/extract/`) that unpack the game's files from a Steam install and convert them to open formats (GLB models, PNG textures, OGG audio, MP4 video).
- **A scene editor** (`src/`), a SvelteKit app that works like a Roblox-style studio. You can build scenes from game props, NPCs, maps and characters, dress characters in items, pose them with animations, and export the result as JSON or GLB.

This is an unofficial fan project. It is not affiliated with or endorsed by Nexon.

## Assets

The game's files are not included. The editor reads the copies you extract from your own installation, and the extracted assets are copyrighted. Use them for personal use only and don't redistribute them.

## Getting started

1. Extract and convert the assets from your game install. See [AGENTS.md](./AGENTS.md#usage) for the commands.
2. Run the editor locally:

   ```sh
   npm install
   npm run index   # builds the search indexes from the extracted files
   npm run dev     # http://localhost:5173
   ```

Node isn't installed globally on every machine, so the repo's `shell.nix` provides Node plus the converters the extraction scripts use (ffmpeg, vgmstream, ImageMagick). With Nix, run `nix-shell` first, or prefix commands with `nix shell nixpkgs#nodejs --command`.

## Development checks

- `npm run lint` checks JavaScript, TypeScript and Svelte with ESLint; `npm run lint:fix` applies safe automatic fixes.
- `npm run format:check` checks formatting; `npm run format` formats supported source, configuration and documentation files with Prettier.
- `npm run check`, `npm test` and `npm run build` check types, run tests and build the app.

CI runs all checks. Generated output, extracted game assets and vendored code are excluded from linting and formatting.

## Docker

The `Dockerfile` builds a production image. The game's files are not in the image. Mount your extracted folder at `/extracted`:

```sh
docker build -t ms2sceneeditor .
docker run --rm -p 3000:3000 -v /path/to/extracted:/extracted:ro -v ms2se-data:/data ms2sceneeditor
```

Then open http://localhost:3000. The first start builds the indexes into `/data`.

## Documentation

Maps insert as editable groups of props, with a **Lighting** child for the painted backdrop and distance fog. Select props directly to move, hide, delete or export them; compatible static props remain instanced. The first visible Lighting entity in tree order controls the scene environment, beneath the View menu overrides.

Viewport clicks skip entities that are locked or have a locked ancestor. Hold **Ctrl** to select them anyway, including when right-clicking for the context menu; **Alt+click** selects the top-level ancestor and can be combined with Ctrl. Hidden entities remain unselectable in the viewport.

**WASDQE** moves only the view under the mouse, including Toolbox and animation previews. When the mouse is outside every view, it moves the main viewport instead.

Scene saves now use version 3 (each entity tagged with its `type`). Existing version-1 and 2 scenes and outfits still load; old maps are converted before the scene is replaced. Conversion requires the original map assets, and a failed conversion preserves the original autosave. Whole imported maps remain omitted from GLB export by default.

Code is organized by ownership: [entities](./src/lib/entities/) own properties, persistence and rendering, with [character functionality](./src/lib/entities/character/) kept together; [scene](./src/lib/scene/) coordinates documents and transactions; [studio](./src/lib/studio/) groups UI by editor feature. Asset loading, maps, export and server access remain shared services. Tests live beside their owning modules.

[AGENTS.md](./AGENTS.md) has the detailed notes: how the app and the extraction pipeline work, the file layout, model format details and known gaps. It is written for contributors and coding agents.
