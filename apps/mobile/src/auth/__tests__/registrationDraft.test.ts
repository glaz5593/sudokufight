import { AVATAR_IDS } from '@sudoku-fight/protocol';
import Storage from 'expo-sqlite/kv-store';

import { useRegistrationDraft } from '../registrationDraft';

/** Step 1 of the registration kept on the phone: what it reads back (spec §3.2). */

const load = async (state: Record<string, unknown>) => {
  await Storage.setItem('registration', JSON.stringify({ version: 1, state }));
  await useRegistrationDraft.persist.rehydrate();
  return useRegistrationDraft.getState();
};

describe('the registration draft', () => {
  beforeEach(() => useRegistrationDraft.getState().reset());

  it('starts on the first avatar of the picker', () => {
    expect(useRegistrationDraft.getState().avatarId).toBe(AVATAR_IDS[0]);
  });

  it('reads back a chosen avatar; one of the retired av01–av51 pack as its replacement', async () => {
    expect((await load({ avatarId: 'cassette', displayName: 'MosheG' })).avatarId).toBe('cassette');
    expect((await load({ avatarId: 'av07' })).avatarId).toBe('lava-lamp');
    expect((await load({ avatarId: 'av41' })).avatarId).toBe('panda');
  });

  it('remembers which account accepted the terms (an account id only), until reset', async () => {
    expect(useRegistrationDraft.getState().termsAcceptedBy).toBeNull();
    useRegistrationDraft.getState().acceptTermsFor('fbg-1');
    expect(useRegistrationDraft.getState().termsAcceptedBy).toBe('fbg-1');
    expect(JSON.parse((await Storage.getItem('registration'))!).state.termsAcceptedBy).toBe('fbg-1');
    useRegistrationDraft.getState().reset();
    expect(useRegistrationDraft.getState().termsAcceptedBy).toBeNull();
    for (const junk of [true, '', 42, null, 'x'.repeat(129)])
      expect((await load({ termsAcceptedBy: junk })).termsAcceptedBy).toBeNull();
    // An earlier draft's "accepted on this phone" says nothing about any account.
    expect((await load({ termsAccepted: true })).termsAcceptedBy).toBeNull();
    expect((await load({ termsAcceptedBy: 'fbg-2' })).termsAcceptedBy).toBe('fbg-2');
  });

  it('keeps its avatar when the saved one is unknown or "no avatar"', async () => {
    useRegistrationDraft.getState().setAvatar('fox');
    expect((await load({ avatarId: 'av36' })).avatarId).toBe('fox');
    expect((await load({ avatarId: 'av00' })).avatarId).toBe('fox');
    expect((await load({ avatarId: 42 })).avatarId).toBe('fox');
  });
});
