import { describe, expect, it } from 'vitest';
import { previewUrlForModel } from './urls';

describe('previewUrlForModel', () => {
  it('maps a converted model to its extracted NIF preview', () => {
    expect(previewUrlForModel('Map/common/field/a b.glb')).toBe(
      '/api/assets/converted/model-previews/Map/common/field/a%20b.png'
    );
    expect(previewUrlForModel('Npc/11/11000038/11000038_normaldoctor.GLB')).toBe(
      '/api/assets/converted/model-previews/Npc/11/11000038/11000038_normaldoctor.png'
    );
  });

  it('is empty without a model', () => {
    expect(previewUrlForModel('')).toBe('');
  });
});
