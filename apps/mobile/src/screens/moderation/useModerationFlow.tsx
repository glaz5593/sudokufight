import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal, type ConfirmPlacement, useToast } from '../../components/ui';
import { blockPlayer, reportPlayer, unblockPlayer } from '../../moderation/moderation';
import { cue } from '../../services/feedback';
import { isolateName } from '../game/hit/hitModel';
import { ReportSheet } from './ReportSheet';
import { blockErrorText } from './wording';

/** Who the actions are about: their public id and display name. */
export interface ModerationTarget {
  id: string;
  name: string;
}

export interface ModerationFlowOptions {
  /** `bottom` in a game (the board stays in view), `center` elsewhere (components.md §14). */
  placement?: ConfirmPlacement;
  /** A block went through (the game screen also mutes their reactions at once). */
  onBlocked?: (playerId: string) => void;
  /** The clock of the report's quota message (tests pass theirs). */
  now?: () => number;
}

export interface ModerationFlow {
  /** "דווח על שחקן": the reasons sheet. `gameId`: the ranked game it is about. */
  openReport(target: ModerationTarget, gameId?: string | null): void;
  /** "חסום שחקן": the confirmation, then the block. */
  openBlock(target: ModerationTarget): void;
  /** "בטל חסימה": the confirmation, then the block lifted. */
  openUnblock(target: ModerationTarget): void;
  /** The sheet and the dialog: render it once, over the screen. */
  view: ReactNode;
}

interface ReportState {
  target: ModerationTarget;
  gameId: string | null;
  /** A new sheet (its reasons cleared) for every opening. */
  key: number;
  open: boolean;
}

interface ConfirmState {
  target: ModerationTarget;
  action: 'block' | 'unblock';
  open: boolean;
}

/**
 * "דווח על שחקן", "חסום שחקן" and "בטל חסימה" (spec §3.5), the same on the player card, in a ranked game's card
 * menu and in the blocked list: the reasons sheet (ReportSheet), and a confirmation that says what a block does
 * before it is made (or lifted). A toast says it is done, or why it isn't. The dialog keeps its words while it
 * closes (the target stays until the next opening).
 */
export function useModerationFlow({
  placement = 'center',
  onBlocked,
  now,
}: ModerationFlowOptions = {}): ModerationFlow {
  const { t } = useTranslation('moderation');
  const [report, setReport] = useState<ReportState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useRef(0);
  const blocked = useRef(onBlocked);
  useEffect(() => {
    blocked.current = onBlocked;
  });

  const openReport = useCallback((target: ModerationTarget, gameId: string | null = null) => {
    opened.current += 1;
    setReport({ target, gameId, key: opened.current, open: true });
  }, []);
  const openBlock = useCallback(
    (target: ModerationTarget) => setConfirm({ target, action: 'block', open: true }),
    [],
  );
  const openUnblock = useCallback(
    (target: ModerationTarget) => setConfirm({ target, action: 'unblock', open: true }),
    [],
  );

  const closeConfirm = () => {
    if (!busy) setConfirm((c) => c && { ...c, open: false });
  };

  const run = async () => {
    if (!confirm || busy) return;
    const { target, action } = confirm;
    const name = isolateName(target.name);
    setBusy(true);
    try {
      if (action === 'block') {
        await blockPlayer(target.id);
        blocked.current?.(target.id);
      } else {
        await unblockPlayer(target.id);
      }
      cue('primaryPress');
      useToast.getState().show({
        variant: 'success',
        message: action === 'block' ? t('block.done', { name }) : t('block.unblocked', { name }),
      });
    } catch (error) {
      cue('nudge');
      useToast.getState().show({ variant: 'error', message: blockErrorText(t, error, action === 'unblock') });
    } finally {
      setBusy(false);
      setConfirm((c) => c && { ...c, open: false });
    }
  };

  const target = confirm?.target;
  const name = target ? isolateName(target.name) : '';
  const unblock = confirm?.action === 'unblock';

  const view = (
    <>
      {report ? (
        <ReportSheet
          key={report.key}
          visible={report.open}
          name={report.target.name}
          onSend={(reason) => reportPlayer({ playerId: report.target.id, reason, gameId: report.gameId })}
          onClose={() => setReport((r) => r && { ...r, open: false })}
          now={now}
        />
      ) : null}
      <ConfirmModal
        visible={confirm?.open ?? false}
        placement={placement}
        icon="block"
        title={unblock ? t('block.unblockTitle', { name }) : t('block.title', { name })}
        body={unblock ? t('block.unblockBody', { name }) : t('block.body', { name })}
        confirmLabel={unblock ? t('block.unblockConfirm') : t('block.confirm')}
        confirmLoading={busy}
        onConfirm={() => void run()}
        onCancel={closeConfirm}
        testID={unblock ? 'unblock-confirm' : 'block-confirm'}
      />
    </>
  );

  return { openReport, openBlock, openUnblock, view };
}
