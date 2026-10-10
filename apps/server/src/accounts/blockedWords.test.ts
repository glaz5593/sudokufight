import blockedWordsFile from '../../data/blocked-words.json';
import { BlockedWords, defaultBlockedWords, foldText, partsOf, readingsOf } from './blockedWords';

const words = defaultBlockedWords();
const blocked = (name: string) => words.match(name)?.word ?? null;

describe('the blocked-words list (apps/server/data/blocked-words.json)', () => {
  it('loads, with English and Hebrew words and reserved names', () => {
    expect(blockedWordsFile.en.substring.length).toBeGreaterThan(10);
    expect(blockedWordsFile.he.substring.length).toBeGreaterThan(10);
    expect(blockedWordsFile.reserved.exact).toContain('admin');
    expect(words.size).toBeGreaterThan(100);
  });

  it('blocks every word it lists, as written', () => {
    for (const list of ['en', 'he', 'reserved'] as const) {
      for (const word of [...blockedWordsFile[list].substring, ...blockedWordsFile[list].exact]) {
        expect([word, words.match(word)]).toEqual([word, expect.objectContaining({ list })]);
      }
    }
  });

  it('refuses to start with a word that is not letters only', () => {
    const list = (w: string) => ({
      en: { substring: [w], exact: [] },
      he: { substring: [], exact: [] },
      reserved: { substring: [], exact: [] },
      allow: [],
    });
    expect(() => new BlockedWords(list('two words'))).toThrow(
      /"two words" \(en.substring\) must be letters only/,
    );
    expect(() => new BlockedWords(list('l33t'))).toThrow(/letters only/);
    expect(() => new BlockedWords(list(''))).toThrow(/letters only/);
  });
});

describe('matching', () => {
  it('ignores case', () => {
    expect(blocked('FUCK')).toBe('fuck');
    expect(blocked('FuCkEr')).toBe('fuck');
    expect(blocked('BiTcH')).toBe('bitch');
  });

  it('finds substring words anywhere, through separators', () => {
    expect(blocked('xfuckx')).toBe('fuck');
    expect(blocked('f.u.c.k')).toBe('fuck');
    expect(blocked('f_u_c_k')).toBe('fuck');
    expect(blocked('bull.shit')).toBe('shit');
    expect(blocked('a.s.s.h.o.l.e')).toBe('asshole');
  });

  it('reads common leetspeak', () => {
    expect(blocked('sh1t')).toBe('shit');
    expect(blocked('5h1t')).toBe('shit');
    expect(blocked('b1tch')).toBe('bitch');
    expect(blocked('s1ut')).toBe('slut'); // 1 as l
    expect(blocked('a55hole')).toBe('asshole');
    expect(blocked('n1gg3r')).toBe('nigger');
    expect(blocked('@ss')).toBe('ass');
    expect(blocked('pr0n')).toBeNull(); // letters swapped: not a reading
    expect(blocked('p0rn')).toBe('porn');
    expect(blocked('h1tl3r')).toBe('hitler');
  });

  it('ignores digits used as padding', () => {
    expect(blocked('fu12ck')).toBe('fuck');
    expect(blocked('ass69')).toBe('ass');
    expect(blocked('69dick')).toBe('dick');
  });

  it('finds a letter repeated any number of times', () => {
    expect(blocked('fuuuuck')).toBe('fuck');
    expect(blocked('shiiiit')).toBe('shit');
    expect(blocked('asssss')).toBe('ass');
    expect(blocked('זונננה')).toBe('זונה');
    // …but not a letter left out: Niger (a country) is not the slur.
    expect(blocked('Niger')).toBeNull();
    expect(blocked('Nigeria_fan')).toBeNull();
  });

  it('ignores niqqud and accents', () => {
    expect(blocked('זוֹנָה')).toBe('זונה');
    expect(blocked('שַׁרְמוּטָה')).toBe('שרמוטה');
    expect(blocked('fück')).toBe('fuck');
    expect(blocked('shït')).toBe('shit');
  });

  it('treats Hebrew final letters as regular ones, both ways', () => {
    expect(blocked('זין')).toBe('זין');
    expect(blocked('זינ')).toBe('זין');
    expect(blocked('כוסאמק')).toBe('כוסאמק');
    expect(blocked('ציצים')).toBe('ציצים');
    expect(blocked('ציצימ')).toBe('ציצים');
    expect(blocked('מזדיינ')).toBe('זדיין');
  });

  it('finds Hebrew words through separators and repeats', () => {
    expect(blocked('בן.זונה')).toBe('זונה');
    expect(blocked('ש_ר_מ_ו_ט_ה')).toBe('שרמוטה');
    expect(blocked('מניאקקק')).toBe('מניאק');
    expect(blocked('ש־רמוטה')).toBe('שרמוטה'); // maqaf
  });

  describe('exact words: the whole name or one of its parts, never inside a word', () => {
    it.each([
      ['ass', 'ass'],
      ['ass_man', 'ass'],
      ['BigAss', 'ass'],
      ['big.dick', 'dick'],
      ['BigDick', 'dick'],
      ['DICK', 'dick'],
      ['משהDick', 'dick'],
      ['dickמשה', 'dick'],
      ['חרא', 'חרא'],
      ['חרא_גדול', 'חרא'],
      ['ערס', 'ערס'],
      ['כוס', 'כוס'],
      ['nazi', 'nazi'],
      ['Nazi88', 'nazi'],
    ])('%s is blocked (%s)', (name, word) => {
      expect(blocked(name)).toBe(word);
    });

    it.each([
      'class',
      'Bass',
      'Assaf',
      'Hassan',
      'Cassandra',
      'Passover',
      'assassin',
      'Canal',
      'Analyst',
      'peacock',
      'Hancock',
      'Dickens',
      'therapist',
      'grape',
      'Essex',
      'Ashkenazi',
      'Nazir',
      'spicy',
      'Cumming',
      'Titus',
      'אחראי',
      'ערסל',
      'כוסות',
      'זינוק',
      'תחתית',
      'שיטה',
      'badminton',
    ])('%s is fine', (name) => {
      expect(blocked(name)).toBeNull();
    });
  });

  it('lets allowed words through, but not a blocked word next to them', () => {
    expect(blocked('Shitrit')).toBeNull();
    expect(blocked('Dana.Shitrit')).toBeNull();
    expect(blocked('ShitritShit')).toBe('shit');
  });

  it('refuses names that pose as the game or its staff', () => {
    expect(blocked('admin')).toBe('admin');
    expect(blocked('Admin_1')).toBe('admin');
    expect(blocked('TheAdmin')).toBe('admin');
    expect(blocked('SudokuFight')).toBe('sudokufight');
    expect(blocked('sudoku.fight')).toBe('sudokufight');
    expect(blocked('סודוקו_פייט')).toBe('סודוקופייט');
    expect(blocked('Moderator7')).toBe('moderator');
    expect(blocked('מנהל')).toBe('מנהל');
    expect(blocked('official')).toBe('official');
  });

  it.each([
    'Moshe',
    'Dana',
    'משה',
    'דנה',
    'Player_1',
    'SudokuMaster',
    'Sudoku_King',
    'סודוקו_מלך',
    'Ninja.42',
    'Grandmaster',
    'Noa.K',
    'יוסי_כהן',
    'Shira123',
    'B055',
    'L33T',
  ])('lets ordinary names through: %s', (name) => {
    expect(blocked(name)).toBeNull();
  });
});

describe('the pieces', () => {
  it('folds case, marks and final letters', () => {
    expect(foldText('ABC')).toBe('abc');
    expect(foldText('שָׁלוֹם')).toBe('שלומ');
    expect(foldText('Ünïcödé')).toBe('unicode');
    expect(foldText('ךםןףץ')).toBe('כמנפצ');
  });

  it('reads leetspeak two ways, and without digits', () => {
    expect(readingsOf('s1ut')).toEqual(['siut', 'slut', 'sut']);
    expect(readingsOf('a.b_c')).toEqual(['abc']);
    expect(readingsOf('123')).toEqual(['ie', 'le']); // 2 is no letter
    expect(readingsOf('26')).toEqual([]);
  });

  it('splits a name into parts', () => {
    expect(partsOf('big_dick.69')).toEqual(['big', 'dick', '69']);
    expect(partsOf('BigDick')).toEqual(['Big', 'Dick']);
    expect(partsOf('DICK')).toEqual(['DICK']);
    expect(partsOf('משהDick')).toEqual(['משה', 'Dick']);
    expect(partsOf('sh1t')).toEqual(['sh1t']);
    expect(partsOf('..a..')).toEqual(['a']);
  });
});
