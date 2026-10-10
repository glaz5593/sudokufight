import { type CellIndex, parseCellName } from '@sudoku-fight/engine';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { color, space, text } from '../../theme';
import {
  Board,
  type BoardFlash,
  boardModel,
  CancelSelection,
  Cell,
  type CellFlashKind,
  type CellKind,
  type CellModel,
  Keypad,
} from '../board';
import { LockStrip, lockModel } from '../player';
import { Button } from '../ui';
import { noop } from './ButtonSection';
import { boardScene, DS_AVATARS, keypadScenes, type Snapshot, twoPlayerScenes } from './fixtures';
import { DsGroup, DsNote, Specimen, SpecimenRow, useContentWidth } from './Primitives';

/**
 * The board, as on Dir-C-Game: lock strip, board, keypad and "ביטול בחירה", drawn from the board area's
 * four-player demo game (every cell state of components.md §11.3 at once, from the engine). The clock can be
 * moved on to watch the timers, and the transient states play on demand: correct (#12), wrong (#13) and
 * "taken" (#11, also by tapping an opponent's lock); tapping an empty cell shows it pending (#9).
 */
export function BoardSection() {
  const { t } = useTranslation('dev');
  const width = useContentWidth();
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<CellIndex | null>(null);
  const [flashes, setFlashes] = useState<BoardFlash[]>([]);
  const [coordinates, setCoordinates] = useState(false);
  const [nudge, setNudge] = useState(0);
  const flashId = useRef(0);

  const scene = useMemo(() => boardScene(offset), [offset]);
  const model = useMemo(
    () => boardModel(scene.view, scene.mySeat, scene.now, { avatars: DS_AVATARS, pendingCell: pending }),
    [scene, pending],
  );
  const strip = lockModel(scene.view, scene.now);

  const flash = useCallback(
    (cell: CellIndex, kind: CellFlashKind) => {
      flashId.current += 1;
      // A wrong flash shows the digit that was tried: the cell's latest wrong digit.
      const wrong = model.cells[cell]?.wrong ?? [];
      const digit = kind === 'wrong' ? wrong[wrong.length - 1] : undefined;
      setFlashes([{ cell, kind, id: flashId.current, digit }]);
    },
    [model],
  );

  const onCellPress = useCallback(
    (cell: CellIndex) => {
      const c = model.cells[cell];
      if (!c) return;
      if (c.kind === 'oppLock' || c.cooldown) flash(cell, 'denied');
      else if (c.kind === 'empty') setPending(cell);
    },
    [model, flash],
  );

  const reset = () => {
    setOffset(0);
    setPending(null);
    setFlashes([]);
  };

  return (
    <>
      <DsNote>{t('board.note')}</DsNote>
      <View style={styles.game} testID="ds-game">
        <LockStrip model={strip} nudgeKey={nudge} testID="ds-strip" />
        <Board
          model={model}
          width={width}
          onCellPress={onCellPress}
          flashes={flashes}
          showCoordinates={coordinates}
          testID="ds-board"
        />
        <Keypad
          model={model.keypad}
          width={width}
          onDigit={noop}
          onIdlePress={() => setNudge((n) => n + 1)}
          testID="ds-keypad"
        />
        <CancelSelection cell={model.myLock?.name ?? null} onPress={noop} testID="ds-cancel" />
      </View>

      <View style={styles.controls}>
        <Text style={styles.clock} testID="ds-clock">
          {t('board.clock', { seconds: Math.round(scene.now / 1000) })}
        </Text>
        <Button
          label={t('board.advance')}
          variant="secondary"
          size="modal"
          onPress={() => setOffset((o) => o + 1000)}
          testID="ds-advance"
        />
        <Button label={t('board.reset')} variant="ghost" onPress={reset} testID="ds-reset" />
      </View>
      <View style={styles.controls}>
        <Button
          label={t('board.playCorrect')}
          variant="secondary"
          size="modal"
          onPress={() => flash(parseCellName('C1'), 'correct')}
        />
        <Button
          label={t('board.playWrong')}
          variant="secondary"
          size="modal"
          onPress={() => flash(parseCellName('E5'), 'wrong')}
        />
        <Button
          label={t('board.playTaken')}
          variant="secondary"
          size="modal"
          onPress={() => flash(parseCellName('A8'), 'denied')}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('board.coordinates')}</Text>
        <Switch
          value={coordinates}
          onValueChange={setCoordinates}
          accessibilityLabel={t('board.coordinates')}
          trackColor={{ false: color.border, true: color.accent }}
          thumbColor={color.text}
          testID="ds-coordinates"
        />
      </View>
      <DsNote>{t('board.legend')}</DsNote>
      <CellCloseUps />
    </>
  );
}

/**
 * Cell states the demo board never shows at one moment (components.md §11.3 #5, #9, #10, the urgent pill, #6),
 * each from a two-player engine game, so the page has them all without waiting for the clock.
 */
function CellCloseUps() {
  const { t } = useTranslation('dev');
  const cells = useMemo(() => {
    const s = twoPlayerScenes();
    const model = (snap: Snapshot, pendingCell: CellIndex | null = null) =>
      boardModel(snap.view, snap.mySeat, snap.now, { avatars: DS_AVATARS, pendingCell });
    const pick = (list: CellModel[], kind: CellKind) => list.find((c) => c.kind === kind) ?? null;
    const locking = model(s.locking).cells;
    const firstEmpty = pick(locking, 'empty')?.index ?? null;
    return [
      { key: 'myLock', cell: pick(locking, 'myLock') },
      { key: 'urgent', cell: pick(model(s.urgent).cells, 'myLock') },
      { key: 'paused', cell: pick(model(s.myLockPaused).cells, 'myLock') },
      { key: 'pending', cell: pick(model(s.locking, firstEmpty).cells, 'pending') },
      { key: 'oppLock', cell: pick(locking, 'oppLock') },
    ] as const;
  }, []);

  return (
    <DsGroup title={t('board.closeUps')}>
      <SpecimenRow gap={space[10]}>
        {cells.map(({ key, cell }) =>
          cell ? (
            <Specimen key={key} label={t(`board.cells.${key}`)}>
              <Cell cell={cell} testID={`closeup-${key}`} />
            </Specimen>
          ) : null,
        )}
      </SpecimenRow>
    </DsGroup>
  );
}

/** The keypad on its own (components.md §12): armed, idle, complete and tried keys, and "ביטול בחירה". */
export function KeypadSection() {
  const { t } = useTranslation('dev');
  const width = useContentWidth();
  const scenes = useMemo(() => keypadScenes(), []);
  const armed = useMemo(() => boardModel(scenes.armed.view, scenes.armed.mySeat, scenes.armed.now), [scenes]);
  const idle = useMemo(() => boardModel(scenes.idle.view, scenes.idle.mySeat, scenes.idle.now), [scenes]);
  const [nudge, setNudge] = useState(0);

  return (
    <>
      <DsGroup title={t('keypad.armed')}>
        <Specimen label={t('keypad.armedCaption', { digit: scenes.completeDigit })} align="stretch">
          <Keypad model={armed.keypad} width={width} onDigit={noop} testID="keypad-armed" />
        </Specimen>
        <Specimen label={t('keypad.cancelEnabled')}>
          <CancelSelection cell={armed.myLock?.name ?? null} onPress={noop} testID="cancel-enabled" />
        </Specimen>
      </DsGroup>
      <DsGroup title={t('keypad.idle')}>
        <LockStrip model={lockModel(scenes.idle.view, scenes.idle.now)} nudgeKey={nudge} />
        <Specimen label={t('keypad.idleCaption')} align="stretch">
          <Keypad
            model={idle.keypad}
            width={width}
            onDigit={noop}
            onIdlePress={() => setNudge((n) => n + 1)}
            testID="keypad-idle"
          />
        </Specimen>
        <Specimen label={t('keypad.cancelDisabled')}>
          <CancelSelection cell={idle.myLock?.name ?? null} onPress={noop} testID="cancel-disabled" />
        </Specimen>
      </DsGroup>
    </>
  );
}

const styles = StyleSheet.create({
  game: { gap: space[8], alignItems: 'stretch' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[4] },
  clock: { ...text('status'), color: color.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  switchLabel: { ...text('status'), color: color.text, flexShrink: 1 },
});
