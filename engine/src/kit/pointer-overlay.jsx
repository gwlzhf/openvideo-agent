import React from 'react';
// A pointer drawn by the film, not by the product. Mount it inside the scaled product root so it shares that
// coordinate space, then move it from a shot's render hook with paintCursor().
export function Cursor({id, color = '#111', stroke = '#fff'}) {
  return (
    <div className="film-cursor" data-cursor={id}>
      <svg viewBox="0 0 24 24" width="32" height="32">
        <path d="M4 3v17l4.8-4.6 3 6.9 2.9-1.3-3-6.8H19z" fill={color} stroke={stroke} strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <i className="film-ripple" />
    </div>
  );
}

// cubic-in-out curve on [0, 1]: slow start, slow finish
const glide = u => (u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2);

// Pointer position at local time: glides between consecutive keys, holds at the first and last key.
function pointAt(track, local) {
  const lastKey = track[track.length - 1];
  if (local >= lastKey.at) return lastKey;
  const k = track.findIndex((key, i) => i < track.length - 1 && local < track[i + 1].at);
  if (k < 0) return track[0];
  const from = track[k];
  const to = track[k + 1];
  const u = glide(Math.max(0, (local - from.at) / (to.at - from.at)));
  return {x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u};
}

/**
 * Places the pointer element `node` for local time `local`.
 * track: [{at, x, y}] keys in product px. clicks: local times of clicks. span: [from, to] when it is visible.
 * Pure function of time, so seeking backwards gives the same picture.
 */
export function paintCursor(node, local, track, clicks = [], span = [-1, Infinity]) {
  if (!node) return;
  const shown = track.length > 0 && local >= span[0] && local < span[1];
  node.style.opacity = shown ? '1' : '0';
  if (!shown) return;

  const at = pointAt(track, local);
  const clickAge = clicks.map(c => local - c).find(age => age >= 0 && age < 0.45);
  node.style.transform = `translate(${at.x - 6}px, ${at.y - 3}px)`;
  const pressed = clickAge !== undefined && clickAge < 0.18;
  node.querySelector('svg').style.transform = pressed ? `scale(${0.84 + (0.16 * clickAge) / 0.18})` : '';

  const ripple = node.querySelector('.film-ripple');
  const rippling = clickAge !== undefined;
  ripple.style.opacity = rippling ? String(1 - clickAge / 0.45) : '0';
  ripple.style.transform = rippling ? `scale(${0.4 + clickAge * 3})` : '';
}
