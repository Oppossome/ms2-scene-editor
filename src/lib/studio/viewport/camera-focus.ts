/** Shared between viewport instances; checked each frame so held keys follow the pointer. */
export class CameraFocus {
  private hovered: symbol | null = null;

  enter(view: symbol) {
    this.hovered = view;
  }

  leave(view: symbol) {
    if (this.hovered === view) this.hovered = null;
  }

  isActive(view: symbol, main: boolean): boolean {
    return this.hovered === null ? main : this.hovered === view;
  }
}

export const cameraFocus = new CameraFocus();
