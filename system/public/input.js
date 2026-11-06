export const buttonLabels = { a: 'South face button', b: 'East face button', x: 'West face button', y: 'North face button', lb: 'Left shoulder', rb: 'Right shoulder', back: 'Back / Select', start: 'Start', ls: 'Left stick click', rs: 'Right stick click', up: 'D-pad up', down: 'D-pad down', left: 'D-pad left', right: 'D-pad right', guide: 'Home / Guide' };
export const standardProfile = {
  buttons: { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15, guide: 16 },
  axes: { lx: { index: 0 }, ly: { index: 1, invert: true }, rx: { index: 2 }, ry: { index: 3, invert: true } },
  triggers: { lt: { button: 6 }, rt: { button: 7 } }
};
const finite = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const clamp = (v, min, max) => Math.max(min, Math.min(max, finite(v)));
export function calibrationFromSamples(rest, samples) {
  if (!samples?.length) throw Error('Move both sticks and pull the triggers before finishing.');
  const result = {};
  for (const axis of ['lx','ly','rx','ry','lt','rt']) {
    const values = samples.map(s => finite(s.axes?.[axis])), center = finite(rest.axes?.[axis]), min = Math.min(center, ...values), max = Math.max(center, ...values);
    if (['lt','rt'].includes(axis)) { if (max - min > .4) result[axis] = { center: min, min, max }; }
    else if (center - min > .3 && max - center > .3 && Math.abs(center) <= .3) result[axis] = { center, min, max };
  }
  if (!Object.keys(result).length) throw Error('Not enough movement was detected. Rotate the sticks fully, then try again.');
  return result;
}
export function cleanCalibration(value) {
  const result = {};
  for (const axis of ['lx','ly','rx','ry','lt','rt']) { const b = value?.[axis]; if (b && [b.min,b.max,b.center].every(n => typeof n === 'number' && Number.isFinite(n)) && b.min >= -1 && b.max <= 1 && b.min <= b.center && b.center < b.max && b.max - b.min > .3 && (['lt','rt'].includes(axis) ? b.min >= 0 && b.center === b.min : b.min < b.center && Math.abs(b.center) <= .3)) result[axis] = { min:b.min,max:b.max,center:b.center }; }
  return result;
}
const calibrated = (value, range, trigger=false) => !range ? value : trigger ? clamp((value-range.min)/(range.max-range.min),0,1) : clamp((value-range.center)/(value>=range.center?range.max-range.center:range.center-range.min),-1,1);
export function neutralState() { return { buttons: Object.fromEntries(Object.keys(buttonLabels).map(k => [k, false])), axes: { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 } }; }
export function packGamepadState(gp, profile, deadzone = 0.12) {
  if (!profile && gp.mapping !== 'standard') throw new Error('Map this controller first, then save its layout.');
  profile ||= standardProfile;
  const s = neutralState();
  for (const key of Object.keys(buttonLabels)) {
    const binding=profile.buttons[key];
    s.buttons[key]=binding && typeof binding==='object' ? finite(gp.axes[binding.axis])*(binding.invert?-1:1)>.5 : !!gp.buttons[binding]?.pressed;
  }
  for (const key of ['lx', 'ly', 'rx', 'ry']) {
    const binding = profile.axes[key];
    const value = calibrated(clamp(gp.axes[binding?.index], -1, 1) * (binding?.invert ? -1 : 1), profile.calibration?.[key]);
    s.axes[key] = Math.abs(value) <= deadzone ? 0 : Math.sign(value) * (Math.abs(value) - deadzone) / (1 - deadzone);
  }
  for (const key of ['lt', 'rt']) {
    const binding = profile.triggers[key];
    s.axes[key] = binding?.button !== undefined ? clamp(gp.buttons[binding.button]?.value, 0, 1) : Number.isInteger(binding?.axis) && binding.axis>=0 ? clamp(binding.half ? finite(gp.axes[binding.axis])*(binding.invert?-1:1) : (finite(gp.axes[binding.axis]) * (binding.invert ? -1 : 1) + 1) / 2, 0, 1) : 0;
    s.axes[key] = calibrated(s.axes[key],profile.calibration?.[key],true);
  }
  return s;
}
export const defaultKeyboardBindings=Object.freeze({a:'KeyZ',b:'KeyX',x:'KeyA',y:'KeyS',lb:'KeyQ',rb:'KeyW',back:'ShiftRight',start:'Enter',ls:'',rs:'',guide:'',up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',lt:'Digit1',rt:'Digit2',lxNegative:'',lxPositive:'',lyNegative:'',lyPositive:'',rxNegative:'',rxPositive:'',ryNegative:'',ryPositive:''});
export function cleanKeyboardBindings(value){return Object.fromEntries(Object.keys(defaultKeyboardBindings).map(key=>[key,typeof value?.[key]==='string' && /^(?:Mouse[0-4]|Wheel(?:Up|Down|Left|Right)|Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Enter|Space|Tab|Backspace|Escape|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Backquote|CapsLock|F(?:[1-9]|1[0-2]))$/.test(value[key])?value[key]:'']));}
export function keyboardState(keys,bindings=defaultKeyboardBindings) {
  const state = neutralState();
  const pressed=key=>!!bindings[key] && keys.has(bindings[key]);
  for(const key of Object.keys(buttonLabels))state.buttons[key]=pressed(key);
  for(const axis of ['lx','ly','rx','ry'])state.axes[axis]=Number(pressed(axis+'Positive'))-Number(pressed(axis+'Negative'));
  state.axes.lt=Number(pressed('lt'));state.axes.rt=Number(pressed('rt'));
  return state;
}
// Repeated full-state heartbeats may be paced; a new press, release or axis
// position must never wait behind an earlier timer's stale sample.
export function inputPacer(interval=15){
  const lanes=new Map();
  return (lane,value,now)=>{
    const signature=JSON.stringify(value),previous=lanes.get(lane);
    if(previous?.signature===signature && now-previous.at<interval)return false;
    lanes.set(lane,{signature,at:now});return true;
  };
}
