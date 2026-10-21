// Browser runtime for the film. It loads before any product code and makes the page identical on every render:
// a pinned clock, a fixed random sequence, fixture answers for the product's API routes, and inert live connections.
import {API_FIXTURES, API_PREFIXES} from './fixtures/api.js';

const PINNED_INSTANT = new Date('2026-01-15T10:00:00+08:00').getTime();
const NativeDate = Date;
class PinnedDate extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [PINNED_INSTANT]));
  }
  static now() {
    return PINNED_INSTANT;
  }
}
globalThis.Date = PinnedDate;

// mulberry32 with a fixed seed
let randomState = 7418;
Math.random = () => {
  randomState = (randomState + 0x6d2b79f5) | 0;
  let mixed = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
  mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
};

try {
  localStorage.clear();
  sessionStorage.clear();
} catch {
  // storage is unavailable here, so there is nothing to clear
}

window.__filmApiLog = [];   // stills and renders print this list, so a missing fixture is visible
const reply = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {status, headers: {'content-type': 'application/json'}});
const nativeFetch = window.fetch.bind(window);
const asUrl = input => new URL(typeof input === 'string' ? input : input.url, location.href);
const isApiPath = pathname => API_PREFIXES.some(prefix => pathname.startsWith(prefix));
window.fetch = async (input, init) => {
  const url = asUrl(input);
  if (!isApiPath(url.pathname)) return nativeFetch(input, init);
  window.__filmApiLog.push(url.pathname + url.search);
  const fixture = API_FIXTURES[url.pathname];
  if (fixture === undefined) return reply({});
  return reply(typeof fixture === 'function' ? fixture(url, init) : fixture);
};

class InertSocket {
  constructor() {
    this.readyState = 0;
  }
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
}
window.EventSource = InertSocket;
window.WebSocket = InertSocket;
