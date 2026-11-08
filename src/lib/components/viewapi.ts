import type { Object3D, Vector3 } from 'three';

/** Filled in by the viewport so the page can read camera state (e.g. where to spawn new objects). */
export interface ViewApi {
  target?: () => Vector3 | undefined;
  /** Move the camera so the object fills the view. */
  frame?: (object: Object3D) => void;
}
