import { randomInt } from 'node:crypto';

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@sudoku-fight/protocol';

/**
 * A private room's code (stage 7): 6 characters from ROOM_CODE_ALPHABET (no look-alikes), drawn with a
 * cryptographic RNG: 31^6 ≈ 887 million codes, so a code can't be guessed. The code is also the room's id,
 * so joining by code is joinById(code).
 */
export function generateRoomCode(random: (n: number) => number = randomInt): string {
  let code = '';
  for (let k = 0; k < ROOM_CODE_LENGTH; k++) code += ROOM_CODE_ALPHABET[random(ROOM_CODE_ALPHABET.length)];
  return code;
}
