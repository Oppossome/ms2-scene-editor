// Minimal Gamebryo NIF header reader for MapleStory 2 files (20.9.0.0 / 20.9.0.1).
// 20.9.0.1 files carry a thumbnail chunk (u32 total size, then that many bytes) between the block count and the block type table.

class Reader {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }
  u8() {
    return this.buf[this.pos++];
  }
  u16() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  f32() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  bool() {
    return this.u8() !== 0;
  }
  bytes(n) {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  sizedString() {
    const n = this.u32();
    return this.bytes(n).toString('latin1');
  }
}

function parseHeader(buf) {
  const eol = buf.indexOf(0x0a);
  const magic = buf.toString('latin1', 0, eol);
  if (!magic.startsWith('Gamebryo File Format')) throw new Error('not a NIF: ' + magic.slice(0, 30));
  const r = new Reader(buf, eol + 1);
  const version = r.u32();
  const endian = r.u8();
  const userVersion = r.u32();
  const numBlocks = r.u32();
  let thumbnail = null;
  if (version >= 0x1e000000) {
    // Metadata ByteArray (since 30.0.0.0)
    r.bytes(r.u32());
  } else if (magic.endsWith('20.9.0.1')) {
    const total = r.u32();
    if (total > 0) thumbnail = r.bytes(total);
  }
  const numTypes = r.u16();
  const types = [];
  for (let i = 0; i < numTypes; i++) types.push(r.sizedString());
  const blockTypeIndex = [];
  for (let i = 0; i < numBlocks; i++) blockTypeIndex.push(r.u16() & 0x7fff);
  const blockSizes = [];
  for (let i = 0; i < numBlocks; i++) blockSizes.push(r.u32());
  const numStrings = r.u32();
  const maxStringLength = r.u32();
  const strings = [];
  for (let i = 0; i < numStrings; i++) strings.push(r.sizedString());
  const numGroups = r.u32();
  const groups = [];
  for (let i = 0; i < numGroups; i++) groups.push(r.u32());

  const blocks = [];
  let offset = r.pos;
  for (let i = 0; i < numBlocks; i++) {
    blocks.push({ index: i, type: types[blockTypeIndex[i]], size: blockSizes[i], offset });
    offset += blockSizes[i];
  }
  return {
    magic,
    version,
    endian,
    userVersion,
    numBlocks,
    thumbnail,
    types,
    strings,
    maxStringLength,
    groups,
    blocks,
    dataStart: r.pos,
    end: offset
  };
}

module.exports = { Reader, parseHeader };
