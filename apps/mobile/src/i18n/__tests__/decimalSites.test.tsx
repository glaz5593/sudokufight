import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatScoreLine } from '@sudoku-fight/engine';
import type { PlayerStats, RecentResult } from '@sudoku-fight/protocol';
import { act, render, screen } from '@testing-library/react-native';
import { createInstance, type i18n as I18n, type Resource, type TFunction } from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';

import { NOW, fourPlayerView, twoPlayerView } from '../../components/player/__fixtures__/gameView';
import { cardModel, leadModel } from '../../components/player/cardModel';
import {
  DEFAULT_DECIMAL,
  formatScore,
  ltr,
  scoreFormat,
  scoreText,
  signedText,
  withDecimal,
} from '../../components/player/format';
import { LeadBar } from '../../components/player/LeadBar';
import { PlayerCardCompact } from '../../components/player/PlayerCardCompact';
import { DeltaLabel, ScoreNumber } from '../../components/player/Score';
import { cardLabel, leadLabel, type PlayerT, pointsText } from '../../components/player/wording';
import { useSettings } from '../../state/settings';
import { priceText } from '../../screens/game/arsenal/wording';
import { RankedSurrender } from '../../screens/game/connection/RankedSurrender';
import { ScoreLine } from '../../screens/game/connection/ScoreLine';
import { PenaltyChip } from '../../screens/levels/hud/FindHud';
import { tutorialPicture } from '../../screens/levels/howToPlayFixtures';
import { type ProgressT, recentWords, statCells } from '../../screens/player/playerCardModel';
import { ExplanationCard } from '../../screens/replay/ReplayParts';
import type { PlayerExplanation, ReplayPlayer } from '../../screens/replay/replayModel';
import { loadPracticeResults } from '../../screens/results/resultsModel';
import { ResultsScreen } from '../../screens/results/ResultsScreen';
import { endedPractice } from '../../screens/results/testing/practiceGames';
import i18n, { localeBundle, NAMESPACES } from '..';

/**
 * D108 (localization plan 0ה): every decimal on screen takes the language's separator (common:number.decimal)
 * and every per cent its pattern (common:number.percent), with Western digits. The formatters of
 * components/player/format.ts take the separator as an argument (a count-up's worklet gets it up front, in
 * scoreFormat), and each site passes the one its t() reads.
 *
 * Two halves: in Hebrew and English every site reads exactly as the code wrote it before ("." and "57%", the
 * old expression written out); in a comma language every site shows "39,5". The comma language is a test
 * fixture (__fixtures__/commaNumbers.json: German's separators over the English strings), never a real locale
 * folder, so the test does not move when a translation lands.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../services/feedback', () => ({ cue: jest.fn(), cueCountUp: jest.fn(() => () => {}) }));
jest.mock('../../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});

interface CommaFixture {
  language: string;
  common: { number: { decimal: string; percent: string } };
}
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'commaNumbers.json'), 'utf8'),
) as CommaFixture;
const COMMA = FIXTURE.language;

/** The comma language: its number keys from the fixture, every other string English (the fallback). */
function commaI18n(): I18n {
  const instance = createInstance();
  void instance.init({
    lng: COMMA,
    fallbackLng: 'en',
    ns: [...NAMESPACES],
    defaultNS: 'common',
    initAsync: false,
    interpolation: { escapeValue: false },
    resources: { en: localeBundle('en') as Resource[string], [COMMA]: { common: FIXTURE.common } },
  });
  return instance;
}

const comma = commaI18n();
const he = i18n.getFixedT('he') as TFunction;
const en = i18n.getFixedT('en') as TFunction;
const de = comma.getFixedT(COMMA) as TFunction;
const fixed = (inst: I18n, lang: string, namespace: string) => inst.getFixedT(lang, namespace);

const hidden = { includeHiddenElements: true };

/** A player card's stats and one recent result, with a half-point best move and a fraction of mistakes. */
const STATS: PlayerStats = {
  games: 7,
  wins: 4,
  losses: 3,
  winRate: 0.57,
  streak: 2,
  bestStreak: 3,
  bestMove: { points: 3.5, gameId: 'g1' },
  avgMistakes: 1.46,
};
const RECENT: RecentResult = {
  gameId: 'g1',
  gameType: 'normal',
  players: 2,
  place: 1,
  outcome: 'win',
  score: 39.5,
  ratingDelta: 12,
  endedAt: NOW,
};

/** Renders in the comma language (react-i18next reads it from the provider). */
const inComma = (ui: ReactElement) => render(<I18nextProvider i18n={comma}>{ui}</I18nextProvider>);

beforeAll(async () => {
  await i18n.changeLanguage('he');
});

afterAll(async () => {
  await i18n.changeLanguage('he');
});

beforeEach(() => {
  useSettings.setState({ reduceMotion: 'system' });
});

describe('the fixture', () => {
  it('is a comma language: "," and "57 %", the rest English', () => {
    expect(de('common:number.decimal')).toBe(',');
    expect(de('common:number.percent', { value: 57 })).toBe('57 %');
    expect(de('common:number.decimal')).not.toBe(en('common:number.decimal'));
    expect(fixed(comma, COMMA, 'player')('points', { count: 2, score: '2' })).toBe(
      fixed(i18n, 'en', 'player')('points', { count: 2, score: '2' }),
    );
  });
});

describe('the helpers', () => {
  it('scoreFormat: a count-up worklet with the separator in it', () => {
    expect(scoreFormat()(39.5)).toBe(scoreText(39.5));
    expect(scoreFormat(DEFAULT_DECIMAL)(-2.5)).toBe(scoreText(-2.5));
    expect(scoreFormat(',')(39.5)).toBe('39,5');
    expect(scoreFormat(',')(-2.5)).toBe(ltr('−2,5'));
    expect(scoreFormat(',')(55)).toBe('55');
  });

  it('withDecimal: the engine\'s score line with the separator; "." leaves it as it is', () => {
    const line = 'points = 9 − 7 + (9 − 6) / 2 = 3.5';
    expect(withDecimal(line)).toBe(line);
    expect(withDecimal(line, '.')).toBe(line);
    expect(withDecimal(line, ',')).toBe('points = 9 − 7 + (9 − 6) / 2 = 3,5');
    expect(withDecimal(ltr('+5.5'), ',')).toBe(ltr('+5,5'));
    expect(withDecimal('a. b 1. 2', ',')).toBe('a. b 1. 2');
  });
});

describe('Hebrew and English: every site exactly as the code wrote it', () => {
  const view = twoPlayerView();
  const nina = cardModel(view, 'nina', 0, NOW);

  it.each([
    ['he', he],
    ['en', en],
  ])('%s: the player components and the player card', (lang, t) => {
    const tp = i18n.getFixedT(lang, 'player') as PlayerT;
    // The old expressions, written out: scoreText(n) and formatScore(n) with no separator, `${n}%`.
    expect(pointsText(39.5, tp)).toBe(tp('points', { count: 39.5, score: scoreText(39.5) }));
    expect(pointsText(-2, tp)).toBe(tp('points', { count: -2, score: scoreText(-2) }));
    const lead = leadModel(view, 0);
    expect(leadLabel(lead, tp)).toBe(
      tp('lead.label', { name: 'MosheG', count: lead.leader!.gap, gap: formatScore(lead.leader!.gap) }),
    );
    expect(cardLabel(nina, tp)).toContain(tp('points', { count: 39.5, score: '39.5' }));

    const tg = i18n.getFixedT(lang, 'progress') as ProgressT;
    const cells = statCells(STATS, tg);
    const value = (key: string) => cells.find((c) => c.key === key)!.value;
    expect(value('winRate')).toBe(ltr(`${57}%`));
    expect(value('bestMove')).toBe(signedText(3.5));
    expect(value('avgMistakes')).toBe(formatScore(1.5));
    expect(recentWords(RECENT, tg, 'Oct 3')).toContain(tg('card.points', { score: formatScore(39.5) }));

    const tgame = i18n.getFixedT(lang, 'game') as Parameters<typeof priceText>[1];
    expect(priceText(2, tgame)).toBe(tgame('arsenal.priceValue', { cost: signedText(-2) }));
    expect(t('common:number.decimal')).toBe('.');
  });

  it('the how-to-play chips: the very objects as before ("." changes nothing)', () => {
    for (const kind of ['duel', 'pointHunter', 'find'] as const)
      for (const index of [0, 1, 2]) {
        const picture = tutorialPicture(kind, index);
        expect(tutorialPicture(kind, index, decimalOf(he))).toBe(picture);
        expect(tutorialPicture(kind, index, decimalOf(en))).toBe(picture);
      }
    expect(chipText('duel', 'duel-gain', '.')).toBe(signedText(3.5));
    expect(chipText('pointHunter', 'hunt-2', '.')).toBe(signedText(5.5));
  });

  it.each(['he', 'en'])(
    '%s: the score count, the delta label, the lead tag, the pips, a score line',
    async (lang) => {
      await i18n.changeLanguage(lang);
      await render(
        <>
          <ScoreNumber score={39.5} tint="#ffffff" textStyle={{}} testID="score" />
          <DeltaLabel
            delta={{ id: 1, value: 3.5, kind: 'gain' }}
            tint="#ffffff"
            textStyle={{}}
            persistent
            testID="delta"
          />
          <LeadBar model={leadModel(view, 0)} />
          <PlayerCardCompact model={cardModel(fourPlayerView(), 'nina', 0, NOW)} width={78} testID="nina" />
          <ScoreLine
            myName="MosheG"
            myScore={55}
            opponentName="NinaVolt"
            opponentScore={39.5}
            opponentColorIndex={1}
            showLead
            testID="line"
          />
        </>,
      );
      expect(screen.getByTestId('score', hidden)).toHaveAnimatedProps({ text: scoreText(39.5) });
      expect(screen.getByTestId('delta', hidden)).toHaveTextContent(signedText(3.5), { exact: true });
      expect(screen.getByTestId('lead-tag', hidden)).toHaveTextContent(signedText(15.5), { exact: true });
      expect(screen.getByTestId('pips', hidden)).toHaveTextContent(ltr('−4.5'), { exact: true });
      expect(screen.getByTestId('line-their-score', hidden)).toHaveTextContent(scoreText(39.5), {
        exact: true,
      });
      expect(screen.getByTestId('line-lead-gap', hidden)).toHaveTextContent(signedText(15.5), {
        exact: true,
      });
    },
  );
});

const decimalOf = (t: TFunction) => t('common:number.decimal');

/** A how-to-play chip's text, by id, from whichever of the kind's three pictures has it. */
function chipText(kind: 'duel' | 'pointHunter', id: string, decimal: string): string {
  for (const index of [0, 1, 2]) {
    const chip = tutorialPicture(kind, index, decimal)?.chips.find((c) => c.id === id);
    if (chip) return chip.text;
  }
  throw new Error(`no chip ${id}`);
}

describe('a comma language: every site writes "39,5"', () => {
  const view = twoPlayerView();

  it("the player components' words: points, the lead, a card's label", () => {
    const tp = fixed(comma, COMMA, 'player') as PlayerT;
    expect(pointsText(39.5, tp)).toBe('39,5 points');
    expect(pointsText(-2.5, tp)).toBe(`${ltr('−2,5')} points`);
    expect(leadLabel(leadModel(view, 0), tp)).toBe('MosheG leads by 15,5 points');
    expect(cardLabel(cardModel(view, 'nina', 0, NOW), tp)).toContain('39,5 points');
  });

  it("the player card: win share in the language's pattern, best move and mistakes per game", () => {
    const tg = fixed(comma, COMMA, 'progress') as ProgressT;
    const cells = statCells(STATS, tg);
    const value = (key: string) => cells.find((c) => c.key === key)!.value;
    expect(value('winRate')).toBe(ltr('57 %'));
    expect(value('bestMove')).toBe(ltr('+3,5'));
    expect(value('avgMistakes')).toBe('1,5');
    expect(recentWords(RECENT, tg, 'Oct 3')).toContain('39,5 pts');
  });

  it('the how-to-play chips', () => {
    expect(chipText('duel', 'duel-gain', de('common:number.decimal'))).toBe(ltr('+3,5'));
    expect(chipText('pointHunter', 'hunt-2', ',')).toBe(ltr('+5,5'));
    expect(chipText('pointHunter', 'hunt-3', ',')).toBe(ltr('+6,5'));
    expect(chipText('pointHunter', 'hunt-1', ',')).toBe(ltr('+6'));
  });

  it('the score count (a worklet), the delta label, the lead tag and the penalty pips', async () => {
    await inComma(
      <>
        <ScoreNumber score={39.5} tint="#ffffff" textStyle={{}} testID="score" />
        <ScoreNumber score={-2.5} tint="#ffffff" textStyle={{}} testID="negative" />
        <DeltaLabel
          delta={{ id: 1, value: 3.5, kind: 'gain' }}
          tint="#ffffff"
          textStyle={{}}
          persistent
          testID="delta"
        />
        <LeadBar model={leadModel(view, 0)} />
        <PlayerCardCompact model={cardModel(fourPlayerView(), 'nina', 0, NOW)} width={78} testID="nina" />
      </>,
    );
    expect(screen.getByTestId('score', hidden)).toHaveAnimatedProps({ text: '39,5' });
    expect(screen.getByTestId('negative', hidden)).toHaveAnimatedProps({ text: ltr('−2,5') });
    expect(screen.getByTestId('delta', hidden)).toHaveTextContent(ltr('+3,5'), { exact: true });
    expect(screen.getByTestId('lead-tag', hidden)).toHaveTextContent(ltr('+15,5'), { exact: true });
    expect(screen.getByTestId('pips', hidden)).toHaveTextContent(ltr('−4,5'), { exact: true });
  });

  it('the score summary of a surrender: both scores, the lead and its label', async () => {
    await inComma(
      <ScoreLine
        myName="MosheG"
        myScore={55}
        opponentName="NinaVolt"
        opponentScore={39.5}
        opponentColorIndex={1}
        showLead
        testID="line"
      />,
    );
    expect(screen.getByTestId('line-their-score', hidden)).toHaveTextContent('39,5', { exact: true });
    expect(screen.getByTestId('line-lead-gap', hidden)).toHaveTextContent(ltr('+15,5'), { exact: true });
    // The names are first-strong isolates (connection/wording.ts nameOf).
    expect(screen.getByTestId('line')).toHaveProp('accessibilityLabel', '⁨MosheG⁩: 55, ⁨NinaVolt⁩: 39,5');
  });

  it('the estimated rating change of a surrender', async () => {
    await inComma(
      <RankedSurrender
        visible
        players={2}
        rating={{ delta: -15.5, guard: null }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText(ltr('−15,5'), hidden)).toBeOnTheScreen();
  });

  it("a stage's penalty chip", async () => {
    await inComma(<PenaltyChip ms={2500} t={fixed(comma, COMMA, 'levels')} />);
    expect(screen.getByTestId('penalty-chip', hidden)).toHaveTextContent(`${ltr('+2,5')} s`, { exact: true });
  });

  it("a replay's explanation: the points chip and the score line", async () => {
    const player: ReplayPlayer = {
      id: 'moshe',
      seat: 0,
      name: 'MosheG',
      isBot: false,
      avatar: 'av00',
      colorIndex: 0,
      isMe: true,
    } as ReplayPlayer;
    const explanation = {
      playerId: 'moshe',
      status: 'correct',
      stepIndex: 3,
      live: true,
      cell: 40,
      cellName: 'E5',
      answer: 6,
      played: 6,
      technique: 'nakedSingle',
      techniqueName: 'Naked single',
      text: 'Row E is only missing 6.',
      wrongText: null,
      points: 3.5,
      penalty: null,
      scoreLine: 'points = 9 − 7 + (9 − 6) / 2 = 3.5',
      penaltyLine: null,
      releaseReason: null,
    } as PlayerExplanation;
    await inComma(<ExplanationCard player={player} explanation={explanation} testID="x" />);
    expect(screen.getByTestId('x-status', hidden)).toHaveTextContent(ltr('+3,5'), { exact: false });
    expect(screen.getByTestId('x-score', hidden)).toHaveTextContent(
      ltr('points = 9 − 7 + (9 − 6) / 2 = 3,5'),
      { exact: true },
    );
    expect(screen.getByTestId('x').props.accessibilityLabel).toContain('= 3,5');
    expect(screen.getByTestId('x').props.accessibilityLabel).not.toMatch(/\d\.\d/);
  });

  it('the results of a practice: the score, the move of the game, its calculation and the think time', async () => {
    const game = await endedPractice();
    const me = game.session.getView().players[0]!;
    const best = me.bestMove!;
    const load = (id: string) =>
      loadPracticeResults(id, { repo: async () => game.repo, session: () => null });
    await inComma(
      <ResultsScreen gameId={game.session.id} load={load} onNewGame={jest.fn()} onHome={jest.fn()} />,
    );
    await act(async () => {
      await new Promise((r) => setImmediate(r));
    });
    expect(screen.getByTestId('results-score', hidden)).toHaveTextContent(scoreText(me.score, ','), {
      exact: true,
    });
    expect(screen.getByTestId('results-best-line', hidden)).toHaveTextContent(
      ltr(withDecimal(formatScoreLine(best.breakdown), ',')),
      { exact: true },
    );
    expect(screen.getByTestId('results-best', hidden)).toHaveTextContent(signedText(best.points, ','), {
      exact: false,
    });
    // Whatever the practice's numbers, no digit on the screen is followed by "." and another digit.
    const texts = screen
      .getAllByText(/\d/, hidden)
      .map((el) => [el.props.children].flat().join(''))
      .join(' ');
    expect(texts).not.toMatch(/\d\.\d/);
    expect(texts).toMatch(/\d,\d/);
  });
});
