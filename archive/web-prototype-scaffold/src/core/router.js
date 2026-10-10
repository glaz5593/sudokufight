// Screen router with game-style transitions and deep links.
//
// registerScreen('home', {
//   title: { he: 'בית', en: 'Home' },          // for the studio index
//   group: 'core',                              // studio index grouping (see CONTRACT.md §Screens)
//   specRef: '§4',                              // spec section this screen implements
//   demos: [{ id: 'empty', label: { he: '…', en: '…' }, params: { … } }],
//   render(root, params, ctx) { … return cleanupFn },   // root = <section class="screen screen--home">
//   onLang(root, params, ctx) { … }             // optional: handle language switch without full re-render
// })
//
// go('game', { mode: 'bot' }, { transition: 'forward' | 'back' | 'fade' | 'slam' | 'none', replace: false })
// Deep link: #home   #game~2p   (screen~demoId) — only [A-Za-z0-9._~-] are allowed in artifact hashes.
import { layers, animate, reducedMotion } from './dom.js';
import { bus } from './bus.js';
import { isRTL } from './i18n.js';

const screens = new Map();
const stack = [];            // [{ name, params }]
let current = null;          // { name, params, root, cleanup, abort }
let navToken = 0;

export function registerScreen(name, def) {
  screens.set(name, { name, ...def });
}

export const listScreens = () => [...screens.values()];
export const getScreen = (name) => screens.get(name);
export const currentRoute = () => (current ? { name: current.name, params: current.params } : null);

export function go(name, params = {}, opts = {}) {
  if (!screens.has(name)) { console.warn(`[router] unknown screen "${name}" — going home`); name = 'home'; params = {}; }
  const transition = opts.transition || 'forward';
  if (opts.replace && stack.length) stack.pop();
  if (opts.resetStack) stack.length = 0;
  stack.push({ name, params });
  return mount(name, params, transition);
}

export function back(fallback = 'home') {
  if (stack.length > 1) {
    stack.pop();
    const prev = stack[stack.length - 1];
    return mount(prev.name, prev.params, 'back');
  }
  stack.length = 0;
  return go(fallback, {}, { transition: 'back' });
}

/** Re-render the current screen in place (used on language switch). */
export function refresh() {
  if (!current) return;
  const def = screens.get(current.name);
  if (def?.onLang) { try { def.onLang(current.root, current.params, current.ctx); } catch (e) { console.error(e); } return; }
  mount(current.name, current.params, 'none');
}

function updateHash(name, params) {
  const token = params?.demo ? `${name}~${params.demo}` : name;
  try { history.replaceState(null, '', `#${token}`); } catch { /* sandboxed */ }
}

async function mount(name, params, transition) {
  const token = ++navToken;
  const def = screens.get(name);
  const host = layers.screens;
  const prev = current;

  const root = document.createElement('section');
  root.className = `screen screen--${name}`;
  root.dataset.screen = name;
  const abort = new AbortController();
  const ctx = { params, signal: abort.signal, go, back, replace: (n, p) => go(n, p, { replace: true, transition: 'fade' }), token };

  host.append(root);
  let cleanup = null;
  try {
    cleanup = (await def.render(root, params, ctx)) || null;
  } catch (e) {
    console.error(`[router] render failed for "${name}"`, e);
    root.innerHTML = `<div style="padding:24px;color:var(--strike)"><b>Render error in “${name}”</b><pre style="white-space:pre-wrap;font-size:12px">${String(e && e.stack || e).replace(/</g, '&lt;')}</pre></div>`;
  }
  if (token !== navToken) { // a newer navigation started while we rendered
    abort.abort(); try { cleanup?.(); } catch {} root.remove(); return;
  }
  current = { name, params, root, cleanup, abort, ctx };
  updateHash(name, params);
  bus.emit('route', { name, params });

  if (prev) {
    prev.abort.abort();
    try { prev.cleanup?.(); } catch (e) { console.error(e); }
    await playTransition(prev.root, root, transition);
    prev.root.remove();
  } else {
    animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
  }
}

function playTransition(oldEl, newEl, kind) {
  if (kind === 'none' || reducedMotion()) return Promise.resolve();
  const dirSign = isRTL() ? -1 : 1;
  oldEl.classList.add('is-leaving'); newEl.classList.add('is-entering');
  oldEl.style.pointerEvents = 'none';
  let a, b;
  const D = 300, E = 'cubic-bezier(.7,0,.2,1)';
  if (kind === 'forward' || kind === 'back') {
    const s = (kind === 'forward' ? 1 : -1) * dirSign;
    newEl.style.zIndex = '2';
    a = animate(newEl, [{ transform: `translateX(${s * 100}%) skewX(${-s * 4}deg)`, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: D, easing: E });
    b = animate(oldEl, [{ transform: 'none', opacity: 1, filter: 'brightness(1)' }, { transform: `translateX(${-s * 28}%)`, opacity: 0.3, filter: 'brightness(.5)' }], { duration: D, easing: E });
  } else if (kind === 'slam') { // entering a match: punch-in
    newEl.style.zIndex = '2';
    a = animate(newEl, [{ transform: 'scale(1.18)', opacity: 0, filter: 'blur(6px)' }, { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.25,1.15)' });
    b = animate(oldEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 });
  } else { // fade
    newEl.style.zIndex = '2';
    a = animate(newEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    b = animate(oldEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
  }
  return Promise.all([a.finished, b.finished]).catch(() => {}).then(() => {
    newEl.classList.remove('is-entering'); newEl.style.zIndex = '';
    newEl.getAnimations?.().forEach((x) => x.cancel());
  });
}

/** Resolve the initial route from location.hash: "#name" or "#name~demo". */
export function routeFromHash(defaultName = 'home') {
  const raw = (location.hash || '').slice(1);
  if (!raw) return { name: defaultName, params: {} };
  const [name, demoId] = raw.split('~');
  const def = screens.get(name);
  if (!def) return { name: defaultName, params: {} };
  if (demoId) {
    const demo = (def.demos || []).find((d) => d.id === demoId);
    if (demo) return { name, params: { ...(demo.params || {}), demo: demoId } };
  }
  return { name, params: {} };
}

/** Navigate to a screen demo by id (used by the studio index). */
export function goDemo(name, demoId, transition = 'fade') {
  const def = screens.get(name);
  const demo = (def?.demos || []).find((d) => d.id === demoId);
  stack.length = 0;
  if (name !== 'home') stack.push({ name: 'home', params: {} });
  return go(name, demo ? { ...(demo.params || {}), demo: demoId } : {}, { transition });
}
