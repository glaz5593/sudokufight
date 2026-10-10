import { createFirebaseAuthProvider } from '../firebaseProvider';

type Fake = ReturnType<typeof import('../testing/fakeFirebase').fakeFirebase>;

// The real package needs the native module; this is its modular API in memory (React Native Firebase 26).
jest.mock('@react-native-firebase/auth', () => {
  const { fakeFirebase } =
    jest.requireActual<typeof import('../testing/fakeFirebase')>('../testing/fakeFirebase');
  const fake = fakeFirebase();
  return { __esModule: true, ...fake.mod, __state: fake.state };
});

const firebase = jest.requireMock<Fake['mod'] & { __state: Fake['state'] }>('@react-native-firebase/auth');

describe('FirebaseAuthProvider with the package itself (mocked)', () => {
  it('requires @react-native-firebase/auth lazily and talks to its modular functions', async () => {
    const provider = createFirebaseAuthProvider();
    expect(firebase.getAuth).not.toHaveBeenCalled();

    const user = await provider.signIn('player@example.com', 'Arena1234');
    expect(user).toEqual({ uid: 'fb-uid-1', email: 'player@example.com', emailVerified: false });
    expect(firebase.getAuth).toHaveBeenCalled();
    expect(firebase.signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'player@example.com',
      'Arena1234',
    );
    expect(await provider.getIdToken(true)).toBe('id-token-fresh');
    expect(firebase.getIdToken).toHaveBeenLastCalledWith(firebase.__state.currentUser, true);

    await expect(provider.signIn('player@example.com', 'wrong')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'wrongPassword',
    });
  });
});
