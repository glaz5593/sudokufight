// Global event bus for cross-module signals (prototype controls, connection status, etc.)
//
// Known events (payloads):
//   'lang'                         { lang }
//   'proto:change'                 { key, value }           prototype control changed (app.proto)
//   'proto:opponentDisconnect'     { seconds?, comeBack?: boolean }   simulate an opponent dropping
//   'proto:selfDisconnect'         { seconds?, comeBack?: boolean }   simulate my device dropping
//   'proto:incomingInterference'   { kind }                 fire an interference at me (demo)
//   'proto:botSpeed'               { factor }
//   'net:status'                   { status: 'online'|'offline'|'reconnecting'|'error' }
//   'route'                        { name, params }
const map = new Map();

export const bus = {
  on(evt, fn) {
    if (!map.has(evt)) map.set(evt, new Set());
    map.get(evt).add(fn);
    return () => map.get(evt)?.delete(fn);
  },
  once(evt, fn) {
    const off = bus.on(evt, (d) => { off(); fn(d); });
    return off;
  },
  emit(evt, data) {
    for (const fn of [...(map.get(evt) || [])]) {
      try { fn(data); } catch (e) { console.error(`[bus] ${evt} handler failed`, e); }
    }
  },
};
