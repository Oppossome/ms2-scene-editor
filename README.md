# MS2SceneEditor

> **AI disclaimer:** This project was made with the heavy assistance of AI. Review the code and behaviour before relying on it.

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

## Docker

The `Dockerfile` builds a production image. The game's files are not in the image. Mount your extracted folder at `/extracted`:

```sh
docker build -t ms2sceneeditor .
docker run --rm -p 3000:3000 -v /path/to/extracted:/extracted:ro -v ms2se-data:/data ms2sceneeditor
```

Then open http://localhost:3000. The first start builds the indexes into `/data`.

## Documentation

[AGENTS.md](./AGENTS.md) has the detailed notes: how the app and the extraction pipeline work, the file layout, model format details and known gaps. It is written for contributors and coding agents.
