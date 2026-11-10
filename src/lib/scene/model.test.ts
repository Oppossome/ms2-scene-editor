import { describe, expect, it } from 'vitest';
import { History } from './model';

describe('History', () => {
  it('undoes and redoes', () => {
    const h = new History();
    h.record('a');
    h.record('b');
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeNull();
    expect(h.redo('a')).toBe('b');
    expect(h.canRedo).toBe(true);
  });

  it('drops redo on a new record and honours the limit', () => {
    const h = new History(2);
    h.record('a');
    h.record('b');
    h.record('c');
    expect(h.undo('d')).toBe('c');
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBeNull();
    h.record('x');
    expect(h.canRedo).toBe(false);
  });
});
