// Map every plan.json shot id to a view and a builder, by the shot's kind in spec.json.
import spec from '../spec.json';
import {VIEWS, BUILDERS, buildShot} from './product.jsx';
export const SHOT_VIEWS = Object.fromEntries(spec.shots.map(s => [s.id, VIEWS[s.kind]]));
export const SHOT_BUILDERS = Object.fromEntries(spec.shots.map(s => [s.id, tl => buildShot(tl, s.id)]));
