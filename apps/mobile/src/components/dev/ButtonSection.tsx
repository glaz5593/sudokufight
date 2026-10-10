import { useTranslation } from 'react-i18next';

import { space } from '../../theme';
import { Button, type ButtonSize, IconButton, RowButton } from '../ui';
import { columnWidth, DsGroup, DsNote, Specimen, SpecimenRow, useContentWidth } from './Primitives';

/** Presses do nothing here: the page shows the pressed look while a finger is down. */
export const noop = (): void => undefined;

/**
 * Buttons (components.md §1, DS-Components "כפתורים"): primary in every size and state, secondary plain and
 * row, ghost, icon and danger. "Pressed" is live: hold any button to see it.
 */
export function ButtonSection() {
  const { t } = useTranslation('dev');
  const content = useContentWidth();
  const half = columnWidth(content, 2);
  const states = [
    { key: 'default', disabled: false, loading: false },
    { key: 'disabled', disabled: true, loading: false },
    { key: 'loading', disabled: false, loading: true },
  ] as const;

  return (
    <>
      <DsNote>{t('buttons.pressHint')}</DsNote>

      <DsGroup title={t('buttons.primary')}>
        {(['hero', 'lg'] as const satisfies readonly ButtonSize[]).map((size) =>
          states.map((s) => (
            <Specimen
              key={`${size}-${s.key}`}
              label={t('buttons.caption', { size, state: t(`states.${s.key}`) })}
              align="stretch"
            >
              <Button
                label={t('buttons.play')}
                size={size}
                disabled={s.disabled}
                loading={s.loading}
                onPress={noop}
                testID={`primary-${size}-${s.key}`}
              />
            </Specimen>
          )),
        )}
        {(['md', 'modal'] as const satisfies readonly ButtonSize[]).map((size) => (
          <SpecimenRow key={size} gap={space[4]}>
            {states.map((s) => (
              <Specimen
                key={s.key}
                label={t('buttons.caption', { size, state: t(`states.${s.key}`) })}
                width={size === 'md' ? half : columnWidth(content, 3)}
                align="stretch"
              >
                <Button
                  label={t('buttons.play')}
                  size={size}
                  disabled={s.disabled}
                  loading={s.loading}
                  onPress={noop}
                />
              </Specimen>
            ))}
          </SpecimenRow>
        ))}
      </DsGroup>

      <DsGroup title={t('buttons.secondary')}>
        <SpecimenRow gap={space[4]}>
          {(['lg', 'md', 'modal'] as const).map((size) => (
            <Specimen
              key={size}
              label={t('buttons.caption', { size, state: t('states.default') })}
              width={half}
              align="stretch"
            >
              <Button label={t('buttons.retry')} variant="secondary" size={size} onPress={noop} />
            </Specimen>
          ))}
          <Specimen label={t('states.selected')} width={half} align="stretch">
            <Button label={t('buttons.chip')} variant="secondary" selected onPress={noop} />
          </Specimen>
          <Specimen label={t('states.disabled')} width={half} align="stretch">
            <Button label={t('buttons.retry')} variant="secondary" disabled onPress={noop} />
          </Specimen>
          <Specimen label={t('states.loading')} width={half} align="stretch">
            <Button label={t('buttons.retry')} variant="secondary" loading onPress={noop} />
          </Specimen>
        </SpecimenRow>
      </DsGroup>

      <DsGroup title={t('buttons.row')}>
        {(
          [
            { key: 'default', disabled: false, loading: false, selected: false },
            { key: 'selected', disabled: false, loading: false, selected: true },
            { key: 'disabled', disabled: true, loading: false, selected: false },
            { key: 'loading', disabled: false, loading: true, selected: false },
          ] as const
        ).map((s) => (
          <Specimen key={s.key} label={t(`states.${s.key}`)} align="stretch">
            <RowButton
              icon="refresh"
              title={t('buttons.again')}
              subtitle={t('buttons.againSub')}
              disabled={s.disabled}
              loading={s.loading}
              selected={s.selected}
              onPress={noop}
            />
          </Specimen>
        ))}
      </DsGroup>

      <DsGroup title={t('buttons.ghost')}>
        <SpecimenRow>
          <Specimen label={t('states.default')}>
            <Button label={t('buttons.all')} variant="ghost" onPress={noop} />
          </Specimen>
          <Specimen label={t('buttons.withIcon')}>
            <Button label={t('buttons.cancelSelection')} variant="ghost" icon="cancel" onPress={noop} />
          </Specimen>
          <Specimen label={t('states.disabled')}>
            <Button
              label={t('buttons.cancelSelection')}
              variant="ghost"
              icon="cancel"
              disabled
              onPress={noop}
            />
          </Specimen>
          <Specimen label={t('states.loading')}>
            <Button label={t('buttons.all')} variant="ghost" loading onPress={noop} />
          </Specimen>
        </SpecimenRow>
      </DsGroup>

      <DsGroup title={t('buttons.icon')}>
        <SpecimenRow>
          <Specimen label={t('states.default')}>
            <IconButton icon="settings" accessibilityLabel={t('buttons.settings')} onPress={noop} />
          </Specimen>
          <Specimen label={t('buttons.header')}>
            <IconButton
              icon="settings"
              iconSize="header"
              accessibilityLabel={t('buttons.settings')}
              onPress={noop}
            />
          </Specimen>
          <Specimen label={t('states.expanded')}>
            <IconButton
              icon="reactions"
              accessibilityLabel={t('buttons.reactions')}
              expanded
              onPress={noop}
            />
          </Specimen>
          <Specimen label={t('states.disabled')}>
            <IconButton
              icon="surrender"
              accessibilityLabel={t('buttons.surrender')}
              disabled
              onPress={noop}
            />
          </Specimen>
          <Specimen label={t('states.loading')}>
            <IconButton icon="settings" accessibilityLabel={t('buttons.settings')} loading onPress={noop} />
          </Specimen>
        </SpecimenRow>
      </DsGroup>

      <DsGroup title={t('buttons.danger')}>
        {states.map((s) => (
          <Specimen key={s.key} label={t(`states.${s.key}`)} align="stretch">
            <Button
              label={t('buttons.surrenderYes')}
              variant="danger"
              size="lg"
              disabled={s.disabled}
              loading={s.loading}
              onPress={noop}
            />
          </Specimen>
        ))}
      </DsGroup>
    </>
  );
}
