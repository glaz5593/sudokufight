import i18n from '../../../../i18n';
import { about, MARK, myNameOf, nameOf, sentences, spellCode, splitMarked } from '../wording';

const t = i18n.getFixedT('he', 'game');
const tEn = i18n.getFixedT('en', 'game');

describe('connection wording', () => {
  it('splits a sentence around its marked number', () => {
    expect(splitMarked(`יש לך עוד ${MARK} שניות לחזור`)).toEqual(['יש לך עוד ', ' שניות לחזור']);
    expect(splitMarked(`${MARK} left`)).toEqual(['', ' left']);
    expect(splitMarked('no number')).toBeNull();
  });

  it('spells a room code letter by letter', () => {
    expect(spellCode('ABC234')).toBe('A B C 2 3 4');
  });

  it('isolates a name, or says "היריב" / "אני" without one', () => {
    expect(nameOf('NinaVolt', t)).toBe('⁨NinaVolt⁩');
    expect(nameOf(null, t)).toBe('היריב');
    expect(myNameOf(null, t)).toBe('אני');
    expect(myNameOf('MosheG', tEn)).toBe('⁨MosheG⁩');
    expect(nameOf(null, tEn)).toBe('Opponent');
  });

  it('joins sentences, without a full stop after a part that already ends one', () => {
    expect(sentences(['החיבור שלך אבד', 'מתחבר מחדש…', 'ניסיון 2'], t)).toBe(
      'החיבור שלך אבד. מתחבר מחדש… ניסיון 2',
    );
    expect(sentences(['a', null, false, undefined, '', 'b:', 'c'], tEn)).toBe('a. b: c');
    expect(sentences([], t)).toBe('');
  });

  it('passes the gender as an i18next context only when there is one', () => {
    expect(about()).toEqual({});
    expect(about('female')).toEqual({ context: 'female' });
  });
});
