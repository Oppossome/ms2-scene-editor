// Hand-written parsers for the geometry-related blocks of MapleStory 2 NIFs (Gamebryo 30.x, nif.xml layout).
// Every parser returns the object and leaves reader.pos where it stopped, so callers can verify
// that pos === block.offset + block.size (the header's per-block size is an exact oracle).
const { Reader } = require("./header");

const FORMATS = {
  // id -> [componentType, bytesPerComponent, normalized]
  0x01: ["i8", 1, false], 0x05: ["u8", 1, false], 0x09: ["i8", 1, true], 0x0d: ["u8", 1, true],
  0x11: ["i16", 2, false], 0x15: ["u16", 2, false], 0x19: ["i16", 2, true], 0x1d: ["u16", 2, true],
  0x21: ["i32", 4, false], 0x25: ["u32", 4, false], 0x29: ["i32", 4, true], 0x2d: ["u32", 4, true],
  0x31: ["f16", 2, false], 0x35: ["f32", 4, false],
};

// Component format word: 0x00NNSSII -> N components, S bytes each, I id (the id counts up per component count).
function describeFormat(word) {
  const count = (word >>> 16) & 0xff;
  const size = (word >>> 8) & 0xff;
  const id = word & 0xff;
  // ids within a type group are consecutive (1..4 components), so the first id of the group is id - (count - 1)
  const base = id - (count - 1);
  const info = FORMATS[base];
  if (!info) return { word, count, size, type: "unknown", normalized: false, stride: count * size };
  return { word, count, size, type: info[0], normalized: info[2], stride: count * size };
}

function readObjectNET(r, h, o) {
  const nameIdx = r.i32();
  o.name = nameIdx >= 0 ? h.strings[nameIdx] : "";
  const n = r.u32();
  o.extraData = [];
  for (let i = 0; i < n; i++) o.extraData.push(r.i32());
  o.controller = r.i32();
}

function readAVObject(r, h, o) {
  readObjectNET(r, h, o);
  o.flags = r.u16();
  o.translation = [r.f32(), r.f32(), r.f32()];
  o.rotation = [];
  for (let i = 0; i < 9; i++) o.rotation.push(r.f32()); // row-major 3x3
  o.scale = r.f32();
  const np = r.u32();
  o.properties = [];
  for (let i = 0; i < np; i++) o.properties.push(r.i32());
  o.collisionObject = r.i32();
}

function parseNiNode(r, h) {
  const o = { type: "NiNode" };
  readAVObject(r, h, o);
  const nc = r.u32();
  o.children = [];
  for (let i = 0; i < nc; i++) o.children.push(r.i32());
  const ne = r.u32();
  o.effects = [];
  for (let i = 0; i < ne; i++) o.effects.push(r.i32());
  return o;
}

function parseNiMesh(r, h) {
  const o = { type: "NiMesh" };
  readAVObject(r, h, o);
  // NiRenderObject.MaterialData
  const numMaterials = r.u32();
  o.materialNames = [];
  for (let i = 0; i < numMaterials; i++) { const s = r.i32(); o.materialNames.push(s >= 0 ? h.strings[s] : ""); }
  r.pos += 4 * numMaterials; // material extra data
  o.activeMaterial = r.i32();
  r.u8(); // material needs update
  o.primitiveType = r.u32();
  o.numSubmeshes = r.u16();
  o.instancingEnabled = r.bool();
  o.bound = { center: [r.f32(), r.f32(), r.f32()], radius: r.f32() };
  const nds = r.u32();
  o.streams = [];
  for (let i = 0; i < nds; i++) {
    const s = { stream: r.i32(), perInstance: r.bool() };
    const nsub = r.u16();
    s.submeshToRegion = [];
    for (let j = 0; j < nsub; j++) s.submeshToRegion.push(r.u16());
    const nc = r.u32();
    s.semantics = [];
    for (let j = 0; j < nc; j++) {
      const nameIdx = r.i32();
      s.semantics.push({ name: nameIdx >= 0 ? h.strings[nameIdx] : "", index: r.u32() });
    }
    o.streams.push(s);
  }
  const nm = r.u32();
  o.modifiers = [];
  for (let i = 0; i < nm; i++) o.modifiers.push(r.i32());
  return o;
}

function parseNiDataStream(r, h, typeName) {
  const [, usage, access] = typeName.split("\x01");
  const o = { type: "NiDataStream", usage: Number(usage), access: Number(access) };
  o.numBytes = r.u32();
  o.cloning = r.u32();
  const nr = r.u32();
  o.regions = [];
  for (let i = 0; i < nr; i++) o.regions.push({ start: r.u32(), count: r.u32() });
  const nc = r.u32();
  o.formats = [];
  for (let i = 0; i < nc; i++) o.formats.push(describeFormat(r.u32()));
  o.data = r.bytes(o.numBytes);
  o.streamable = r.bool();
  return o;
}

function readTexDesc(r) {
  const d = { source: r.i32(), flags: r.u16(), maxAnisotropy: r.u16() };
  if (r.bool()) {
    d.transform = { translation: [r.f32(), r.f32()], scale: [r.f32(), r.f32()], rotation: r.f32(), method: r.u32(), center: [r.f32(), r.f32()] };
  }
  return d;
}

function parseNiTexturingProperty(r, h) {
  const o = { type: "NiTexturingProperty", textures: {} };
  readObjectNET(r, h, o);
  o.flags = r.u16();
  const count = r.u32();
  const slot = (name) => { if (r.bool()) o.textures[name] = readTexDesc(r); };
  slot("base"); slot("dark"); slot("detail"); slot("gloss"); slot("glow");
  if (count > 5 && r.bool()) {
    o.textures.bump = readTexDesc(r);
    r.pos += 4 + 4 + 16; // luma scale, luma offset, 2x2 matrix
  }
  if (count > 6) slot("normal");
  if (count > 7 && r.bool()) { o.textures.parallax = readTexDesc(r); r.pos += 4; }
  if (count > 8) slot("decal0");
  if (count > 9) slot("decal1");
  if (count > 10) slot("decal2");
  if (count > 11) slot("decal3");
  const ns = r.u32();
  o.shaderTextures = [];
  for (let i = 0; i < ns; i++) {
    if (r.bool()) { const map = readTexDesc(r); map.mapId = r.u32(); o.shaderTextures.push(map); } else o.shaderTextures.push(null);
  }
  return o;
}

function parseNiSourceTexture(r, h) {
  const o = { type: "NiSourceTexture" };
  readObjectNET(r, h, o);
  o.useExternal = r.u8();
  const fn = r.i32();
  o.fileName = fn >= 0 ? h.strings[fn] : "";
  o.pixelData = r.i32();
  r.pos += 12; // format prefs
  o.isStatic = r.u8();
  o.directRender = r.bool();
  o.persistRenderData = r.bool();
  return o;
}

function parseNiMaterialProperty(r, h) {
  const o = { type: "NiMaterialProperty" };
  readObjectNET(r, h, o);
  const v3 = () => [r.f32(), r.f32(), r.f32()];
  o.ambient = v3(); o.diffuse = v3(); o.specular = v3(); o.emissive = v3();
  o.glossiness = r.f32();
  o.alpha = r.f32();
  return o;
}

function parseNiAlphaProperty(r, h) {
  const o = { type: "NiAlphaProperty" };
  readObjectNET(r, h, o);
  o.flags = r.u16();
  o.threshold = r.u8();
  return o;
}

function readTransform(r) {
  const rotation = [];
  for (let i = 0; i < 9; i++) rotation.push(r.f32()); // row-major 3x3
  return { rotation, translation: [r.f32(), r.f32(), r.f32()], scale: r.f32() };
}

function parseNiSkinningMeshModifier(r, h) {
  const o = { type: "NiSkinningMeshModifier" };
  // NiMeshModifier base: submit and complete sync points
  const ns = r.u32(); r.pos += 2 * ns;
  const nc = r.u32(); r.pos += 2 * nc;
  o.flags = r.u16();
  o.skeletonRoot = r.i32();
  o.skeletonTransform = readTransform(r);
  const nb = r.u32();
  o.bones = [];
  for (let i = 0; i < nb; i++) o.bones.push(r.i32());
  o.boneTransforms = [];
  for (let i = 0; i < nb; i++) o.boneTransforms.push(readTransform(r));
  if (o.flags & 2) r.pos += 16 * nb; // bone bounds
  return o;
}

// ---- Animation (.kf) blocks ----
const str = (h, i) => (i >= 0 ? h.strings[i] : "");

function readEvaluatorBase(r, h, o) {
  o.nodeName = str(h, r.i32());
  o.propertyType = str(h, r.i32());
  o.controllerType = str(h, r.i32());
  o.controllerId = str(h, r.i32());
  o.interpolatorId = str(h, r.i32());
  o.channelTypes = [r.u8(), r.u8(), r.u8(), r.u8()];
}

// NiQuatTransform: translation, rotation (w,x,y,z), scale. FLT_MAX marks an unset component.
function readQuatTransform(r) {
  return { translation: [r.f32(), r.f32(), r.f32()], rotation: [r.f32(), r.f32(), r.f32(), r.f32()], scale: r.f32() };
}

function readKeyGroup(r, readValue) {
  const n = r.u32();
  const g = { interpolation: 0, keys: [] };
  if (n === 0) return g;
  g.interpolation = r.u32();
  for (let i = 0; i < n; i++) {
    const key = { time: r.f32(), value: readValue(r) };
    if (g.interpolation === 2) { readValue(r); readValue(r); } // forward/backward tangents
    if (g.interpolation === 3) r.pos += 12; // tension, bias, continuity
    g.keys.push(key);
  }
  return g;
}

function parseNiTransformData(r) {
  const o = { type: "NiTransformData" };
  const n = r.u32();
  o.rotationType = n ? r.u32() : 0;
  o.rotationKeys = [];
  o.xyzRotations = null;
  if (o.rotationType !== 4) {
    for (let i = 0; i < n; i++) {
      o.rotationKeys.push({ time: r.f32(), value: [r.f32(), r.f32(), r.f32(), r.f32()] });
      if (o.rotationType === 3) r.pos += 12;
    }
  } else {
    o.xyzRotations = [0, 1, 2].map(() => readKeyGroup(r, (rr) => rr.f32()));
  }
  o.translations = readKeyGroup(r, (rr) => [rr.f32(), rr.f32(), rr.f32()]);
  o.scales = readKeyGroup(r, (rr) => rr.f32());
  return o;
}

function parseNiTransformEvaluator(r, h) {
  const o = { type: "NiTransformEvaluator" };
  readEvaluatorBase(r, h, o);
  o.value = readQuatTransform(r);
  o.data = r.i32();
  return o;
}

function parseNiBSplineCompTransformEvaluator(r, h) {
  const o = { type: "NiBSplineCompTransformEvaluator" };
  readEvaluatorBase(r, h, o);
  o.startTime = r.f32();
  o.endTime = r.f32();
  o.data = r.i32();
  o.basis = r.i32();
  o.value = readQuatTransform(r);
  o.translationHandle = r.u32();
  o.rotationHandle = r.u32();
  o.scaleHandle = r.u32();
  o.translationOffset = r.f32(); o.translationHalfRange = r.f32();
  o.rotationOffset = r.f32(); o.rotationHalfRange = r.f32();
  o.scaleOffset = r.f32(); o.scaleHalfRange = r.f32();
  return o;
}

function parseNiBSplineData(r) {
  const o = { type: "NiBSplineData" };
  const nf = r.u32();
  o.floats = new Float32Array(nf);
  for (let i = 0; i < nf; i++) o.floats[i] = r.f32();
  const nc = r.u32();
  o.compact = new Int16Array(nc);
  for (let i = 0; i < nc; i++) { o.compact[i] = r.buf.readInt16LE(r.pos); r.pos += 2; }
  return o;
}

function parseNiBSplineBasisData(r) {
  return { type: "NiBSplineBasisData", numControlPoints: r.u32() };
}

function parseNiTextKeyExtraData(r, h) {
  const o = { type: "NiTextKeyExtraData", name: str(h, r.i32()), keys: [] };
  const n = r.u32();
  for (let i = 0; i < n; i++) o.keys.push({ time: r.f32(), text: str(h, r.i32()) });
  return o;
}

function parseNiSequenceData(r, h) {
  const o = { type: "NiSequenceData", name: str(h, r.i32()), evaluators: [] };
  const n = r.u32();
  for (let i = 0; i < n; i++) o.evaluators.push(r.i32());
  o.textKeys = r.i32();
  o.duration = r.f32();
  o.cycleType = r.u32();
  o.frequency = r.f32();
  o.accumRootName = str(h, r.i32());
  o.accumFlags = r.u32();
  return o;
}

const PARSERS = {
  NiTransformData: parseNiTransformData,
  NiTransformEvaluator: parseNiTransformEvaluator,
  NiBSplineCompTransformEvaluator: parseNiBSplineCompTransformEvaluator,
  NiBSplineData: parseNiBSplineData,
  NiBSplineBasisData: parseNiBSplineBasisData,
  NiTextKeyExtraData: parseNiTextKeyExtraData,
  NiSequenceData: parseNiSequenceData, NiSkinningMeshModifier: parseNiSkinningMeshModifier, NiNode: parseNiNode, NiMesh: parseNiMesh, NiTexturingProperty: parseNiTexturingProperty, NiSourceTexture: parseNiSourceTexture, NiMaterialProperty: parseNiMaterialProperty, NiAlphaProperty: parseNiAlphaProperty };

function parseBlock(buf, h, block) {
  const r = new Reader(buf, block.offset);
  const baseType = block.type.split("\x01")[0];
  let obj;
  if (baseType === "NiDataStream") obj = parseNiDataStream(r, h, block.type);
  else if (PARSERS[baseType]) obj = PARSERS[baseType](r, h);
  else return null;
  obj.consumed = r.pos - block.offset;
  return obj;
}

module.exports = { parseBlock, describeFormat };
