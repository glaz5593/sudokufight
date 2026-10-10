import type { NameAvailability } from '@sudoku-fight/protocol';
import { act, renderHook } from '@testing-library/react-native';

import { type CheckName, nameSubmittable, useNameCheck } from '../useNameCheck';

/** A check whose answers the test hands out, one per call. */
function controlled() {
  const pending: {
    name: string;
    signal: AbortSignal;
    resolve: (a: NameAvailability) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const check: CheckName = (name, signal) =>
    new Promise((resolve, reject) => pending.push({ name, signal, resolve, reject }));
  return { check, pending };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useNameCheck (spec §3.1, work plan stage 8: debounce 300 ms)', () => {
  it('asks once, 300 ms after the last change, and only about the last name', async () => {
    const { check, pending } = controlled();
    const { result, rerender } = await renderHook(
      ({ name }: { name: string }) => useNameCheck(name, { check }),
      {
        initialProps: { name: '' },
      },
    );
    expect(result.current.state).toBe('idle');

    for (const name of ['Mos', 'Mosh', 'Moshe']) {
      await rerender({ name });
      await act(async () => {
        jest.advanceTimersByTime(299);
      });
    }
    expect(result.current).toMatchObject({ state: 'checking', name: 'Moshe' });
    expect(pending).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(pending.map((p) => p.name)).toEqual(['Moshe']);
    await act(async () => pending[0]!.resolve({ available: true }));
    expect(result.current.state).toBe('available');
    expect(nameSubmittable(result.current.state)).toBe(true);
  });

  it('drops an answer about an older name, and aborts its request', async () => {
    const { check, pending } = controlled();
    const { result, rerender } = await renderHook(
      ({ name }: { name: string }) => useNameCheck(name, { check }),
      {
        initialProps: { name: 'First1' },
      },
    );
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await rerender({ name: 'Second2' });
    expect(pending[0]!.signal.aborted).toBe(true);
    // The old answer arrives late: ignored.
    await act(async () => pending[0]!.resolve({ available: false, reason: 'taken' }));
    expect(result.current).toMatchObject({ state: 'checking', name: 'Second2' });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => pending[1]!.resolve({ available: false, reason: 'taken' }));
    expect(result.current).toMatchObject({ state: 'taken', name: 'Second2' });
    expect(nameSubmittable('taken')).toBe(false);
  });

  it('the rules at once, without asking; trimmed; the own name needs no check', async () => {
    const { check, pending } = controlled();
    const { result, rerender } = await renderHook(
      ({ name }: { name: string }) => useNameCheck(name, { check, current: 'Mine' }),
      {
        initialProps: { name: 'ab' },
      },
    );
    expect(result.current).toMatchObject({ state: 'invalid', problem: 'tooShort' });
    await rerender({ name: 'a b!c' });
    expect(result.current).toMatchObject({ state: 'invalid', problem: 'invalidChars', chars: [' ', '!'] });
    await rerender({ name: '  Mine ' });
    expect(result.current).toMatchObject({ state: 'current', name: 'Mine' });
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(pending).toHaveLength(0);
  });

  it('a server that can’t be asked: "error" (still submittable: the server checks on submit)', async () => {
    const { check, pending } = controlled();
    const { result } = await renderHook(() => useNameCheck('Offline', { check }));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => pending[0]!.reject(new Error('network')));
    expect(result.current.state).toBe('error');
    expect(nameSubmittable('error')).toBe(true);
  });

  it('an invalid or blocked answer from the server', async () => {
    const { check, pending } = controlled();
    const { result, rerender } = await renderHook(
      ({ name }: { name: string }) => useNameCheck(name, { check }),
      {
        initialProps: { name: 'nasty1' },
      },
    );
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => pending[0]!.resolve({ available: false, reason: 'blocked' }));
    expect(result.current.state).toBe('blocked');
    await rerender({ name: 'other1' });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => pending[1]!.resolve({ available: false, reason: 'invalid', problem: 'tooLong' }));
    expect(result.current).toMatchObject({ state: 'invalid', problem: 'tooLong' });
  });
});
