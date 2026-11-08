#!/usr/bin/env node
// NIF (MapleStory 2, Gamebryo 30.2.0.3) -> binary glTF (.glb).
// Usage: node cmd/extract/nif/to-gltf.js <in.nif> <out.glb> [--include-hidden] [--external-textures] [--animations]
// Handles the scene graph, static geometry (positions, normals, UV0, vertex colours), materials and textures.
// Skinning, morph targets and animation are not exported yet.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Reader, parseHeader } = require("./header");
const { parseBlock } = require("./parse");
const { loadClip } = require("./animation");

const TEXTURE_ROOT = path.resolve(__dirname, "../../../extracted/converted/textures/Resource/Model");
const MODEL_ROOT = path.resolve(__dirname, "../../../extracted/Resource/Model");
const HIDDEN_FLAG = 0x1;

let textureIndex = null;
function buildTextureIndex() {
  const index = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.toLowerCase().endsWith(".png")) {
        const key = e.name.toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(full);
      }
    }
  };
  if (fs.existsSync(TEXTURE_ROOT)) walk(TEXTURE_ROOT);
  return index;
}

function resolveTexture(fileName, nifPath) {
  textureIndex ||= buildTextureIndex();
  const key = path.basename(fileName.replace(/\\/g, "/")).toLowerCase().replace(/\.[^.]+$/, ".png");
  const candidates = textureIndex.get(key);
  if (!candidates) return null;
  if (candidates.length === 1) return candidates[0];
  // Duplicate basenames: prefer textures from the model's own category (Model/<Category>/...), then the shared
  // Textures folder family that matches the category.
  const category = path.relative(MODEL_ROOT, nifPath).split(path.sep)[0];
  const hint = { Npc: "npc_", Effect: "effect", Map: "bg_map" }[category] || "item_";
  const score = (c) => {
    const rel = path.relative(TEXTURE_ROOT, c).split(path.sep);
    if (rel[0] === category) return 3;
    if (rel[0] === "Textures" && rel[1].startsWith(hint)) return 2;
    return rel[0] === "Textures" ? 1 : 0;
  };
  return candidates.slice().sort((a, b) => score(b) - score(a) || a.length - b.length)[0];
}

const COMPONENT = { u8: [5121, 1], u16: [5123, 2], u32: [5125, 4], f32: [5126, 4], i8: [5120, 1], i16: [5122, 2] };

class GlbBuilder {
  constructor(outDir) {
    this.outDir = outDir; // when set, images are referenced by relative URI instead of embedded
    this.json = { asset: { version: "2.0", generator: "BannedStory2 nif->glTF" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
    this.chunks = [];
    this.length = 0;
    this.imageCache = new Map();
    this.materialCache = new Map();
  }

  addBufferView(data, target) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.length += pad; }
    const view = { buffer: 0, byteOffset: this.length, byteLength: data.byteLength };
    if (target) view.target = target;
    this.chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    this.length += data.byteLength;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
  }

  addAccessor(typedArray, componentType, type, target, extra = {}) {
    const view = this.addBufferView(typedArray, target);
    const count = typedArray.length / { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    this.json.accessors.push({ bufferView: view, componentType, count, type, ...extra });
    return this.json.accessors.length - 1;
  }

  addImage(file) {
    if (this.imageCache.has(file)) return this.imageCache.get(file);
    if (this.outDir) {
      const uri = path.relative(this.outDir, file).split(path.sep).map(encodeURIComponent).join("/");
      this.json.images.push({ uri, name: path.basename(file) });
    } else {
      const data = fs.readFileSync(file);
      const view = this.addBufferView(new Uint8Array(data.buffer, data.byteOffset, data.length));
      this.json.images.push({ bufferView: view, mimeType: "image/png", name: path.basename(file) });
    }
    this.json.textures.push({ source: this.json.images.length - 1, sampler: 0 });
    const id = this.json.textures.length - 1;
    this.imageCache.set(file, id);
    return id;
  }

  finish() {
    this.json.buffers[0].byteLength = this.length;
    const bin = Buffer.concat(this.chunks);
    const binPad = (4 - (bin.length % 4)) % 4;
    const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
    let jsonStr = JSON.stringify(this.json);
    jsonStr += " ".repeat((4 - (Buffer.byteLength(jsonStr) % 4)) % 4);
    const jsonBuf = Buffer.from(jsonStr);
    const header = Buffer.alloc(12);
    header.write("glTF", 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binChunk.length, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.write("JSON", 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(binChunk.length, 0); bh.write("BIN\0", 4);
    return Buffer.concat([header, jh, jsonBuf, bh, binChunk]);
  }
}

function readComponent(buf, off, type) {
  switch (type) {
    case "f32": return buf.readFloatLE(off);
    case "u16": return buf.readUInt16LE(off);
    case "u32": return buf.readUInt32LE(off);
    case "u8": return buf[off];
    case "i16": return buf.readInt16LE(off);
    case "i8": return buf.readInt8(off);
    default: throw new Error("unsupported component type " + type);
  }
}

// Returns {values (typed array), count, comps, type} for one semantic of one submesh, or null.
function extractAttribute(ctx, mesh, semantic, semIndex, submesh) {
  for (const ref of mesh.streams) {
    const ds = ctx(ref.stream);
    if (!ds || ds.type !== "NiDataStream") continue;
    let compIdx = -1;
    for (let i = 0; i < ref.semantics.length; i++) if (ref.semantics[i].name === semantic && ref.semantics[i].index === semIndex) compIdx = i;
    if (compIdx < 0) continue;
    const stride = ds.formats.reduce((a, f) => a + f.stride, 0);
    let compOffset = 0;
    for (let i = 0; i < compIdx; i++) compOffset += ds.formats[i].stride;
    const fmt = ds.formats[compIdx];
    const region = ds.regions[ref.submeshToRegion[submesh] ?? 0] || { start: 0, count: Math.floor(ds.numBytes / stride) };
    const count = region.count;
    const arrayType = fmt.type === "f32" ? Float32Array : fmt.type === "u16" ? Uint16Array : fmt.type === "u32" ? Uint32Array : fmt.type === "u8" ? Uint8Array : fmt.type === "i16" ? Int16Array : Int8Array;
    const out = new arrayType(count * fmt.count);
    for (let e = 0; e < count; e++) {
      for (let c = 0; c < fmt.count; c++) out[e * fmt.count + c] = readComponent(ds.data, (region.start + e) * stride + compOffset + c * fmt.size, fmt.type);
    }
    return { values: out, count, comps: fmt.count, fmt };
  }
  return null;
}

// Row-major 3x3 rotation (v' = R v) -> quaternion [x, y, z, w].
function matToQuat(m) {
  const t = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

function findKfFiles(nifPath) {
  const dir = path.dirname(nifPath);
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".kf")).sort().map((f) => path.join(dir, f));
}

// options.animations: array of .kf paths to embed. options.skeletonOnly: emit only the node hierarchy (no meshes), used for per-clip files.
function convert(nifPath, { includeHidden = false, externalTexturesFrom = null, animations = [], skeletonOnly = false } = {}) {
  const buf = fs.readFileSync(nifPath);
  const h = parseHeader(buf);
  const cache = new Map();
  const get = (i) => {
    if (i < 0 || i >= h.blocks.length) return null;
    if (!cache.has(i)) cache.set(i, parseBlock(buf, h, h.blocks[i]));
    return cache.get(i);
  };
  const fr = new Reader(buf, h.end);
  const numRoots = fr.u32();
  const roots = [];
  for (let i = 0; i < numRoots; i++) roots.push(fr.i32());

  // Bones (and all their ancestors) must survive pruning and the hidden-flag filter so skins can reference them.
  const parentOf = new Map();
  h.blocks.forEach((b, i) => { if (b.type === "NiNode") for (const c of get(i).children) if (c >= 0) parentOf.set(c, i); });
  const skinModifierOf = (mesh) => mesh.modifiers.map(get).find((m) => m && m.type === "NiSkinningMeshModifier");
  const required = new Set();
  h.blocks.forEach((b, i) => {
    if (b.type !== "NiMesh") return;
    const mod = skinModifierOf(get(i));
    if (!mod) return;
    for (const bone of [mod.skeletonRoot, ...mod.bones]) {
      for (let x = bone; x !== undefined && x >= 0 && !required.has(x); x = parentOf.get(x)) required.add(x);
    }
  });
  // Skeleton files keep every node: empty dummies (Weapon_*_Point, HR, CP, ...) are attachment points for items.
  if (skeletonOnly || required.size > 0) h.blocks.forEach((b, i) => { if (b.type === "NiNode") required.add(i); });
  const nodeMap = new Map();
  const nodeByName = new Map();
  const pendingSkins = [];

  const glb = new GlbBuilder(externalTexturesFrom);
  const stats = { meshes: 0, primitives: 0, skippedHidden: 0, skippedNoGeometry: 0, textures: 0, missingTextures: [], skinned: 0 };

  function materialFor(mesh) {
    let mat = null, tex = null, alpha = null;
    for (const ref of mesh.properties) {
      const p = get(ref);
      if (!p) continue;
      if (p.type === "NiMaterialProperty") mat = p;
      else if (p.type === "NiTexturingProperty") tex = p;
      else if (p.type === "NiAlphaProperty") alpha = p;
    }
    const key = [mat && mat.name, tex && JSON.stringify(tex.textures), alpha && alpha.flags + ":" + alpha.threshold, mat && mat.diffuse.join(), mat && mat.alpha].join("|");
    if (glb.materialCache.has(key)) return glb.materialCache.get(key);
    const m = { name: (mat && mat.name) || "material", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true };
    if (mat) m.pbrMetallicRoughness.baseColorFactor = [...mat.diffuse, mat.alpha].map((v) => Math.min(1, Math.max(0, v))); // effects use values above 1 as intensity, which glTF does not allow
    if (alpha) {
      if (alpha.flags & 1) m.alphaMode = "BLEND";
      else if (alpha.flags & 0x200) { m.alphaMode = "MASK"; m.alphaCutoff = alpha.threshold / 255; }
    }
    const texPath = (desc) => {
      const src = desc && get(desc.source);
      if (!src || src.type !== "NiSourceTexture" || !src.fileName) return null;
      const file = resolveTexture(src.fileName, nifPath);
      if (!file) { stats.missingTextures.push(src.fileName); return null; }
      return file;
    };
    const texFile = (desc) => {
      const file = texPath(desc);
      if (!file) return null;
      stats.textures++;
      return glb.addImage(file);
    };
    if (tex) {
      const base = texFile(tex.textures.base);
      if (base != null) m.pbrMetallicRoughness.baseColorTexture = { index: base };
      const normal = texFile(tex.textures.normal);
      if (normal != null) m.normalTexture = { index: normal };
      // Other Gamebryo slots have no glTF equivalent. With external textures they are listed as relative URIs in
      // extras.ms2 so a viewer can build its own shader (the colour mask under "shader0" selects the tint channels).
      if (glb.outDir) {
        const ms2 = {};
        for (const slot of ["gloss", "glow", "detail", "dark", "decal0", "decal1", "bump"]) {
          const file = texPath(tex.textures[slot]);
          if (file) ms2[slot] = path.relative(glb.outDir, file).split(path.sep).map(encodeURIComponent).join("/");
        }
        tex.shaderTextures.forEach((desc, i) => {
          const file = texPath(desc);
          if (file) ms2["shader" + i] = path.relative(glb.outDir, file).split(path.sep).map(encodeURIComponent).join("/");
        });
        if (Object.keys(ms2).length) m.extras = { ms2 };
      }
    }
    glb.json.materials.push(m);
    const id = glb.json.materials.length - 1;
    glb.materialCache.set(key, id);
    return id;
  }

  function buildMesh(mesh) {
    const primitives = [];
    const mode = { 0: 4, 1: 5, 2: 1, 3: 3, 5: 0 }[mesh.primitiveType];
    if (mode === undefined) { stats.skippedNoGeometry++; return null; }
    const material = materialFor(mesh);
    const skinMod = skinModifierOf(mesh);
    if (skinMod) stats.skinned++;
    for (let s = 0; s < mesh.numSubmeshes; s++) {
      const idx = extractAttribute(get, mesh, "INDEX", 0, s);
      const bp = skinMod ? extractAttribute(get, mesh, "POSITION_BP", 0, s) : null;
      const pos = bp || extractAttribute(get, mesh, "POSITION", 0, s) || extractAttribute(get, mesh, "POSITION_BP", 0, s);
      if (!idx || !pos || pos.comps !== 3) { stats.skippedNoGeometry++; continue; }
      const attrs = {};
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.count; i++) for (let c = 0; c < 3; c++) { const v = pos.values[i * 3 + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
      attrs.POSITION = glb.addAccessor(pos.values, 5126, "VEC3", 34962, { min, max });
      const nrm = (bp && extractAttribute(get, mesh, "NORMAL_BP", 0, s)) || extractAttribute(get, mesh, "NORMAL", 0, s) || extractAttribute(get, mesh, "NORMAL_BP", 0, s);
      if (skinMod && bp) {
        const bi = extractAttribute(get, mesh, "BLENDINDICES", 0, s);
        const bw = extractAttribute(get, mesh, "BLENDWEIGHT", 0, s);
        const palette = extractAttribute(get, mesh, "BONE_PALETTE", 0, s);
        if (bi && bw && bi.count === pos.count && bw.count === pos.count) {
          const joints = new Uint16Array(pos.count * 4), weights = new Float32Array(pos.count * 4);
          for (let v = 0; v < pos.count; v++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
              const local = bi.values[v * bi.comps + k];
              joints[v * 4 + k] = palette ? (palette.values[local] ?? 0) : local;
              const w = k < bw.comps ? bw.values[v * bw.comps + k] : 0;
              weights[v * 4 + k] = w;
              sum += w;
            }
            if (bw.comps === 3) { weights[v * 4 + 3] = Math.max(0, 1 - sum); sum += weights[v * 4 + 3]; }
            // glTF forbids repeating a joint among a vertex's non-zero weights, so merge duplicates and zero out unused slots.
            const merged = new Map();
            for (let k = 0; k < 4; k++) if (weights[v * 4 + k] > 0) merged.set(joints[v * 4 + k], (merged.get(joints[v * 4 + k]) || 0) + weights[v * 4 + k]);
            const sorted = [...merged].sort((a, b) => b[1] - a[1]);
            for (let k = 0; k < 4; k++) {
              joints[v * 4 + k] = sorted[k] ? sorted[k][0] : 0;
              weights[v * 4 + k] = sorted[k] ? sorted[k][1] : 0;
            }
            if (sum > 0) for (let k = 0; k < 4; k++) weights[v * 4 + k] /= sum;
          }
          attrs.JOINTS_0 = glb.addAccessor(joints, 5123, "VEC4", 34962);
          attrs.WEIGHTS_0 = glb.addAccessor(weights, 5126, "VEC4", 34962);
        }
      }
      if (nrm && nrm.comps === 3 && nrm.fmt.type === "f32" && nrm.count === pos.count) attrs.NORMAL = glb.addAccessor(nrm.values, 5126, "VEC3", 34962);
      const uv = extractAttribute(get, mesh, "TEXCOORD", 0, s);
      if (uv && uv.comps === 2 && uv.fmt.type === "f32" && uv.count === pos.count) attrs.TEXCOORD_0 = glb.addAccessor(uv.values, 5126, "VEC2", 34962);
      const col = extractAttribute(get, mesh, "COLOR", 0, s);
      if (col && col.comps === 4 && col.fmt.type === "u8" && col.count === pos.count) attrs.COLOR_0 = glb.addAccessor(col.values, 5121, "VEC4", 34962, { normalized: true });
      const indexValues = idx.fmt.type === "u32" ? idx.values : idx.values;
      let maxIndex = 0;
      for (let i = 0; i < indexValues.length; i++) if (indexValues[i] > maxIndex) maxIndex = indexValues[i];
      if (maxIndex >= pos.count) { stats.skippedNoGeometry++; stats.indexOutOfRange = (stats.indexOutOfRange || 0) + 1; continue; }
      const indices = glb.addAccessor(indexValues, idx.fmt.type === "u32" ? 5125 : 5123, "SCALAR", 34963);
      primitives.push({ attributes: attrs, indices, mode, material });
      stats.primitives++;
    }
    return primitives.length ? primitives : null;
  }

  function buildNode(i) {
    const o = get(i);
    if (!o || (o.type !== "NiNode" && o.type !== "NiMesh")) return null;
    if (!includeHidden && (o.flags & HIDDEN_FLAG) && !required.has(i)) { stats.skippedHidden++; return null; }
    const node = { name: o.name || undefined };
    // TRS (not a matrix) so animation channels can target the node.
    if (o.translation.some((v) => Math.abs(v) > 1e-6)) node.translation = o.translation;
    const q = matToQuat(o.rotation);
    if (Math.abs(q[0]) > 1e-6 || Math.abs(q[1]) > 1e-6 || Math.abs(q[2]) > 1e-6 || Math.abs(q[3] - 1) > 1e-6) node.rotation = q;
    if (Math.abs(o.scale - 1) > 1e-6) node.scale = [o.scale, o.scale, o.scale];
    if (o.type === "NiMesh" && skeletonOnly) return null;
    if (o.type === "NiMesh") {
      stats.meshes++;
      const prims = buildMesh(o);
      if (!prims) return null;
      glb.json.meshes.push({ name: o.name || undefined, primitives: prims });
      node.mesh = glb.json.meshes.length - 1;
      const mod = skinModifierOf(o);
      if (mod && prims.some((pr) => pr.attributes.JOINTS_0 !== undefined)) pendingSkins.push({ node, mod });
    } else {
      const kids = o.children.map(buildNode).filter((k) => k != null);
      if (kids.length === 0 && !required.has(i)) return null;
      if (kids.length) node.children = kids;
    }
    glb.json.nodes.push(node);
    nodeMap.set(i, glb.json.nodes.length - 1);
    if (o.name && !nodeByName.has(o.name)) nodeByName.set(o.name, glb.json.nodes.length - 1);
    return glb.json.nodes.length - 1;
  }

  const sceneRoots = roots.map(buildNode).filter((n) => n != null);

  for (const { node, mod } of pendingSkins) {
    const joints = mod.bones.map((b) => nodeMap.get(b));
    if (joints.some((j) => j === undefined)) { stats.skinsMissingBones = (stats.skinsMissingBones || 0) + 1; continue; }
    const ibm = new Float32Array(joints.length * 16);
    mod.boneTransforms.forEach((t, k) => {
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) ibm[k * 16 + col * 4 + row] = t.rotation[row * 3 + col] * t.scale;
      ibm[k * 16 + 12] = t.translation[0]; ibm[k * 16 + 13] = t.translation[1]; ibm[k * 16 + 14] = t.translation[2]; ibm[k * 16 + 15] = 1;
    });
    (glb.json.skins ||= []).push({ joints, inverseBindMatrices: glb.addAccessor(ibm, 5126, "MAT4") });
    node.skin = glb.json.skins.length - 1;
  }
  if (animations.length) {
    const multiModelDir = fs.readdirSync(path.dirname(nifPath)).filter((f) => f.toLowerCase().endsWith(".nif")).length > 1;
    const timeAccessors = new Map();
    const inputFor = (times) => {
      const key = crypto.createHash("md5").update(Buffer.from(times.buffer, times.byteOffset, times.byteLength)).digest("hex");
      if (!timeAccessors.has(key)) timeAccessors.set(key, glb.addAccessor(times, 5126, "SCALAR", undefined, { min: [times[0]], max: [times[times.length - 1]] }));
      return timeAccessors.get(key);
    };
    stats.animations = 0;
    for (const kf of animations) {
      let clip;
      try { clip = loadClip(kf); } catch (e) { (stats.animationErrors ||= []).push(path.basename(kf) + ": " + e.message); continue; }
      if (!clip) continue;
      const usable = clip.channels.filter((c) => nodeByName.has(c.nodeName));
      if (usable.length === 0) continue;
      if (multiModelDir && usable.length < clip.channels.length * 0.5) continue; // clip belongs to a different model in this folder
      const samplers = [], channels = [];
      for (const c of usable) {
        let values = c.values;
        if (c.path === "scale") { // node scale is VEC3 in glTF; Gamebryo scale is uniform
          values = new Float32Array(c.values.length * 3);
          for (let i = 0; i < c.values.length; i++) values[i * 3] = values[i * 3 + 1] = values[i * 3 + 2] = c.values[i];
        }
        const sampler = samplers.length;
        samplers.push({ input: inputFor(c.times), output: glb.addAccessor(values, 5126, c.path === "rotation" ? "VEC4" : "VEC3"), interpolation: "LINEAR" });
        channels.push({ sampler, target: { node: nodeByName.get(c.nodeName), path: c.path } });
      }
      (glb.json.animations ||= []).push({ name: clip.name, samplers, channels, extras: { duration: clip.duration, loop: clip.cycleType === 0, textKeys: clip.textKeys } });
      stats.animations++;
      stats.droppedChannels = (stats.droppedChannels || 0) + (clip.channels.length - usable.length);
    }
  }

  // Gamebryo is Z-up; glTF is Y-up, so wrap everything in a -90 degree rotation about X.
  glb.json.nodes.push({ name: "zup_to_yup", matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1], children: sceneRoots });
  glb.json.scenes[0].nodes = [glb.json.nodes.length - 1];
  for (const k of ["meshes", "materials", "textures", "images", "accessors", "bufferViews"]) if (glb.json[k].length === 0) delete glb.json[k];
  if (!glb.json.textures) delete glb.json.samplers;
  return { glb: glb.finish(), stats };
}

module.exports = { convert, findKfFiles };

if (require.main === module) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const external = process.argv.includes("--external-textures");
  const withAnimations = process.argv.includes("--animations");
  const { glb, stats } = convert(args[0], { includeHidden: process.argv.includes("--include-hidden"), externalTexturesFrom: external ? path.dirname(path.resolve(args[1])) : null, animations: withAnimations ? findKfFiles(args[0]) : [] });
  fs.mkdirSync(path.dirname(path.resolve(args[1])), { recursive: true });
  fs.writeFileSync(args[1], glb);
  console.log(`${args[1]}: ${glb.length} bytes`, { ...stats, missingTextures: stats.missingTextures.slice(0, 5) });
}
