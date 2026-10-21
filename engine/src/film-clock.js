// Film clock for React. A component reads time through this store and subscribes to one selected value, so it only
// re-renders when that value changes (for example, how many steps are already on screen).
import {createContext, useContext, useSyncExternalStore} from 'react';

let current = 0;
const listeners = new Set();

export const FilmClock = {
  get: () => current,
  set(seconds) {
    current = seconds;
    for (const listener of listeners) listener();
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The shot a component sits in; the shot wrapper provides {start, end} in film seconds. */
export const ShotContext = createContext({start: 0, end: 0});

/** Reads one value derived from shot-local time (film time minus the shot start). */
export function useShotState(select) {
  const {start} = useContext(ShotContext);
  return useSyncExternalStore(FilmClock.subscribe, () => select(current - start), () => select(0));
}

/** Stage index: how many of the given local times have been reached. */
export const stageAt = (local, times) => times.reduce((count, at) => count + (local >= at ? 1 : 0), 0);
