import Storage from 'expo-sqlite/kv-store';

import { NO_AVATAR_ID } from '../../avatars';
import { deviceCountry, useProfile } from '../profile';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'he', regionCode: 'IL' }]),
}));

const localization = jest.requireMock<{ getLocales: jest.Mock }>('expo-localization');

/** What the store wrote to the key-value store. */
const saved = async () => JSON.parse((await Storage.getItem('profile')) ?? 'null') as { state: unknown };

describe('the local profile (until accounts, stage 8)', () => {
  beforeEach(() => {
    useProfile.setState({
      name: null,
      avatarId: NO_AVATAR_ID,
      country: 'IL',
      lastPlay: null,
      botLevel: null,
    });
  });

  it('starts nameless, with the empty avatar and the phone region as the country [D21]', () => {
    const initial = useProfile.getInitialState();
    expect(initial).toMatchObject({
      name: null,
      avatarId: NO_AVATAR_ID,
      country: 'IL',
      lastPlay: null,
      botLevel: null,
    });
  });

  it('reads the country from the phone region, or none', () => {
    localization.getLocales.mockReturnValueOnce([{ languageCode: 'en', regionCode: 'us' }]);
    expect(deviceCountry()).toBe('US');
    localization.getLocales.mockReturnValueOnce([{ languageCode: 'en', regionCode: null }]);
    expect(deviceCountry()).toBeNull();
    localization.getLocales.mockReturnValueOnce([]);
    expect(deviceCountry()).toBeNull();
    localization.getLocales.mockImplementationOnce(() => {
      throw new Error('no native module');
    });
    expect(deviceCountry()).toBeNull();
  });

  it('keeps a trimmed name, and none for a blank one', () => {
    useProfile.getState().setName('  MosheG ');
    expect(useProfile.getState().name).toBe('MosheG');
    useProfile.getState().setName('   ');
    expect(useProfile.getState().name).toBeNull();
  });

  it('accepts only two-letter countries', () => {
    useProfile.getState().setCountry('fr');
    expect(useProfile.getState().country).toBe('FR');
    useProfile.getState().setCountry('France');
    expect(useProfile.getState().country).toBeNull();
  });

  it('remembers the last game for "עוד סיבוב", and saves it', async () => {
    useProfile.getState().rememberPlay({ mode: 'solo', gameType: 'hard' });
    expect(useProfile.getState().lastPlay).toEqual({ mode: 'solo', gameType: 'hard' });
    expect((await saved()).state).toEqual({
      name: null,
      avatarId: NO_AVATAR_ID,
      country: 'IL',
      lastPlay: { mode: 'solo', gameType: 'hard' },
      botLevel: null,
    });
  });

  it('a practice against a bot also remembers its level, which a later solo practice keeps', async () => {
    useProfile.getState().rememberPlay({ mode: 'bot', gameType: 'fast', botLevel: 4 });
    expect(useProfile.getState()).toMatchObject({
      lastPlay: { mode: 'bot', gameType: 'fast', botLevel: 4 },
      botLevel: 4,
    });
    useProfile.getState().rememberPlay({ mode: 'solo', gameType: 'normal', botLevel: 2 });
    expect(useProfile.getState().lastPlay).toEqual({ mode: 'solo', gameType: 'normal' });
    expect(useProfile.getState().botLevel).toBe(4);
    expect((await saved()).state).toMatchObject({ lastPlay: { mode: 'solo' }, botLevel: 4 });
  });

  it('drops what it does not know when it loads (an old or damaged save)', async () => {
    await Storage.setItem(
      'profile',
      JSON.stringify({
        version: 1,
        state: {
          name: ' Nina ',
          avatarId: 'av36', // not in the catalog
          country: 'Israel',
          lastPlay: { mode: 'solo', gameType: 'blitz' },
        },
      }),
    );
    await useProfile.persist.rehydrate();
    expect(useProfile.getState()).toMatchObject({
      name: 'Nina',
      avatarId: NO_AVATAR_ID,
      country: 'IL',
      lastPlay: null,
    });

    await Storage.setItem(
      'profile',
      JSON.stringify({
        version: 1,
        state: { avatarId: 'lava-lamp', country: 'gb', lastPlay: { mode: 'solo', gameType: 'fast' } },
      }),
    );
    await useProfile.persist.rehydrate();
    expect(useProfile.getState()).toMatchObject({
      avatarId: 'lava-lamp',
      country: 'GB',
      lastPlay: { mode: 'solo', gameType: 'fast' },
      botLevel: null,
    });

    // An avatar of the retired av01–av51 pack (saved before our own characters) reads as its replacement.
    await Storage.setItem('profile', JSON.stringify({ version: 1, state: { avatarId: 'av07' } }));
    await useProfile.persist.rehydrate();
    expect(useProfile.getState().avatarId).toBe('lava-lamp');
    await Storage.setItem('profile', JSON.stringify({ version: 1, state: { avatarId: 'av50' } }));
    await useProfile.persist.rehydrate();
    expect(useProfile.getState().avatarId).toBe('fox');

    // A bot level that is not one of the five, here or in the last play, is dropped.
    await Storage.setItem(
      'profile',
      JSON.stringify({
        version: 1,
        state: { botLevel: 9, lastPlay: { mode: 'bot', gameType: 'hard', botLevel: 0 } },
      }),
    );
    await useProfile.persist.rehydrate();
    expect(useProfile.getState()).toMatchObject({ botLevel: null, lastPlay: { mode: 'solo' } });

    await Storage.setItem(
      'profile',
      JSON.stringify({
        version: 1,
        state: { botLevel: 2, lastPlay: { mode: 'bot', gameType: 'hard', botLevel: 5 } },
      }),
    );
    await useProfile.persist.rehydrate();
    expect(useProfile.getState()).toMatchObject({
      botLevel: 2,
      lastPlay: { mode: 'bot', gameType: 'hard', botLevel: 5 },
    });
  });
});
