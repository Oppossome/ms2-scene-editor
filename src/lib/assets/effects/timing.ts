import { LoopBehavior, type ControllerTiming, type KeyTrack, type ParticleKey } from './types.js';

/** Gamebryo's NiTimeController::ComputeScaledTime: the controller's own time for an effect time. */
export function controllerTime(ctl: ControllerTiming, time: number): number {
  const scaled = time * ctl.frequency + ctl.phase;
  const lo = Math.min(ctl.start, ctl.stop);
  const hi = Math.max(ctl.start, ctl.stop);
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return lo;
  switch (ctl.cycle) {
    case 'loop': {
      const t = (scaled - lo) % span;
      return lo + (t < 0 ? t + span : t);
    }
    case 'reverse': {
      const t = (((scaled - lo) % (2 * span)) + 2 * span) % (2 * span);
      return lo + (t <= span ? t : 2 * span - t);
    }
    default:
      return Math.min(hi, Math.max(lo, scaled));
  }
}

/** Index of the last key at or before `time` (0 when before the first). */
function keyIndex(times: readonly number[], time: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (time >= times[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Sample a key track into `out` (`comps` values). Linear or step; before the first key holds the first value. */
export function sampleTrack(track: KeyTrack, comps: number, time: number, out: number[] = []): number[] {
  const { times, values } = track;
  if (!times.length) return out;
  const i = keyIndex(times, time);
  const j = Math.min(i + 1, times.length - 1);
  const span = times[j] - times[i];
  const f = track.interp === 'step' || span <= 0 || time <= times[i] ? 0 : Math.min(1, (time - times[i]) / span);
  for (let c = 0; c < comps; c++) {
    const a = values[i * comps + c];
    out[c] = f === 0 ? a : a + (values[j * comps + c] - a) * f;
  }
  return out;
}

export function sampleScalar(track: KeyTrack, time: number): number {
  return sampleTrack(track, 1, time, scratch)[0];
}
const scratch: number[] = [0];

/**
 * Key time for a particle of `age` out of `life` seconds (PSLoopBehavior). Key times of age-scaled keys run from the
 * first to the last key over the particle's life.
 */
export function particleKeyTime(
  keys: readonly ParticleKey<unknown>[],
  loop: number,
  age: number,
  life: number
): number {
  const first = keys[0].time;
  const last = keys[keys.length - 1].time;
  const span = last - first;
  switch (loop) {
    case LoopBehavior.ClampBirth:
      return first + age;
    case LoopBehavior.ClampDeath:
      return last - (life - age);
    case LoopBehavior.Loop:
      return span > 0 ? first + (((age % span) + span) % span) : first;
    case LoopBehavior.Reflect: {
      if (span <= 0) return first;
      const t = age % (2 * span);
      return first + (t <= span ? t : 2 * span - t);
    }
    default:
      return first + (life > 0 ? Math.min(1, age / life) : 0) * span;
  }
}

/** Interpolate particle keys (scalars or tuples) at a key time into `out`. */
export function sampleParticleKeys(keys: readonly ParticleKey<number | number[]>[], time: number, out: number[]) {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].time <= time) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const span = b.time - a.time;
  const f = span > 0 && time > a.time ? Math.min(1, (time - a.time) / span) : 0;
  const av = typeof a.value === 'number' ? [a.value] : a.value;
  const bv = typeof b.value === 'number' ? [b.value] : b.value;
  for (let c = 0; c < av.length; c++) out[c] = av[c] + (bv[c] - av[c]) * f;
  return out;
}

/** Deterministic random in [0, 1) from integers (a small integer hash; the same inputs always give the same value). */
export function hashRandom(seed: number, index: number, salt: number): number {
  let h =
    Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
