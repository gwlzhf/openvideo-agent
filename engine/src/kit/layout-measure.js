// Measures the live layout for camera moves and cursor paths.

/** Centre of `el` in the coordinate space of `root`, from offsetLeft/offsetTop. CSS transforms do not count. */
export function offsetCenter(el, root) {
  const chain = [];
  for (let node = el; node && node !== root; node = node.offsetParent) chain.push(node);
  const x = chain.reduce((sum, node) => sum + node.offsetLeft, el.offsetWidth / 2);
  const y = chain.reduce((sum, node) => sum + node.offsetTop, el.offsetHeight / 2);
  return {x, y};
}

/**
 * Where `el` is on screen at film time t, with 3D tilt, perspective and scale included. The timeline is moved to t
 * for the measurement and put back at 0 afterwards. Use it to aim a push-in at an element that moves.
 */
export function screenCenterAt(timeline, t, el) {
  timeline.seek(t, true);
  const box = el.getBoundingClientRect();
  timeline.seek(0, true);
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}
