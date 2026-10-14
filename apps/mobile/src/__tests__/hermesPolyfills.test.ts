/* eslint-disable @typescript-eslint/no-require-imports -- each test loads modules fresh, after changing globals */
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Hermes on the phone has no FinalizationRegistry; Node (Jest) does. These tests take it away, the way the phone
// does, and check that the online code still loads once the app's stand-ins are in place.

type Global = { FinalizationRegistry?: unknown; WeakRef?: unknown };
const g = globalThis as Global;
const realRegistry = g.FinalizationRegistry;
const realWeakRef = g.WeakRef;

afterEach(() => {
  g.FinalizationRegistry = realRegistry;
  g.WeakRef = realWeakRef;
});

function withoutEngineGlobals(): void {
  delete g.FinalizationRegistry;
  delete g.WeakRef;
}

describe('hermes stand-ins', () => {
  it('@colyseus/schema fails to load without FinalizationRegistry (what crashed the phone)', () => {
    withoutEngineGlobals();
    jest.isolateModules(() => {
      expect(() => require('@colyseus/schema')).toThrow(/FinalizationRegistry/);
    });
  });

  it('with the stand-ins, @colyseus/schema loads', () => {
    withoutEngineGlobals();
    jest.isolateModules(() => {
      require('../services/hermesPolyfills');
      expect(() => require('@colyseus/schema')).not.toThrow();
    });
  });

  it('the stand-ins behave: register/unregister do nothing, deref returns the target', () => {
    withoutEngineGlobals();
    jest.isolateModules(() => {
      require('../services/hermesPolyfills');
    });
    const Registry = g.FinalizationRegistry as new (cb: (v: unknown) => void) => {
      register(t: object, v: unknown, token?: object): void;
      unregister(token: object): boolean;
    };
    const registry = new Registry(() => {
      throw new Error('never called');
    });
    const token = {};
    expect(() => registry.register({}, 1, token)).not.toThrow();
    expect(registry.unregister(token)).toBe(false);
    const WeakRefStandIn = g.WeakRef as new <T extends object>(t: T) => { deref(): T };
    const target = { a: 1 };
    expect(new WeakRefStandIn(target).deref()).toBe(target);
  });

  it('keeps the engine’s own FinalizationRegistry and WeakRef when they exist', () => {
    jest.isolateModules(() => {
      require('../services/hermesPolyfills');
    });
    expect(g.FinalizationRegistry).toBe(realRegistry);
    expect(g.WeakRef).toBe(realWeakRef);
  });

  it('app/_layout.tsx imports the stand-ins before anything else', () => {
    const layout = readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    const firstImport = layout.split('\n').find((line) => line.startsWith('import '));
    expect(firstImport).toBe("import '../src/services/hermesPolyfills';");
  });
});
