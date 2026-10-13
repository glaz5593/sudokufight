import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nManager } from 'react-native';

import { AVATAR_REACTIONS } from '../../../avatars/reactions';
import { shownFace } from '../../../avatars/testing/avatarTesting';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { replayFaces } from '../replayFaces';
import { buildReplay, type Replay, stepView } from '../replayModel';
import { ReplayScreen } from '../ReplayScreen';
import { loadReplay } from '../replaySource';
import { fourPlayerGame, soloGame } from '../testing/games';
import { memoryRepo, savePractice } from '../testing/sources';

/**
 * The avatars in the replay (spec §13, §3.4): at each step, every player's mood in that step's picture, and the
 * reaction to what they did in the step; only the step on screen reacts, once the replay stays on it, so a
 * jump or a drag along the timeline never plays a backlog.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };

const table = fourPlayerGame();
const replay: Replay = buildReplay(table.log, { me: 'p1' });
const facesAt = (k: number, play = true) => replayFaces(replay, k, stepView(replay, k, 'he').view, play);
const stepOf = (kind: string, from = 0) => replay.steps.findIndex((s, k) => k >= from && s.kind === kind);

describe('replayFaces (pure)', () => {
  it('the start: everyone calm, nothing to play', () => {
    for (const face of Object.values(facesAt(0)))
      expect(face).toEqual({ expression: 'neutral', reaction: null });
  });

  it('a correct move: its player smiles and nods; the others play nothing', () => {
    const k = stepOf('correct');
    const mover = replay.steps[k]!.playerId!;
    const faces = facesAt(k);
    expect(faces[mover]!.reaction).toMatchObject({ expression: 'smile', motion: 'nod' });
    for (const [id, face] of Object.entries(faces)) if (id !== mover) expect(face!.reaction).toBeNull();
  });

  it('a mistake: sad and shake', () => {
    const k = stepOf('wrong');
    expect(facesAt(k)[replay.steps[k]!.playerId!]!.reaction).toMatchObject({
      expression: 'sad',
      motion: 'shake',
    });
  });

  it('an interference: the target dizzy (its mood too, while it lasts), the sender winks', () => {
    const k = stepOf('interference');
    const s = replay.steps[k]!;
    const faces = facesAt(k);
    expect(faces[s.targetId!]).toMatchObject({ expression: 'dizzy', reaction: { motion: 'wobble' } });
    expect(faces[s.playerId!]!.reaction).toMatchObject({ expression: 'wink' });
  });

  it('a surrender: sad, and out (sad) from then on', () => {
    const k = stepOf('surrender');
    const who = replay.steps[k]!.playerId!;
    expect(facesAt(k)[who]).toMatchObject({ expression: 'sad', reaction: { expression: 'sad' } });
    expect(facesAt(k + 1)[who]!.expression).toBe('sad');
  });

  it('the last step: the winner laughs and spins, everyone else is sad (the end beats the last move)', () => {
    const k = replay.steps.length - 1;
    const ranking = replay.result!.ranking;
    const faces = facesAt(k);
    for (const r of ranking) {
      if (r.place === 1)
        expect(faces[r.playerId]).toMatchObject({ expression: 'smile', reaction: { motion: 'spin' } });
      else expect(faces[r.playerId]).toMatchObject({ expression: 'sad', reaction: { expression: 'sad' } });
    }
  });

  it('without `play` (moving along): the moods only', () => {
    const k = stepOf('interference');
    const faces = facesAt(k, false);
    expect(faces[replay.steps[k]!.targetId!]).toEqual({ expression: 'dizzy', reaction: null });
    for (const face of Object.values(faces)) expect(face!.reaction).toBeNull();
  });

  it('every step its own key: the same reaction at two steps plays at both', () => {
    const k = stepOf('correct');
    const j = stepOf('correct', k + 1);
    const key = (i: number) => facesAt(i)[replay.steps[i]!.playerId!]!.reaction!.key;
    expect(key(k)).not.toBe(key(j));
  });
});

describe('the replay screen', () => {
  async function show() {
    const repo = await memoryRepo();
    const solo = soloGame();
    await savePractice(repo, solo);
    const deps = { practice: async () => repo, ranked: null, myAvatar: 'fox' as const, myCountry: 'IL' };
    await render(
      <ReplayScreen gameId={solo.config.id} load={(g) => loadReplay(g, null, deps)} onBack={jest.fn()} />,
    );
    await act(async () => {
      await new Promise((r) => setImmediate(r));
    });
    return buildReplay(solo.log, { me: 'me' });
  }
  const myFace = () => shownFace(screen.getByTestId('replay-card-me-avatar-image', hidden));
  /** `ms` on the phone's timers, then what they started at once (AvatarArt starts a reaction on a 0 ms timer). */
  async function wait(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
  }
  const settle = AVATAR_REACTIONS.replaySettleMs;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'on' });
  });
  afterEach(() => jest.useRealTimers());

  it('"שלב הבא" onto a correct move: my avatar smiles once the replay stays there', async () => {
    const solo = await show();
    expect(solo.steps[2]!.kind).toBe('correct');
    await fireEvent.press(screen.getByTestId('replay-next'));
    await fireEvent.press(screen.getByTestId('replay-next'));
    expect(myFace()).toBe('neutral');
    await wait(settle);
    expect(myFace()).toBe('smile');
    await wait(2_000);
    expect(myFace()).toBe('neutral');
  });

  it('leaving a step stops its reaction at once; back on it, the step plays again', async () => {
    const solo = await show();
    expect(solo.steps[1]!.kind).toBe('select');
    expect(solo.steps[2]!.kind).toBe('correct');
    await fireEvent.press(screen.getByTestId('replay-next'));
    await fireEvent.press(screen.getByTestId('replay-next'));
    await wait(settle);
    expect(myFace()).toBe('smile');
    // Back to the lock (nothing of mine to play) while the smile still shows: that step's face, at once.
    await fireEvent.press(screen.getByTestId('replay-prev'));
    await wait(0);
    expect(myFace()).toBe('neutral');
    await wait(settle);
    expect(myFace()).toBe('neutral');
    // On the correct move again: its reaction plays again, though it is the same one.
    await fireEvent.press(screen.getByTestId('replay-next'));
    await wait(settle);
    expect(myFace()).toBe('smile');
  });

  it('a drag along the timeline plays only where it stops (never the steps it passed)', async () => {
    const solo = await show();
    const timeline = screen.getByTestId('replay-timeline');
    await fireEvent(timeline, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 24 } } });
    const wrongAt = solo.steps.findIndex((s) => s.kind === 'wrong');
    const xOf = (k: number) => ((k + 0.1) / (solo.steps.length - 1)) * 300;
    // The timeline runs with the layout's direction (right to left when it is RTL).
    const at = (k: number) => ({ nativeEvent: { locationX: I18nManager.isRTL ? 300 - xOf(k) : xOf(k) } });
    // Through the correct moves, quicker than the settle, to the mistake.
    await fireEvent(timeline, 'responderGrant', at(1));
    for (let k = 2; k <= wrongAt; k++) {
      await fireEvent(timeline, 'responderMove', at(k));
      await wait(settle / 4);
      expect(myFace()).toBe('neutral');
    }
    await wait(settle);
    expect(screen.getByTestId('replay-counter')).toHaveTextContent(
      `שלב ${wrongAt + 1} מתוך ${solo.steps.length}`,
    );
    expect(myFace()).toBe('sad');
  });
});
