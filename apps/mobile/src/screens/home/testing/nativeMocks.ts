/* Test-only: stand-ins for the native modules behind the feedback cues (spec §22 sound and haptics). */

/** expo-audio: players that play nothing. */
export const expoAudio = {
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  createAudioPlayer: jest.fn(() => ({
    volume: 1,
    playing: false,
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    remove: jest.fn(),
  })),
};

/** expo-haptics, with the enums the haptics service reads. */
export const expoHaptics = {
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
};

/** The practice database module: the tests decide what practiceStorageOrNull() gives. */
export const practiceStorage = {
  PRACTICE_DB_NAME: 'practice.db',
  openPracticeStorage: jest.fn(),
  practiceStorageOrNull: jest.fn(),
};
