import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { MapData } from '../types.js';
import type { Vec3 } from '../scene/model.js';
import { entityMatrix } from './instancing.js';

export interface ExtractedProp {
  glb: string;
  /** Placement in the map's own Y-up space. */
  matrix: Matrix4;
  distance: number;
}

/**
 * Props of a map within `radius` of `center` (map-local, Y-up), nearest first, at most `limit`.
 * Used to turn part of a map into individually editable scene objects.
 */
export function extractNearby(data: MapData, center: Vector3, radius: number, limit: number): ExtractedProp[] {
  const found: ExtractedProp[] = [];
  const position = new Vector3();
  for (const item of data.items) {
    const matrix = entityMatrix(item);
    position.setFromMatrixPosition(matrix);
    const distance = position.distanceTo(center);
    if (distance <= radius) found.push({ glb: data.models[item[0]], matrix, distance });
  }
  found.sort((a, b) => a.distance - b.distance);
  return found.slice(0, limit);
}

/** Position, Euler XYZ rotation (radians) and scale of a matrix, in the form scene objects store. */
export function decomposeForScene(matrix: Matrix4): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z]
  };
}

/** Matrix of a scene object (Euler XYZ, like the group the scene renders). */
export function sceneMatrix(position: Vec3, rotation: Vec3, scale: Vec3): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2], 'XYZ')),
    new Vector3(...scale)
  );
}
