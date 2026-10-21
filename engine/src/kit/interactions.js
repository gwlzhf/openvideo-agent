import {frame} from '../timeline.js';
// Real product interactions for onDrive(). Each helper is idempotent: it works out the state wanted at this local
// time and touches the DOM only when the current state differs.

/** Writes `value` into a React-controlled input or textarea and dispatches the event React listens for. */
export function setFieldValue(field, value) {
  if (!field || field.value === value) return;
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Reflect.apply(Object.getOwnPropertyDescriptor(prototype, 'value').set, field, [value]);
  field.dispatchEvent(new Event('input', {bubbles: true}));
}

/** The text typed so far: typing starts at `at`, runs at `cps` characters per second, and clears at `clearAt`. */
export function typed(text, local, at, cps, clearAt = Infinity) {
  if (local < at || local >= clearAt) return '';
  const glyphs = [...text];   // code points: an emoji or a CJK character counts as one
  const shown = Math.min(glyphs.length, 1 + Math.floor((local - at) * cps));
  return glyphs.slice(0, shown).join('');
}

/** Toggles a popover through its real control when it is in the wrong state, then waits for it to position. */
export async function ensureOpen(wantOpen, isOpen, toggle) {
  if (isOpen() === wantOpen) return;
  toggle();
  await frame();
  await frame();   // two paints: floating positioning has settled by then
}
