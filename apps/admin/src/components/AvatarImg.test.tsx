import { LEGACY_AVATAR_MAP } from '@sudoku-fight/protocol';
import { render, screen } from '@testing-library/react';

import { I18nProvider } from '../i18n';
import type { Lang } from '../strings';
import { AvatarImg } from './AvatarImg';

const show = (ui: React.ReactElement, lang: Lang = 'en') =>
  render(<I18nProvider initialLang={lang}>{ui}</I18nProvider>);

/** The avatar ids drawn in the page, in order. */
const drawn = (container: HTMLElement) =>
  [...container.querySelectorAll('svg[data-avatar]')].map((svg) => svg.getAttribute('data-avatar'));

describe('AvatarImg (spec §3.4)', () => {
  it('draws our own character, standing still, named in the site language', () => {
    const { container } = show(<AvatarImg id="coffee-cup" size={48} />);
    expect(screen.getByRole('img', { name: 'Coffee cup' })).toBeTruthy();
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('data-avatar')).toBe('coffee-cup');
    expect(svg.getAttribute('width')).toBe('48');
    // The site loads no motion CSS: no idle loop asked for either.
    expect(svg.getAttribute('class')).not.toMatch(/sfa-idle/);
  });

  it('names it in Hebrew on the Hebrew site', () => {
    show(<AvatarImg id="noam" />, 'he');
    expect(screen.getByRole('img', { name: 'נועם' })).toBeTruthy();
  });

  it("draws an old pack's id as its replacement", () => {
    const { container } = show(<AvatarImg id="av12" />);
    expect(drawn(container)).toEqual([LEGACY_AVATAR_MAP.av12]);
  });

  it.each([null, 'av00', 'av36', 'not-an-avatar', '<script>'])('draws %p as the blank tile', (id) => {
    const { container } = show(<AvatarImg id={id} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('img', { name: 'No avatar' }).className).toMatch(/avatar-none/);
  });

  it('beside a name: hidden from screen readers, the placeholder too', () => {
    const { container } = show(
      <>
        <AvatarImg id="owl" decorative />
        <AvatarImg id={null} decorative />
      </>,
    );
    expect(screen.queryAllByRole('img')).toEqual([]);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives each copy on a page its own clip path', () => {
    const { container } = show(
      <>
        <AvatarImg id="owl" />
        <AvatarImg id="owl" />
      </>,
    );
    const clips = [...container.querySelectorAll('clipPath')].map((c) => c.id);
    expect(clips).toHaveLength(2);
    expect(new Set(clips).size).toBe(2);
    for (const [k, svg] of [...container.querySelectorAll('svg')].entries()) {
      expect(svg.innerHTML).toContain(`url(#${clips[k]})`);
    }
  });
});
