export interface NearEndOptions {
  /** Called when the element is, or comes within `margin` of being, visible in its scrolling parent. */
  onnearend: () => void;
  /** How far ahead of the visible part to ask for more (CSS margin syntax). */
  margin?: string;
  /**
   * Anything that changes as the list does (its length, whether it is loading). Every change re-checks the element,
   * so a list that is still too short to fill its parent after a page arrives asks for the next one.
   */
  state?: unknown;
}

/**
 * Svelte action for an element at the end of a scrolling list: it asks for the next page when the end gets near.
 * An IntersectionObserver only reports changes, so the observer is created again whenever `state` changes; the first
 * report of a new observer says whether the element is already in view.
 */
export function nearEnd(node: HTMLElement, options: NearEndOptions) {
  let observer: IntersectionObserver | null = null;
  let current = options;

  function watch() {
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) current.onnearend();
      },
      { root: node.parentElement, rootMargin: current.margin ?? '0px 0px 300px 0px' }
    );
    observer.observe(node);
  }

  watch();
  return {
    update(next: NearEndOptions) {
      current = next;
      watch();
    },
    destroy() {
      observer?.disconnect();
    }
  };
}
