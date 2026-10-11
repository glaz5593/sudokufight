import 'react-native-reanimated';

import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '../../../i18n';
import { type LicensesData, licensesData, licenseTexts, packageRows } from '../../../legal/licenses';
import { LicensesScreen } from '../LicensesScreen';

/**
 * Work plan stage 14 (spec §23 "רישיונות"): Settings → "רישיונות" lists the fonts (OFL), every open-source
 * package with its license and copyright, and the license texts; all of it from the generated
 * src/legal/third-party-licenses.json (scripts/licenses.mjs).
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const DATA: LicensesData = {
  fonts: [
    { family: 'Rubik', copyright: ['Copyright 2015 The Rubik Project Authors'], license: 'OFL-1.1' },
    { family: 'Teko', copyright: ['Copyright 2023 The Teko Project Authors'], license: 'OFL-1.1' },
  ],
  ofl: 'SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007',
  texts: { MIT: 'Permission is hereby granted, free of charge…', ISC: 'Permission to use, copy, modify…' },
  packages: [
    ['react', '19.2.3', 'MIT', ['Copyright (c) Meta Platforms, Inc. and affiliates.']],
    ['zustand', '5.0.15', 'MIT', []],
    ['semver', '7.7.2', 'ISC', ['Copyright (c) Isaac Z. Schlueter and Contributors']],
  ],
};

beforeEach(async () => {
  await i18n.changeLanguage('he');
});

describe('the licenses screen', () => {
  it('lists the fonts and every package, names left to right', async () => {
    await render(<LicensesScreen data={DATA} />);
    expect(screen.getByRole('header', { name: 'רישיונות' })).toBeTruthy();
    expect(screen.getByTestId('font-Rubik')).toHaveTextContent(
      /Rubik.*SIL Open Font License 1\.1.*Copyright 2015/,
    );
    expect(screen.getByTestId('font-Teko')).toBeTruthy();
    expect(screen.getByText('3 רכיבי קוד פתוח')).toBeTruthy();
    const react = screen.getByTestId('package-react@19.2.3');
    expect(react).toHaveTextContent(/react.*19\.2\.3.*MIT.*Meta Platforms/);
    expect(react).toHaveProp(
      'accessibilityLabel',
      'react, גרסה 19.2.3, רישיון MIT'.replace(/(react|19\.2\.3|MIT)/g, '⁦$1⁩'),
    );
    expect(screen.getByText('zustand')).toHaveStyle({ writingDirection: 'ltr', textAlign: 'left' });
  });

  it('shows a license’s text only when asked', async () => {
    await render(<LicensesScreen data={DATA} />);
    expect(screen.queryByTestId('license-text-OFL-1.1-body')).toBeNull();
    const ofl = screen.getByTestId('license-text-OFL-1.1');
    expect(ofl).toHaveProp('accessibilityState', { expanded: false });
    await fireEvent.press(ofl);
    expect(screen.getByTestId('license-text-OFL-1.1-body')).toHaveTextContent(/SIL OPEN FONT LICENSE/);
    expect(screen.getByTestId('license-text-OFL-1.1')).toHaveProp('accessibilityState', { expanded: true });

    await fireEvent.press(screen.getByTestId('license-text-MIT'));
    expect(screen.getByTestId('license-text-MIT-body')).toHaveTextContent(/Permission is hereby granted/);
    await fireEvent.press(screen.getByTestId('license-text-MIT'));
    expect(screen.queryByTestId('license-text-MIT-body')).toBeNull();
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<LicensesScreen data={DATA} />);
    expect(screen.getByRole('header', { name: 'Licenses' })).toBeTruthy();
    expect(screen.getByText('3 open-source packages')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the ⁦MIT⁩ license' })).toBeTruthy();
  });
});

describe('the generated file', () => {
  it('has the app’s packages, the two fonts and the common license texts', () => {
    const data = licensesData();
    const rows = packageRows(data);
    expect(rows.length).toBeGreaterThan(100);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    for (const name of ['react', 'react-native', 'expo', 'i18next', 'zustand', '@react-native-firebase/app'])
      expect(rows.some((r) => r.name === name)).toBe(true);
    expect(data.fonts.map((f) => f.family)).toEqual(['Rubik', 'Teko']);
    expect(data.ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(licenseTexts(data)[0]?.id).toBe('MIT');
    expect(Object.keys(data.texts)).toEqual(expect.arrayContaining(['MIT', 'Apache-2.0', 'ISC']));
  });
});
