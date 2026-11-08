import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nearEnd } from './nearend';

type Callback = (entries: { isIntersecting: boolean }[]) => void;
interface FakeObserver {
  callback: Callback;
  options: { root: unknown; rootMargin: string };
  observed: unknown[];
  disconnected: boolean;
}

let observers: FakeObserver[];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      state: FakeObserver;
      constructor(callback: Callback, options: FakeObserver['options']) {
        this.state = { callback, options, observed: [], disconnected: false };
        observers.push(this.state);
      }
      observe(node: unknown) {
        this.state.observed.push(node);
      }
      disconnect() {
        this.state.disconnected = true;
      }
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

const parent = { id: 'list' };
const node = () => ({ parentElement: parent }) as unknown as HTMLElement;
const live = () => observers.filter((o) => !o.disconnected);

describe('nearEnd', () => {
  it('watches the element inside its scrolling parent, a little ahead of the edge', () => {
    const el = node();
    nearEnd(el, { onnearend: () => {} });
    expect(observers).toHaveLength(1);
    expect(observers[0].observed).toEqual([el]);
    expect(observers[0].options.root).toBe(parent);
    expect(observers[0].options.rootMargin).toBe('0px 0px 300px 0px');
  });

  it('asks for more when the element is in view, and not when it is out of it', () => {
    const onnearend = vi.fn();
    nearEnd(node(), { onnearend });
    observers[0].callback([{ isIntersecting: false }]);
    expect(onnearend).not.toHaveBeenCalled();
    observers[0].callback([{ isIntersecting: true }]);
    expect(onnearend).toHaveBeenCalledTimes(1);
  });

  it('checks again after every update, so a short list keeps loading until it fills its parent', () => {
    const first = vi.fn();
    const second = vi.fn();
    const action = nearEnd(node(), { onnearend: first, state: 1 });
    action.update({ onnearend: second, state: 2 });
    expect(observers).toHaveLength(2);
    expect(live()).toHaveLength(1);
    // the new observer reports on the new callback
    live()[0].callback([{ isIntersecting: true }]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops watching when the element goes away', () => {
    const action = nearEnd(node(), { onnearend: () => {} });
    action.destroy();
    expect(live()).toHaveLength(0);
  });

  it('takes a custom margin', () => {
    nearEnd(node(), { onnearend: () => {}, margin: '0px' });
    expect(observers[0].options.rootMargin).toBe('0px');
  });
});
