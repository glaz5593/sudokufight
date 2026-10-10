import Storage from 'expo-sqlite/kv-store';

import { useSettings } from '../settings';

/**
 * The settings are read and written synchronously (work plan stage 13): the language is there from the
 * first render, and a change is on disk before the app restarts for it.
 */

const onDisk = () => JSON.parse(Storage.getItemSync('settings') ?? 'null') as { state: object } | null;

describe('settings persistence', () => {
  it('writes a change at once', () => {
    useSettings.getState().setLanguage('en');
    useSettings.getState().setReduceMotion('on');
    expect(onDisk()?.state).toEqual({ language: 'en', sound: true, haptics: true, reduceMotion: 'on' });
    useSettings.getState().setLanguage('he');
    expect(onDisk()?.state).toMatchObject({ language: 'he' });
  });

  it('reads the saved settings without waiting', () => {
    useSettings.setState({ language: 'he', sound: true });
    // Another run saved these (setState above wrote too: the store saves every change).
    Storage.setItemSync(
      'settings',
      JSON.stringify({
        state: { language: 'en', sound: false, haptics: true, reduceMotion: 'off' },
        version: 1,
      }),
    );
    void useSettings.persist.rehydrate();
    // No await: already there.
    expect(useSettings.getState()).toMatchObject({ language: 'en', sound: false, reduceMotion: 'off' });
    expect(useSettings.persist.hasHydrated()).toBe(true);
  });
});
