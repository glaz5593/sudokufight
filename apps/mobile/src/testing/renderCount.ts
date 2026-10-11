/* Test-only: how many times a component renders, for the render budgets of the game screen (docs/PERF.md). */
import { memo, type ReactNode } from 'react';

const counts = new Map<string, number>();

/** The renders counted under `name` since the last reset. */
export const renderCount = (name: string): number => counts.get(name) ?? 0;

export const resetRenderCounts = (): void => counts.clear();

const MEMO = Symbol.for('react.memo');

interface MemoLike {
  $$typeof?: symbol;
  type?: unknown;
  compare?: ((a: object, b: object) => boolean) | null;
}

/**
 * The component, counting each of its renders under `name`. A memo component stays one, with its own
 * comparison, so a render it skips is not counted. In a module mock, every importer gets the counted one:
 *
 *   jest.mock('…/TimerRing', () => {
 *     const actual = jest.requireActual('…/TimerRing');
 *     const { counted } = jest.requireActual('…/testing/renderCount');
 *     return { ...actual, TimerRing: counted('TimerRing', actual.TimerRing) };
 *   });
 */
export function counted<C>(name: string, component: C): C {
  const m = component as MemoLike;
  if (m.$$typeof === MEMO)
    return memo(counted(name, m.type as (p: object) => ReactNode), m.compare ?? undefined) as C;
  const render = component as (props: object) => ReactNode;
  function Counted(props: object): ReactNode {
    counts.set(name, renderCount(name) + 1);
    return render(props);
  }
  Counted.displayName = name;
  return Counted as C;
}
