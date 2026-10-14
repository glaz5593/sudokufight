import 'react-native-reanimated';
import { avatarById, renderStatic } from '@sudoku-fight/avatars';
import { act, render, screen } from '@testing-library/react-native';

import { drawnAvatarId, svgXmlsIn } from '../../../avatars/testing/avatarTesting';
import { AVATAR_SIZES } from '../../../components/player/metrics';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { FighterPreview, STAGE_SETTLE_MS } from '../FighterPreview';

/**
 * "ככה יראו אותך בזירה" (spec §3.2): my card alone. Its avatar is the registration's stage
 * (AVATAR_STAGES.picker): it idles once a choice has stayed a moment, and never with reduced motion.
 */

const hidden = { includeHiddenElements: true };
const SIZE = AVATAR_SIZES.row.image;
const xmls = () =>
  svgXmlsIn(screen.getByTestId('fighter-preview-me-avatar-image', hidden)).map((x) => x.props.xml as string);

async function frames(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('FighterPreview', () => {
  it('my avatar idles once the choice has stayed a moment; a new choice waits again', async () => {
    const view = await render(<FighterPreview avatarId="noam" name="MosheG" country="IL" />);
    await frames(STAGE_SETTLE_MS);
    // Idling: every part that may move in a layer of its own.
    expect(xmls().length).toBeGreaterThan(1);
    expect(xmls().every((x) => drawnAvatarId(x) === null)).toBe(true);
    await view.rerender(<FighterPreview avatarId="maya" name="MosheG" country="IL" />);
    expect(xmls()).toEqual([renderStatic(avatarById('maya')!, { size: SIZE })]);
    await frames(STAGE_SETTLE_MS);
    expect(xmls().length).toBeGreaterThan(1);
  });

  it('with reduced motion it stays still', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<FighterPreview avatarId="noam" name="MosheG" country="IL" />);
    await frames(STAGE_SETTLE_MS * 4);
    expect(xmls()).toEqual([renderStatic(avatarById('noam')!, { size: SIZE })]);
  });

  it('one label for screen readers, the default name while none is typed', async () => {
    await render(<FighterPreview avatarId="noam" name="  " country={null} />);
    expect(screen.getByRole('image', { name: 'תצוגה מקדימה של הכרטיס שלך במשחק: שחקן' })).toBeOnTheScreen();
    // No country: "חדש" alone, without a separator before it.
    expect(screen.getByTestId('fighter-preview-me', hidden)).toHaveTextContent(/שחקןחדש$/);
  });
});
