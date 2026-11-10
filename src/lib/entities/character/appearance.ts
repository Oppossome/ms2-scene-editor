export const DEFAULT_SKIN = 2;
export const DEFAULT_EYE = 5;

export const SKIN_PALETTE = 1;
export const EYE_PALETTE = 3;
export const hasOwnColours = (item: { slots: string[] } | null | undefined) => !!item && !item.slots.includes('FA');
export type PickChannel = 0 | 2;
export const CHANNEL_LABELS: Record<PickChannel, string> = { 0: 'Main', 2: 'Detail' };
export const editableChannels = (channels: [boolean, boolean]): PickChannel[] => [
  ...(channels[0] ? [0 as const] : []),
  ...(channels[1] ? [2 as const] : [])
];
