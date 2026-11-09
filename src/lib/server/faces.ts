import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { FACE_EXPRESSIONS, type FaceAnimations, type FaceFrame, type FaceSequence } from '../character/expressions.js';
import { EXTRACTED_ROOT, resolveAssetPath } from './assets.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (name) => name === 'emotion' || name === 'texture' || name === 'anim' });
const cache = new Map<string, FaceAnimations>();
const TEXTURES = 'converted/textures/Resource/Model/Textures/';

/** Turn one emotion definition into clip-addressed face sequences. */
export function parseFaceAnimations(xml: string, itemCode: string, gender: 0 | 1): FaceAnimations {
  const data = parser.parse(xml) as {
    ms2?: { emotion?: { name?: string; anim?: { name?: string }[]; textureani?: { target?: string; texture?: { file?: string; control?: string; delay?: string; loop?: string }[] } }[] };
  };
  const frame = (file: string, control: string | undefined, duration: number | null): FaceFrame => ({
    base: TEXTURES + file.replaceAll('{0}', itemCode).replaceAll('\\', '/').replace(/\.dds$/i, '.png').toLowerCase(),
    mask: control ? TEXTURES + control.replaceAll('{0}', itemCode).replaceAll('\\', '/').replace(/\.dds$/i, '.png').toLowerCase() : null,
    duration
  });
  const sequences: Record<string, FaceSequence> = {};
  for (const emotion of data.ms2?.emotion ?? []) {
    if (emotion.textureani?.target !== 'FA') continue;
    const frames: FaceFrame[] = [];
    let loopStart: number | null = null;
    for (const texture of emotion.textureani.texture ?? []) {
      if (!texture.file) continue;
      if (texture.loop === 'true' && loopStart === null) loopStart = frames.length;
      const delay = texture.delay === undefined ? null : Number(texture.delay);
      if (delay !== null && (!Number.isFinite(delay) || delay < 0)) throw new Error('Invalid face frame delay');
      frames.push(frame(texture.file, texture.control, delay));
    }
    if (!frames.length) continue;
    const keys = (emotion.anim ?? []).flatMap((anim) => anim.name ? [anim.name] : []);
    if (!keys.length && emotion.name) keys.push(emotion.name);
    for (const key of keys) sequences[key.toLowerCase()] = { frames, loopStart };
  }
  const own = (base: string, mask: string) => frame(`item_face/${itemCode}/${base}.dds`, `item_face/${itemCode}/${mask}.dds`, null);
  const overrides: FaceAnimations['overrides'] = {
    idle: own('01_idle', '02_idle_c'),
    blink: own('05_blink2', '20_blink2_c'),
    talk: own('06_talk', '07_talk_c'),
    attack: own('11_attack', '12_attack_c'),
    focus: own('16_focus', '17_focus_c'),
    pain: own('18_pain', '19_pain_c')
  };
  for (const name of FACE_EXPRESSIONS) overrides[name] = frame(`item_face/${gender === 0 ? 'mc' : 'fc'}_face_${name}.dds`, '', null);
  return { sequences, overrides };
}

export function loadFaceAnimations(gender: 0 | 1, itemId?: string): FaceAnimations {
  const key = `${gender}:${itemId ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let common = gender === 0 ? 'malecustom' : 'femalecustom';
  let itemCode = gender === 0 ? '00300001' : '00300003';
  if (itemId) {
    const file = resolveAssetPath(`Xml/emotion/item/${itemId}.xml`, EXTRACTED_ROOT, ['xml/emotion']);
    if (!file) throw new Error(`Missing face definition for item ${itemId}`);
    const data = parser.parse(fs.readFileSync(file, 'utf8')) as { ms2?: { import?: { name?: string; itemCode?: string } } };
    const entry = data.ms2?.import;
    if (!entry?.name || !/^[\w-]+$/.test(entry.name)) throw new Error(`Unsupported face definition for item ${itemId}`);
    common = entry.name.toLowerCase();
    itemCode = entry.itemCode ?? '';
    if (itemCode && !/^\d{8}$/.test(itemCode)) throw new Error('Invalid face item code');
  }
  const source = resolveAssetPath(`Xml/emotion/common/${common}.xml`, EXTRACTED_ROOT, ['xml/emotion']);
  if (!source) throw new Error(`Missing face animation definition: ${common}`);
  const result = parseFaceAnimations(fs.readFileSync(source, 'utf8'), itemCode, gender);
  cache.set(key, result);
  return result;
}
