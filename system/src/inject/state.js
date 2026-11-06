"use strict";
const BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'back', 'start', 'ls', 'rs', 'guide', 'up', 'down', 'left', 'right'];
const AXES = ['lx', 'ly', 'rx', 'ry', 'lt', 'rt'];
function normalizeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Invalid controller state');
  const axes = {}, buttons = {};
  for (const k of AXES) {
    const v = s.axes?.[k] ?? 0;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Invalid axis: ${k}`);
    axes[k] = Math.max(k === 'lt' || k === 'rt' ? 0 : -1, Math.min(1, v));
  }
  for (const k of BUTTONS) buttons[k] = s.buttons?.[k] === true;
  return { axes, buttons };
}
const neutralState = () => normalizeState({});
module.exports = { normalizeState, neutralState, BUTTONS };
