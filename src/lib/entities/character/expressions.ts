export const FACE_EXPRESSIONS = [
  'angry',
  'awe',
  'disappoint',
  'expectation',
  'expect',
  'gloomy',
  'happy',
  'hateyou',
  'indifferent01',
  'indifferent02',
  'irritated',
  'nospirit',
  'panic',
  'pathetic',
  'serious',
  'smile',
  'sneaky2',
  'sneaky',
  'syncope01',
  'syncope02',
  'syncope03'
] as const;

export type FaceExpression =
  'idle' | 'blink' | 'talk' | 'attack' | 'focus' | 'pain' | (typeof FACE_EXPRESSIONS)[number];
export const FACE_OVERRIDES: readonly FaceExpression[] = [
  'idle',
  'blink',
  'talk',
  'attack',
  'focus',
  'pain',
  ...FACE_EXPRESSIONS
];
export const isFaceExpression = (value: unknown): value is FaceExpression =>
  typeof value === 'string' && FACE_OVERRIDES.some((expression) => expression === value);

export interface FaceFrame {
  base: string;
  mask: string | null;
  /** Milliseconds; null holds this frame until the clip changes. */
  duration: number | null;
}

export interface FaceSequence {
  frames: FaceFrame[];
  loopStart: number | null;
}

export interface FaceAnimations {
  sequences: Record<string, FaceSequence>;
  overrides: Partial<Record<FaceExpression, FaceFrame>>;
}

/** Sample the game's texture sequence at the skeletal animation's current time. */
export function faceFrameAt(sequence: FaceSequence, seconds: number): FaceFrame | undefined {
  const { frames, loopStart } = sequence;
  if (!frames.length) return undefined;
  let time = Math.max(0, seconds * 1000);
  const start = loopStart ?? frames.length;
  const intro = frames.slice(0, start).reduce((sum, frame) => sum + (frame.duration ?? Infinity), 0);
  const loop = frames.slice(start).reduce((sum, frame) => sum + (frame.duration ?? Infinity), 0);
  if (time >= intro && loop > 0 && Number.isFinite(loop)) time = intro + ((time - intro) % loop);
  for (const frame of frames) {
    if (frame.duration === null || time < frame.duration) return frame;
    time -= frame.duration;
  }
  return frames[frames.length - 1];
}
