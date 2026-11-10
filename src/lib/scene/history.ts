/** Snapshot-based undo/redo history. States are opaque strings (serialised scenes). */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private readonly limit = 100) {}

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Remember `state` as the point to return to; invalidates redo. */
  record(state: string) {
    if (this.past[this.past.length - 1] === state) return;
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: string): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: string): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
