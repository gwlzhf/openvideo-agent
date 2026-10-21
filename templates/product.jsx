import React from 'react';
import {Split, reveal} from '../kit/split-text.jsx';
import {shot} from '../timeline.js';
import spec from '../spec.json';
// Data-driven shots. Everything shown comes from spec.json (written by generate.mjs); nothing is hard-coded here.
// Shot kinds: title | cards | terminal | screenshot | end.
const sec = id => document.querySelector(`section[data-shot="${id}"]`);
const q = (id, sel) => sec(id).querySelector(sel);
const at = (s, name) => { const a = s.actions.find(x => x.id === `${s.id}-${name}`); return s.start + (a ? a.at : 0); };
const has = (s, name) => s.actions.some(x => x.id === `${s.id}-${name}`);
export const content = id => spec.shots.find(x => x.id === id);

/* ---------- shared pieces ---------- */
// Keep runs of Latin words/commands whole so a Chinese headline never breaks inside "install"
function ZhSplit({text}) {
  const parts = text.split(/([A-Za-z0-9][A-Za-z0-9./+-]*)/);
  return <span className="split" lang="zh-CN">
    {parts.map((p, i) => {
      if (p === '') return null;
      if (i % 2 === 1) return <span key={i} className="u u-ch ag-latin">{p}</span>;
      return Array.from(p).map((c, j) => <span key={`${i}-${j}`} className="u u-ch">{c === ' ' ? ' ' : c}</span>);
    })}
  </span>;
}
function Head({s, tone, tag, center}) {
  return <div className={`ag-col ${tone}${center ? ' center' : ''}`}>
    {tag && <div className="ag-tag">{tag}</div>}
    <div className="ag-en en"><Split text={s.headlineEn} lang="en" by="word" /></div>
    <div className="ag-zh zh"><ZhSplit text={s.headline} /></div>
    <p className="ag-desc">{s.description}</p>
  </div>;
}
function Notice({title, tag, body}) {
  return <div className="ag-card ag-notice ag-intro-notice">
    <div className="ag-notice-top">
      <span className="ag-bell" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      </span>
      <div className="ag-notice-title">{title}</div>
      <span className="ag-pill blue">{tag}</span>
    </div>
    <div className="ag-notice-body">{body}</div>
  </div>;
}
// terminal line: leading marks pick a style. "> " selected, "ok " done (green), "# " muted
function Line({text}) {
  let cls = 'ag-line', t = text;
  if (/^(❯|>) /.test(t)) { cls += ' ag-sel'; t = '❯ ' + t.slice(2); }
  else if (/^(✓|ok) /.test(t)) { cls += ' ag-done'; t = '✓ ' + t.replace(/^(✓|ok) /, ''); }
  else if (/^# /.test(t)) { cls += ' ag-muted'; t = t.slice(2); }
  return <div className={cls}>{t}</div>;
}
const QR_N = 25;
const finder = (r, c) => {
  for (const [r0, c0] of [[0, 0], [0, QR_N - 7], [QR_N - 7, 0]]) {
    const dr = r - r0, dc = c - c0;
    if (dr >= -1 && dr <= 7 && dc >= -1 && dc <= 7) {
      if (dr < 0 || dc < 0 || dr > 6 || dc > 6) return 0;
      return (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)) ? 1 : 0;
    }
  }
  return null;
};
// schematic code (not scannable): deterministic noise plus the three finder squares
const qrCell = (r, c) => finder(r, c) ?? ((((r * 131 + c * 71 + r * c * 17) ^ (r * 7 + c * 13)) % 5) < 2 ? 1 : 0);
function Qr() {
  const cells = [];
  for (let r = 0; r < QR_N; r++) for (let c = 0; c < QR_N; c++) cells.push(<i key={r * QR_N + c} className={qrCell(r, c) ? 'on' : ''} />);
  return <div className="ag-qr">{cells}</div>;
}
const Ring = ({r}) => r ? <div className={'ag-hl ' + (r.color || '')} style={{left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%', borderColor: r.color && r.color[0] === '#' ? r.color : undefined}} /> : null;

/* ---------- views ---------- */
function TitleView({shot: s}) {
  const c = content(s.id);
  return <div className="ag-stage dark">
    <Head s={s} tone="dark" />
    {c.notice && <Notice title={c.notice.title} tag={c.notice.tag} body={c.notice.body} />}
  </div>;
}
function CardsView({shot: s}) {
  const c = content(s.id), tone = c.theme === 'light' ? 'light' : 'dark';
  return <div className={'ag-stage ' + tone}>
    <Head s={s} tone={tone} tag={c.tag} />
    <div className="ag-platforms">
      {c.cards.map((k, i) => <div className="ag-card ag-platform" key={i}>
        <div className="ag-platform-os">{k.title}{k.sub && <span className="ag-platform-arch">{k.sub}</span>}</div>
        <div className="ag-platform-zip">{k.text}</div>
        {k.accent && <div className="ag-platform-launch">{k.accent}</div>}
      </div>)}
    </div>
    {c.note && <div className="ag-term ag-term-install">
      <div className="ag-term-bar"><i /><i /><i /></div>
      <div className="ag-term-body"><div className="ag-line"><span className="ag-prompt">✓</span><span className="ag-typed">{c.note}</span></div></div>
    </div>}
  </div>;
}
function TerminalView({shot: s}) {
  const c = content(s.id), tone = c.theme === 'light' ? 'light' : 'dark';
  const term = <div className={'ag-term ' + (c.qr ? 'ag-term-qr' : 'ag-term-menu')}>
    <div className="ag-term-bar"><i /><i /><i /></div>
    <div className="ag-term-body">
      {c.command && <div className="ag-line"><span className="ag-prompt">{c.prompt || '$'}</span><span className="ag-typed">{c.command}</span></div>}
      <div className="ag-stack">
        {(c.panes || []).map((p, k) => <div className="ag-pane" key={k}>{p.filter(l => !/^(✓|ok) /.test(l)).map((l, i) => <Line key={i} text={l} />)}</div>)}
      </div>
      {c.qr && <Qr />}
      {c.footer && <div className="ag-line ag-muted ag-keep">{c.footer}</div>}
      {c.done && <Line text={'ok ' + c.done} />}
    </div>
  </div>;
  return <div className={'ag-stage ' + tone}>
    <Head s={s} tone={tone} tag={c.tag} />
    {c.phone ? <div className="ag-pair-row">{term}
      <div className="ag-phone ag-phone-sm"><div className="ag-phone-screen"><img src={c.phone.src} alt="" /><Ring r={c.phone.ring} /></div></div>
    </div> : term}
  </div>;
}
function ScreenshotView({shot: s}) {
  const c = content(s.id), tone = c.theme === 'dark' ? 'dark' : 'light';
  const img = <img src={c.image.src} alt="" />;
  return <div className={'ag-stage ' + tone}>
    <Head s={s} tone={tone} tag={c.tag} />
    {c.frame === 'phone'
      ? <div className="ag-phone"><div className="ag-phone-screen">{img}<Ring r={c.ring} /></div></div>
      : <div className="ag-browser">
        <div className="ag-browser-bar"><i /><i /><i /><div className="ag-url">{c.url || ''}</div></div>
        <div className="ag-browser-screen">{img}<Ring r={c.ring} /></div>
      </div>}
  </div>;
}
function EndView({shot: s}) {
  const c = content(s.id);
  return <div className="ag-stage dark">
    <Head s={s} tone="dark" center />
    <div className="ag-chips">{(c.chips || []).map((x, i) => <span className="ag-chip" key={i}>{x}</span>)}</div>
  </div>;
}
export const VIEWS = {title: TitleView, cards: CardsView, terminal: TerminalView, screenshot: ScreenshotView, end: EndView};

/* ---------- builders ---------- */
const frame = (tl, s, {fadeIn = true, fadeOut = true} = {}) => {
  const el = sec(s.id);
  if (fadeIn && s.start > 0) tl.fromTo(el, {opacity: 0}, {opacity: 1, duration: 0.4, ease: 'none'}, s.start - 0.4);
  else tl.set(el, {opacity: 1}, s.start);
  if (fadeOut) tl.fromTo(el, {opacity: 1}, {opacity: 0, duration: 0.4, ease: 'none', immediateRender: false}, s.end - 0.4);
};
const headIn = (tl, s, delay = 0) => {
  reveal(tl, q(s.id, '.ag-en'), s.start + delay, {dur: 0.9, stagger: 0.03, from: {opacity: 0, y: 30, filter: 'blur(12px)'}});
  reveal(tl, q(s.id, '.ag-zh'), s.start + delay + 0.3, {dur: 0.8, stagger: 0.025});
  tl.fromTo(q(s.id, '.ag-desc'), {opacity: 0, y: 14}, {opacity: 1, y: 0, duration: 0.6, ease: 'expo.out'}, s.start + delay + s.descriptionAt);
  const tag = sec(s.id).querySelector('.ag-tag');
  if (tag) tl.fromTo(tag, {opacity: 0, y: 10}, {opacity: 1, y: 0, duration: 0.6, ease: 'expo.out'}, s.start + delay);
};
const typeIn = (tl, el, t) => tl.fromTo(el.querySelectorAll('.u'), {opacity: 0}, {opacity: 1, duration: 0.01, stagger: 0.045, ease: 'none'}, t);
const lineIn = (tl, lines, t, stagger = 0.3) => tl.fromTo(lines, {opacity: 0, x: -14}, {opacity: 1, x: 0, duration: 0.5, ease: 'expo.out', stagger}, t);
const rise = (tl, el, t, dur = 0.7) => tl.fromTo(el, {opacity: 0, y: 40}, {opacity: 1, y: 0, duration: dur, ease: 'expo.out'}, t);

function buildTitle(tl, s) {
  frame(tl, s, {fadeIn: false});
  reveal(tl, q(s.id, '.ag-en'), s.start + 0.2, {dur: 1.0, stagger: 0.06, from: {opacity: 0, y: 30, filter: 'blur(14px)'}});
  reveal(tl, q(s.id, '.ag-zh'), s.start + 0.9, {stagger: 0.04});
  tl.fromTo(q(s.id, '.ag-desc'), {opacity: 0, y: 14}, {opacity: 1, y: 0, duration: 0.6, ease: 'expo.out'}, s.start + 1.2);
  const n = sec(s.id).querySelector('.ag-notice');
  if (n) tl.fromTo(n, {opacity: 0, y: 60}, {opacity: 1, y: 0, duration: 0.9, ease: 'expo.out'}, s.start + 0.6);
  // poster (public/poster.png) covers the empty first frames for 0.3 s, then fades to reveal the intro
  if (s.start === 0) tl.fromTo('#poster', {opacity: 1}, {opacity: 0, duration: 0.3, ease: 'none'}, 0.3);
}
function buildCards(tl, s) {
  frame(tl, s); headIn(tl, s);
  lineIn(tl, sec(s.id).querySelectorAll('.ag-platform'), at(s, 'enter'), 0.3);
  const term = sec(s.id).querySelector('.ag-term');
  if (term) { rise(tl, term, at(s, 'note') - 0.3); typeIn(tl, q(s.id, '.ag-typed'), at(s, 'note')); }
}
function buildTerminal(tl, s) {
  const c = content(s.id);
  frame(tl, s); headIn(tl, s);
  const term = q(s.id, '.ag-term');
  const first = c.command ? at(s, 'cmd') : at(s, 'p0');
  rise(tl, term, first - 0.4, 0.8);
  if (c.command) typeIn(tl, q(s.id, '.ag-typed'), at(s, 'cmd'));
  const panes = sec(s.id).querySelectorAll('.ag-pane');
  panes.forEach((p, k) => {
    const t = at(s, 'p' + k);
    if (k > 0) { tl.set(p, {opacity: 0}, s.start); tl.set(p, {opacity: 1}, t - 0.3); }
    const lines = p.querySelectorAll('.ag-line');
    lineIn(tl, lines, t, 0.2);
    if (k < panes.length - 1) tl.fromTo(p, {opacity: 1}, {opacity: 0, duration: 0.3, ease: 'none', immediateRender: false}, at(s, 'p' + (k + 1)) - 0.3);
  });
  if (c.qr) {
    tl.fromTo(q(s.id, '.ag-qr'), {opacity: 0, scale: 0.92}, {opacity: 1, scale: 1, duration: 0.7, ease: 'expo.out'}, at(s, 'qr'));
    const keep = q(s.id, '.ag-keep');
    if (keep) tl.fromTo(keep, {opacity: 0}, {opacity: 1, duration: 0.5, ease: 'expo.out'}, at(s, 'qr') + 0.8);
  } else if (c.footer) {
    tl.fromTo(q(s.id, '.ag-keep'), {opacity: 0}, {opacity: 1, duration: 0.5, ease: 'expo.out'}, at(s, 'done'));
  }
  if (c.done) tl.fromTo(q(s.id, '.ag-done'), {opacity: 0, y: 8}, {opacity: 1, y: 0, duration: 0.5, ease: 'expo.out'}, at(s, 'done'));
  if (c.phone) {
    const phone = q(s.id, '.ag-phone');
    tl.fromTo(phone, {opacity: 0, y: 80, scale: 0.96}, {opacity: 1, y: 0, scale: 1, duration: 1.0, ease: 'expo.out'}, at(s, 'phone'));
    tl.fromTo(phone, {scale: 1}, {scale: 1.03, duration: s.end - at(s, 'phone') - 1.5, ease: 'none', immediateRender: false}, at(s, 'phone') + 1.0);
    if (has(s, 'ring')) tl.fromTo(q(s.id, '.ag-hl'), {opacity: 0, scale: 1.06}, {opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out'}, at(s, 'ring'));
  }
}
function buildScreenshot(tl, s) {
  const c = content(s.id);
  frame(tl, s); headIn(tl, s);
  const win = q(s.id, c.frame === 'phone' ? '.ag-phone' : '.ag-browser');
  const enter = at(s, 'enter');
  tl.fromTo(win, {opacity: 0, y: 60, scale: 0.97}, {opacity: 1, y: 0, scale: 1, duration: 1.0, ease: 'expo.out'}, enter);
  tl.fromTo(win, {scale: 1, y: 0}, {scale: 1.06, y: -20, duration: s.end - enter - 1.0, ease: 'none', immediateRender: false}, enter + 1.0);  // slow push so the shot is never still
  if (has(s, 'ring')) tl.fromTo(q(s.id, '.ag-hl'), {opacity: 0, scale: 1.25}, {opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out'}, at(s, 'ring'));
}
function buildEnd(tl, s) {
  frame(tl, s, {fadeOut: false});
  headIn(tl, s, at(s, 'enter') - s.start);
  tl.fromTo(sec(s.id).querySelectorAll('.ag-chip'), {opacity: 0, y: 16}, {opacity: 1, y: 0, duration: 0.6, ease: 'expo.out', stagger: 0.3}, s.start + 2.4);
}
export const BUILDERS = {title: buildTitle, cards: buildCards, terminal: buildTerminal, screenshot: buildScreenshot, end: buildEnd};
export const buildShot = (tl, id) => BUILDERS[content(id).kind](tl, shot(id));
