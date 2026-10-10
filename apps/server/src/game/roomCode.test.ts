import { normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@sudoku-fight/protocol';

import { generateRoomCode } from './roomCode';

describe('room codes', () => {
  it('are 6 characters from the alphabet without look-alikes', () => {
    for (let k = 0; k < 200; k++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
      expect(normalizeRoomCode(code.toLowerCase())).toBe(code);
    }
  });

  it('come from the random source (crypto by default)', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAAAA');
    expect(generateRoomCode((n) => n - 1)).toBe('999999');
    const codes = new Set(Array.from({ length: 500 }, () => generateRoomCode()));
    expect(codes.size).toBe(500); // ~887 million codes: no repeats in a few hundred
  });
});
