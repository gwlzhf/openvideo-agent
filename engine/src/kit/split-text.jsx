import React from 'react';
// Breaks text into spans so GSAP can stagger them. `by` picks the unit: 'ch' (characters), 'word' or 'line'.
const UNITS = {
  ch: value => Array.from(value),
  word: value => value.split(/(\s+)/),
  line: value => value.split('\n'),
};

export function Split({text, by = 'ch', className = '', lang}) {
  const pieces = (UNITS[by] ?? UNITS.ch)(text);
  return (
    <span className={`split ${className}`} lang={lang}>
      {pieces.map((piece, index) => <span key={index} className={`u u-${by}`}>{piece}</span>)}
    </span>
  );
}

// the rest state a property animates to, given the property name
const restOf = prop => ({filter: 'blur(0px)', opacity: 1, scale: 1})[prop] ?? 0;

/** Staggers the units under `root` from the `from` state to their rest state, starting at `at` on the timeline. */
export function reveal(timeline, root, at, options = {}) {
  const {from = {opacity: 0, y: 24, filter: 'blur(12px)'}, dur = 0.7, stagger = 0.035, ease = 'expo.out'} = options;
  const to = Object.fromEntries(Object.keys(from).map(prop => [prop, restOf(prop)]));
  timeline.fromTo(root.querySelectorAll('.u'), from, {...to, duration: dur, ease, stagger}, at);
}
