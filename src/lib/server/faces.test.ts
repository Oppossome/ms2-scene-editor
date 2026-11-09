import { describe, expect, it } from 'vitest';
import { parseFaceAnimations } from './faces.js';

describe('parseFaceAnimations', () => {
  it('maps animation names to face frames, masks, and loop markers', () => {
    const result = parseFaceAnimations(`<ms2>
      <emotion name="different_name"><anim name="Emotion_Test_A"/>
        <textureani target="FA">
          <texture file="Item_Face/{0}/01_Idle.dds" control="Item_Face/{0}/02_Idle_C.dds" delay="100"/>
          <texture file="Item_Face/FC_face_smile.dds" control="" delay="200" loop="true"/>
        </textureani>
      </emotion>
      <emotion name="default"><anim name=""/><textureani target="FA">
        <texture file="Item_Face/{0}/01_Idle.dds" control=""/>
      </textureani></emotion>
    </ms2>`, '00300003', 1);
    expect(result.sequences.emotion_test_a).toEqual({
      frames: [
        { base: expect.stringContaining('/00300003/01_idle.png'), mask: expect.stringContaining('/00300003/02_idle_c.png'), duration: 100 },
        { base: expect.stringContaining('/fc_face_smile.png'), mask: null, duration: 200 }
      ],
      loopStart: 1
    });
    expect(result.sequences.default.frames[0].duration).toBeNull();
    expect(result.overrides.smile?.base).toContain('/fc_face_smile.png');
    expect(result.overrides.blink?.mask).toContain('/00300003/20_blink2_c.png');
  });

  it('ignores non-face targets and uses male shared expressions', () => {
    const result = parseFaceAnimations('<ms2><emotion name="x"><textureani target="HR"><texture file="hair.dds"/></textureani></emotion></ms2>', '00300001', 0);
    expect(result.sequences).toEqual({});
    expect(result.overrides.angry?.base).toContain('/mc_face_angry.png');
  });

  it('handles repeated animation tags in game definitions', () => {
    const result = parseFaceAnimations('<ms2><emotion name="sulk_A"><anim name="Emotion_Sulk_A"/><anim name="Emotion_Sulk_A"/><textureani target="FA"><texture file="Item_Face/FC_face_gloomy.dds"/></textureani></emotion></ms2>', '00300003', 1);
    expect(result.sequences.emotion_sulk_a.frames[0].base).toContain('fc_face_gloomy.png');
  });
});
