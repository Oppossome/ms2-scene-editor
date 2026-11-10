/** Camera direction per key: `z` moves along the view (forward is +1), `x` strafes (right is +1), `y` rises along the camera's up (+1). */
export const FLY_KEYS: Record<string, { x: number; y: number; z: number }> = {
  w: { x: 0, y: 0, z: 1 },
  s: { x: 0, y: 0, z: -1 },
  a: { x: -1, y: 0, z: 0 },
  d: { x: 1, y: 0, z: 0 },
  e: { x: 0, y: 1, z: 0 },
  q: { x: 0, y: -1, z: 0 }
};
