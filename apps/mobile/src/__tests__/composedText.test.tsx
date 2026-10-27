import { render, screen } from '@testing-library/react-native';

import { displayName, ltr, type PlayerT, signedText } from '../components/player';
import i18n from '../i18n';
import { Field } from '../screens/account/Field';
import { NameField } from '../screens/account/NameField';
import { PickerField } from '../screens/account/PickerField';
import { HistoryCard } from '../screens/history/HistoryCard';
import type { HistoryEntry } from '../screens/history/historyModel';
import { isolateName } from '../screens/game/hit/hitModel';
import { SeatTile } from '../screens/match/parts';
import { ExplanationCard } from '../screens/replay/ReplayParts';
import type { PlayerExplanation, ReplayPlayer } from '../screens/replay/replayModel';
import { AwardsSection, RatingSection } from '../screens/results/ResultsVersus';

/**
 * Localization plan 0ה: the screens that built a sentence from parts (a literal space, ". ", ", ", ": ", " · ",
 * "(…)") now take each piece of glue from a key (i18n/compose.ts). In Hebrew and English every label and line must
 * read exactly as before: each check sets what the screen says against the old expression, written out with the
 * same words. The pure sites are in i18n/__tests__/compose.test.ts.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../services/feedback', () => ({ cue: jest.fn() }));

const hidden = { includeHiddenElements: true };
const label = (testID: string) => screen.getByTestId(testID, hidden).props.accessibilityLabel as string;

describe.each(['he', 'en'] as const)('%s reads as before', (lng) => {
  const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { lng, ...options });

  beforeEach(async () => {
    await i18n.changeLanguage(lng);
  });

  it('"VS" between the race cards is player:vs, the same word', () => {
    expect(t('player:vs')).toBe('VS');
  });

  it('a field says its label, its status and its error with ", "', async () => {
    await render(
      <Field
        label="Email"
        accessibilityStatus="OK"
        error="Wrong"
        value=""
        onChangeText={jest.fn()}
        testID="f"
      />,
    );
    expect(label('f')).toBe(['Email', 'OK', 'Wrong'].join(', '));
  });

  it('a picker field says its label and its error with ", "', async () => {
    await render(
      <PickerField
        label="Country"
        value={null}
        placeholder="Choose"
        accessibilityLabel="Country: none"
        error="Required"
        onPress={jest.fn()}
        testID="p"
      />,
    );
    expect(label('p')).toBe(['Country: none', 'Required'].join(', '));
  });

  it("the name field lists the characters it can't take with a space", async () => {
    const check = {
      state: 'invalid' as const,
      name: 'a@b#',
      problem: 'invalidChars' as const,
      chars: ['@', '#'],
    };
    await render(<NameField value="a@b#" onChangeText={jest.fn()} check={check} testID="name" />);
    const error = t('account:name.problem.invalidChars', { chars: ['@', '#'].join(' ') });
    expect(label('name')).toBe(
      [t('account:fields.displayName'), t('account:name.status.invalid'), error].join(', '),
    );
  });

  it('a replay card\'s label: its sentences with a space, the formula after "label: "', async () => {
    const player: ReplayPlayer = {
      id: 'nina',
      seat: 1,
      name: 'NinaVolt',
      isBot: false,
      avatar: 'maya',
      colorIndex: 1,
      isMe: false,
    };
    const x: PlayerExplanation = {
      playerId: 'nina',
      status: 'wrong',
      stepIndex: 3,
      live: true,
      cell: 40,
      cellName: 'E5',
      answer: 7,
      played: 4,
      technique: 'nakedSingle',
      techniqueName: 'Naked single',
      text: 'E5 is only missing 7.',
      wrongText: 'Row E already has 4.',
      points: null,
      penalty: 6.5,
      scoreLine: null,
      penaltyLine: '9 − 4 + 3 / 2 = 6.5',
      releaseReason: null,
    };
    await render(<ExplanationCard player={player} explanation={x} testID="card" />);
    const status = `${t('replay:explain.status.wrong')} ${signedText(-6.5)}`;
    expect(screen.getByTestId('card-status', hidden)).toHaveTextContent(status);
    const old = [
      t('replay:explain.label', {
        name: 'NinaVolt',
        status,
        move: ltr(t('replay:explain.move', { cell: 'E5', digit: 7 })),
        technique: 'Naked single',
        text: 'E5 is only missing 7.',
      }),
      t('replay:explain.played', { digit: 4, answer: 7 }),
      t('replay:explain.why', { digit: 4, text: 'Row E already has 4.' }),
      `${t('replay:explain.penaltyLine')}: ${ltr('9 − 4 + 3 / 2 = 6.5')}`,
    ].join(' ');
    expect(label('card')).toBe(old);
  });

  it('the rating card: ". " between its sentences, "per opponent: " before the pairs', async () => {
    await render(
      <RatingSection
        rating={{ before: 1287, after: 1293, delta: 6, provisional: false }}
        gameType="normal"
        pairs={[
          {
            playerId: 'a',
            name: 'Ann',
            avatar: 'maya',
            isBot: false,
            colorIndex: 1,
            delta: 4.5,
            guard: null,
          },
          {
            playerId: 'b',
            name: 'Ben',
            avatar: 'maya',
            isBot: false,
            colorIndex: 2,
            delta: 1.5,
            guard: null,
          },
        ]}
        guards={[{ playerId: 'c', name: 'Cy', isBot: false, reason: 'leftBeforeMoving' }]}
      />,
    );
    const tp = i18n.getFixedT(lng, 'player') as PlayerT;
    const name = (n: string) => displayName({ name: n, isBot: false }, tp);
    const pairs = [
      t('history:results.rating.pairLabel', { name: name('Ann'), delta: signedText(4.5) }),
      t('history:results.rating.pairLabel', { name: name('Ben'), delta: signedText(1.5) }),
    ];
    const old = [
      t('history:results.rating.label', { delta: signedText(6), before: 1287, after: 1293 }),
      `${t('history:results.rating.perOpponent')}: ${pairs.join(t('game:listSep'))}`,
      t('history:results.rating.guard.leftBeforeMoving', { name: name('Cy') }),
    ].join('. ');
    expect(screen.getByLabelText(old, hidden)).toBeTruthy();
  });

  it('an award: its line, ". ", and its definition', async () => {
    await render(
      <AwardsSection
        awards={[{ kind: 'fastest', winners: [{ playerId: 'me', name: null, mine: true }], value: 5140 }]}
      />,
    );
    const value = t('game:results.awards.value.fastest', { value: '5.1' });
    const line = t('game:results.awards.label', {
      title: t('game:results.awards.fastest'),
      who: t('game:me'),
      value,
    });
    expect(label('results-award-fastest')).toBe(`${line}. ${t('history:results.awardDefinitions.fastest')}`);
  });

  it('my seat at the table: my name, then "(me)" in brackets', async () => {
    const seat = {
      id: 'me',
      name: 'MosheG',
      avatarId: 'maya',
      country: null,
      rating: 1287,
      provisional: false,
      isMe: true,
      colorIndex: 0,
      ready: true,
    } as const;
    await render(<SeatTile seat={seat} showReady reduce />);
    const old = t('match:found.seatLabel', {
      name: `${isolateName('MosheG')} (${t('match:me')})`,
      rating: t('player:rating.label', { value: 1287 }),
      state: t('match:found.ready'),
    });
    expect(label('seat-me')).toBe(old);
  });

  it('a history card: " · " between the place and the opponents, and under the name', async () => {
    const now = Date.UTC(2026, 9, 10, 12);
    const entry: HistoryEntry = {
      id: 'g4',
      source: 'ranked',
      mode: 'ranked',
      gameType: 'normal',
      startedAt: now - 60_000,
      outcome: 'loss',
      place: 2,
      playerCount: 3,
      opponents: [
        { id: 'a', name: 'A', avatar: 'maya', isBot: false, country: null, colorIndex: 1 },
        { id: 'b', name: 'B', avatar: 'maya', isBot: false, country: null, colorIndex: 2 },
      ],
      myScore: 47.5,
      opponentScore: null,
      ratingDelta: 6,
    };
    await render(<HistoryCard entry={entry} myAvatar="maya" now={now} onOpen={jest.fn()} />);
    const who = [t('history:card.place', { place: 2 }), t('history:card.against', { count: 2 })].join(' · ');
    const under = `${t('history:card.outcome.loss')} · ${t('history:card.mode.ranked')} · ${t('game:type.normal')}`;
    expect(screen.getByText(who, hidden)).toBeTruthy();
    expect(screen.getByText(under, hidden)).toBeTruthy();
  });
});
