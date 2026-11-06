export const desktopCodes = new Set([
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  'Space','Enter','Escape','Backspace','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Insert','Delete',
  'ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight','CapsLock',
  'Minus','Equal','BracketLeft','BracketRight','Backslash','Semicolon','Quote','Backquote','Comma','Period','Slash'
]);
export function videoPoint(video, clientX, clientY, clamp = false) {
  const rect = video.getBoundingClientRect(), width = video.videoWidth, height = video.videoHeight;
  if (!width || !height || !rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / width, rect.height / height);
  const fittedWidth = width * scale, fittedHeight = height * scale;
  const x = (clientX - rect.left - (rect.width - fittedWidth) / 2) / fittedWidth;
  const y = (clientY - rect.top - (rect.height - fittedHeight) / 2) / fittedHeight;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}
export function desktopSnapshot(value) {
  if (!value || !Number.isSafeInteger(value.seq) || value.seq < 0 || !Array.isArray(value.keys) || value.keys.length > 32 || value.keys.some(code => !desktopCodes.has(code)) || !Array.isArray(value.buttons) || value.buttons.length > 3 || value.buttons.some(button => ![0,1,2].includes(button))) return null;
  const result = { seq: value.seq, keys: [...new Set(value.keys)], buttons: [...new Set(value.buttons)] };
  if (Number.isSafeInteger(value.moveSeq) && value.moveSeq >= 0) result.moveSeq = value.moveSeq;
  if (value.x !== undefined || value.y !== undefined) {
    if (![value.x, value.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
    result.x = value.x; result.y = value.y;
  }
  return result;
}
