import { getContext, setContext } from 'svelte';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const key = Symbol('orbit-controls');

/** Lets the stage's children reach its camera controls (to pause orbiting while they take a drag). */
export function setOrbitControls(get: () => OrbitControls | undefined) {
  setContext(key, get);
}

export function getOrbitControls(): () => OrbitControls | undefined {
  return getContext<(() => OrbitControls | undefined) | undefined>(key) ?? (() => undefined);
}
