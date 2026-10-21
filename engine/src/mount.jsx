// Browser entry point. It mounts the film, lets the shot builders measure the laid-out page, and exposes what the
// Node scripts drive through window: seek(t), playFilm(), stopFilm() and __filmReady (resolves when frame 0 is ready).
import './offline-runtime.js';   // must run first: pins the clock, the random numbers and the network
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Film} from './film.jsx';
import {frame, master, seek} from './timeline.js';
import {SHOT_BUILDERS} from './shots/index.js';

flushSync(() => createRoot(document.getElementById('film-root')).render(<Film />));
window.seek = seek;
window.__master = master;

async function settle() {
  await document.fonts.ready;
  await new Promise(resolve => setTimeout(resolve, 800));   // fixture fetches and effects finish
  await frame();
  await frame();
  for (const build of Object.values(SHOT_BUILDERS)) {
    const outcome = build(master);
    // a paused GSAP timeline is thenable but never settles, so only real promises are awaited
    if (outcome instanceof Promise) await outcome;
  }
  await seek(0);
}
window.__filmReady = settle();

let clockOrigin = null;
let pendingFrame = null;
window.playFilm = () => {
  cancelAnimationFrame(pendingFrame);
  clockOrigin = null;
  const step = async now => {
    clockOrigin ??= now;
    await seek((now - clockOrigin) / 1000);
    pendingFrame = requestAnimationFrame(step);
  };
  pendingFrame = requestAnimationFrame(step);
};
window.stopFilm = () => cancelAnimationFrame(pendingFrame);
