export const isPlayerSlot = value => typeof value === 'string' && /^p[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value.slice(1)));
export const playerSlots = count => Array.from({ length: count }, (_, i) => `p${i + 1}`);
