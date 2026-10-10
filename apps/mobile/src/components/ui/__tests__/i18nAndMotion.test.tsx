import { ReduceMotion } from 'react-native-reanimated';

import en from '../../../i18n/locales/en/ui.json';
import he from '../../../i18n/locales/he/ui.json';
import { motion } from '../../../theme/motion';
import { timing } from '../motion';

/** Every key of a translation file, dotted. */
function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('ui translations', () => {
  it('has the same keys in Hebrew and English (spec §22)', () => {
    expect(keys(he).sort()).toEqual(keys(en).sort());
  });

  it('has no empty strings', () => {
    const values = (o: object): unknown[] =>
      Object.values(o).flatMap((v) => (typeof v === 'object' && v !== null ? values(v as object) : [v]));
    for (const v of [...values(he), ...values(en)]) expect(v).toEqual(expect.stringMatching(/\S/));
  });
});

describe('ui motion timings', () => {
  it('uses the full duration normally', () => {
    expect(timing(motion.duration.sheetIn, 'standard', false)).toMatchObject({
      duration: motion.duration.sheetIn,
      reduceMotion: ReduceMotion.Never,
    });
  });

  it('becomes the 200 ms fade under reduced motion, and still plays', () => {
    expect(timing(motion.duration.sheetIn, 'exit', true)).toMatchObject({
      duration: motion.duration.reducedFade,
      reduceMotion: ReduceMotion.Never,
    });
  });
});
