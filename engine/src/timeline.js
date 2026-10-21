// Deterministic timeline: seek(t) depends only on t, so any frame can be rendered again and comes out the same.
// One seek does, in order: publish t to React; run the interaction drivers near t and await their promises; seek
// the paused GSAP master; show the shots near t and hide the others; run the render hooks near t.
import gsap from 'gsap';
import {flushSync} from 'react-dom';
import plan from '../plan.json';
import {FilmClock} from './film-clock.js';

gsap.ticker.sleep();   // only seek() moves the master timeline
export const master = gsap.timeline({paused: true});
export const shots = plan.shots;
const shotsById = new Map(shots.map(s => [s.id, s]));

export function shot(id) {
  const found = shotsById.get(id);
  if (found === undefined) throw new Error(`plan.json has no shot "${id}"`);
  return found;
}

const hooks = {render: [], drive: []};
/** Per-frame work that must be recomputed at every t (canvas, WebGL, measured positions). fn(localTime, filmTime). */
export const onRender = (id, fn) => hooks.render.push({shot: shot(id), fn});
/** A real product interaction inside a shot. fn(localTime) may return a promise that seek() waits for. */
export const onDrive = (id, fn) => hooks.drive.push({shot: shot(id), fn});
/** Resolves after the next paint. */
export const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

const OVERLAP = 0.8;   // seconds a shot stays mounted past its window, so transitions can overlap
const isNearby = (s, t) => t >= s.start - OVERLAP && t < s.end + OVERLAP;
const lastInstant = plan.duration - 1 / plan.fps;

export async function seek(seconds) {
  const t = Math.min(Math.max(Number(seconds) || 0, 0), lastInstant);
  flushSync(() => FilmClock.set(t));

  const pending = hooks.drive
    .filter(h => isNearby(h.shot, t))
    .map(h => h.fn(t - h.shot.start))
    .filter(result => typeof result?.then === 'function');
  await Promise.all(pending);

  master.seek(t, true);
  for (const s of shots) {
    const node = document.querySelector(`section[data-shot="${s.id}"]`);
    if (node) node.style.visibility = isNearby(s, t) ? 'visible' : 'hidden';
  }
  for (const h of hooks.render) if (isNearby(h.shot, t)) h.fn(t - h.shot.start, t);
  window.CURRENT_TIME = t;
}
