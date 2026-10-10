// DOM helpers shared by every UI module. No framework: template strings + delegation.
import { app } from './store.js';

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any user/data string before putting it in an HTML template. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Create ONE element from an HTML string. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}

/** Create a DocumentFragment from an HTML string (many siblings). */
export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content;
}

/** Hyperscript: h('button', {class: 'btn', onclick: fn, 'aria-label': 'x'}, 'text', childEl) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Class names helper: cx('a', cond && 'b', {c: true}) → "a b c" */
export function cx(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string') out.push(p);
    else if (typeof p === 'object') for (const [k, v] of Object.entries(p)) if (v) out.push(k);
  }
  return out.join(' ');
}

/**
 * Event delegation. on(root, 'click', '[data-act="play"]', (e, target) => …, {signal})
 * Returns an off() function. Pass the screen's ctx.signal so listeners die with the screen.
 */
export function on(root, type, selector, handler, opts = {}) {
  const fn = (e) => {
    const target = selector ? e.target.closest(selector) : root;
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(type, fn, opts);
  return () => root.removeEventListener(type, fn, opts);
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** True when motion should be minimized (OS setting or in-app setting). */
export function reducedMotion() {
  return app.get().settings?.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Web Animations wrapper that respects reduced motion (jumps to the end state).
 * Returns the Animation (await anim.finished) or a resolved stub.
 */
export function animate(node, keyframes, opts = {}) {
  if (!node || !node.animate) return { finished: Promise.resolve(), cancel() {} };
  const o = typeof opts === 'number' ? { duration: opts } : { ...opts };
  if (reducedMotion()) { o.duration = 1; o.delay = 0; o.iterations = 1; }
  return node.animate(keyframes, { easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both', ...o });
}

/** Animate a number in a text node. Returns a promise. format(n) → string. */
export function countUp(node, from, to, { duration = 650, format = (n) => String(Math.round(n * 10) / 10) } = {}) {
  return new Promise((resolve) => {
    if (reducedMotion() || from === to) { node.textContent = format(to); return resolve(); }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      node.textContent = format(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Mount points inside #app */
export const layers = {
  get app() { return document.getElementById('app'); },
  get screens() { return document.querySelector('#app > .screens'); },
  get fx() { return document.getElementById('fx'); },
  get overlays() { return document.getElementById('overlays'); },
  get toasts() { return document.getElementById('toasts'); },
};
