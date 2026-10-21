import React from 'react';
import {ShotContext} from './film-clock.js';
import {shots} from './timeline.js';
import spec from './spec.json';
import {SHOT_VIEWS} from './shots/index.js';
export function Film() {
  return <main id="film" className="film-theme">
    {shots.map((s, i) => {
      const View = SHOT_VIEWS[s.id];
      if (!View) throw new Error(`No view for shot "${s.id}" in src/shots/index.js`);
      const c = spec.shots.find(x => x.id === s.id);
      const theme = c.kind === 'title' || c.kind === 'end' ? 'dark' : (c.theme || 'dark');
      return <section key={s.id} data-shot={s.id} className={`shot shot-${s.id} type-${c.kind} theme-${theme}`} style={{zIndex: i + 1}}>
        <ShotContext.Provider value={s}><View shot={s} /></ShotContext.Provider>
      </section>;
    })}
    <img id="poster" src="poster.png" alt="" />
  </main>;
}
