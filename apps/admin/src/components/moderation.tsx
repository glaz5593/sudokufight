import type { AdminReport } from '@sudoku-fight/protocol';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { AdminApi, ApiError } from '../api';
import { useApi } from '../data';
import { type I18n, Rich, useI18n } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * The moderation actions (spec §3.5, §27.3: the admin site's only writes): close a report as resolved or
 * dismissed, reset a display name, suspend an account or lift its suspension. Each one is asked for in a
 * ConfirmDialog; when it is done the page says what happened (a polite status message) and reloads.
 */

export type ModerationAction =
  | {
      kind: 'resolve' | 'dismiss';
      report: AdminReport;
      /** The reported player's name; null for a deleted account. */
      player: string | null;
    }
  | {
      kind: 'resetName' | 'suspend' | 'unsuspend';
      userId: string;
      name: string | null;
      /** A stealth bot's persona: a name reset gives it a new invented name at once. */
      persona?: boolean;
    };

/** Refusals that mean the page shows something that has changed meanwhile: it reloads. */
const STALE_ERRORS: ReadonlySet<ApiError['code']> = new Set(['notOpen', 'accountDeleted', 'notFound']);

/** A name inside a sentence: isolated, so a Hebrew name in English (or the reverse) keeps its order. */
function nameNode(i18n: I18n, name: string | null): ReactNode {
  return <bdi>{name ?? i18n.t('mod.deletedAccount')}</bdi>;
}

/** Runs an action and words its outcome. */
async function perform(api: AdminApi, i18n: I18n, action: ModerationAction): Promise<ReactNode> {
  switch (action.kind) {
    case 'resolve':
    case 'dismiss': {
      if (action.kind === 'resolve') await api.resolveReport(action.report.id);
      else await api.dismissReport(action.report.id);
      return (
        <Rich
          k={action.kind === 'resolve' ? 'done.resolve' : 'done.dismiss'}
          nodes={{ player: nameNode(i18n, action.player) }}
        />
      );
    }
    case 'resetName': {
      const { user } = await api.resetName(action.userId);
      return (
        <Rich
          k="done.resetName"
          nodes={{ from: nameNode(i18n, action.name), to: <bdi>{user.displayName}</bdi> }}
        />
      );
    }
    case 'suspend':
    case 'unsuspend': {
      const suspend = action.kind === 'suspend';
      const { audit } = suspend ? await api.suspend(action.userId) : await api.unsuspend(action.userId);
      // No audit entry: nothing changed (it was suspended already, or not suspended).
      const k = suspend
        ? audit
          ? 'done.suspend'
          : 'done.suspendNoChange'
        : audit
          ? 'done.unsuspend'
          : 'done.unsuspendNoChange';
      return <Rich k={k} nodes={{ name: nameNode(i18n, action.name) }} />;
    }
  }
}

/** What the dialog asks for each action. */
function question(
  i18n: I18n,
  action: ModerationAction,
): { title: ReactNode; body: ReactNode; confirm: string; danger: boolean } {
  const { t, label } = i18n;
  switch (action.kind) {
    case 'resolve':
    case 'dismiss': {
      const nodes = {
        reporter: nameNode(i18n, action.report.reporter.displayName),
        player: nameNode(i18n, action.player),
        reason: label('reason', action.report.reason),
      };
      const resolve = action.kind === 'resolve';
      return {
        title: t(resolve ? 'confirm.resolve.title' : 'confirm.dismiss.title'),
        body: (
          <p>
            <Rich k={resolve ? 'confirm.resolve.body' : 'confirm.dismiss.body'} nodes={nodes} />
          </p>
        ),
        confirm: t(resolve ? 'confirm.resolve.confirm' : 'confirm.dismiss.confirm'),
        danger: false,
      };
    }
    case 'resetName':
      return {
        title: <Rich k="confirm.resetName.title" nodes={{ name: nameNode(i18n, action.name) }} />,
        body: <p>{t(action.persona ? 'confirm.resetName.bodyPersona' : 'confirm.resetName.body')}</p>,
        confirm: t('confirm.resetName.confirm'),
        danger: true,
      };
    case 'suspend':
      return {
        title: <Rich k="confirm.suspend.title" nodes={{ name: nameNode(i18n, action.name) }} />,
        body: <p>{t('confirm.suspend.body')}</p>,
        confirm: t('confirm.suspend.confirm'),
        danger: true,
      };
    case 'unsuspend':
      return {
        title: <Rich k="confirm.unsuspend.title" nodes={{ name: nameNode(i18n, action.name) }} />,
        body: <p>{t('confirm.unsuspend.body')}</p>,
        confirm: t('confirm.unsuspend.confirm'),
        danger: false,
      };
  }
}

export interface Moderation {
  /** Opens the confirmation for an action. */
  ask: (action: ModerationAction) => void;
  /** The open dialog, if any: render it once on the page. */
  dialog: ReactNode;
  /** The outcome of the last action: render it under the page's heading. */
  notice: ReactNode;
}

/**
 * The actions of one page. `reload` refreshes the page's data after an action (and after a refusal that
 * shows the data is stale); `loading` is that data's state. When the button that started an action is gone
 * after the reload (a closed report leaves the "open" list), focus moves to the outcome message.
 */
export function useModeration({ reload, loading }: { reload: () => void; loading: boolean }): Moderation {
  const api = useApi();
  const i18n = useI18n();
  const [pending, setPending] = useState<ModerationAction | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const checkFocus = useRef(false);

  useEffect(() => {
    if (loading || !checkFocus.current) return;
    checkFocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) noticeRef.current?.focus();
  }, [loading]);

  const q = pending && question(i18n, pending);
  const dialog = pending && q && (
    <ConfirmDialog
      title={q.title}
      confirmLabel={q.confirm}
      danger={q.danger}
      onClose={() => setPending(null)}
      onConfirm={async () => {
        const outcome = await perform(api, i18n, pending);
        setNotice(outcome);
        setPending(null);
        checkFocus.current = true;
        reload();
      }}
      onFailed={(error) => {
        if (STALE_ERRORS.has(error.code)) reload();
      }}
    >
      {q.body}
    </ConfirmDialog>
  );

  // The live region is always there (empty without a message), so screen readers hear each new message.
  const noticeNode = (
    <div className={notice === null ? 'notice-slot' : 'notice-slot notice'}>
      <p ref={noticeRef} className="notice-text" role="status" tabIndex={-1}>
        {notice}
      </p>
      {notice !== null && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setNotice(null);
            // The button goes with the message: the focus goes to the page's heading, not to nowhere.
            document.querySelector<HTMLElement>('main h1')?.focus();
          }}
        >
          {i18n.t('notice.hide')}
        </button>
      )}
    </div>
  );

  return { ask: setPending, dialog, notice: noticeNode };
}

/**
 * A button for an action on something the row or card names; screen readers hear which, after the label.
 * Off while the page reloads (its data may be stale) with aria-disabled, not `disabled`: it keeps the focus
 * it got back from the dialog.
 */
export function ActionButton({
  label,
  target,
  danger = false,
  disabled,
  onClick,
}: {
  label: string;
  target: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={danger ? 'btn btn-sm btn-danger-outline' : 'btn btn-sm'}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {label} <span className="visually-hidden">({target})</span>
    </button>
  );
}

/** Reset the name; suspend, or lift the suspension. A deleted account has none. */
export function AccountActions({
  user,
  disabled,
  onAsk,
}: {
  user: { id: string; name: string | null; suspended: boolean; deleted: boolean; persona?: boolean };
  disabled: boolean;
  onAsk: (action: ModerationAction) => void;
}) {
  const { t } = useI18n();
  if (user.deleted) return null;
  const target = user.name ?? t('mod.deletedAccount');
  return (
    <div className="actions">
      <ActionButton
        label={t('action.resetName')}
        target={target}
        danger
        disabled={disabled}
        onClick={() =>
          onAsk({ kind: 'resetName', userId: user.id, name: user.name, persona: user.persona ?? false })
        }
      />
      {/* One button that changes its words, so it keeps the focus across the change. */}
      <ActionButton
        label={user.suspended ? t('action.unsuspend') : t('action.suspend')}
        target={target}
        danger={!user.suspended}
        disabled={disabled}
        onClick={() =>
          onAsk({ kind: user.suspended ? 'unsuspend' : 'suspend', userId: user.id, name: user.name })
        }
      />
    </div>
  );
}

/** "Mark resolved" and "Dismiss" for an open report. */
export function ReportActions({
  report,
  player,
  disabled,
  onAsk,
}: {
  report: AdminReport;
  player: string | null;
  disabled: boolean;
  onAsk: (action: ModerationAction) => void;
}) {
  const { t, label } = useI18n();
  if (report.status !== 'open') return null;
  const target = t('action.reportTarget', {
    reason: label('reason', report.reason),
    reporter: report.reporter.displayName ?? t('mod.deletedAccount'),
  });
  return (
    <div className="actions">
      <ActionButton
        label={t('action.resolve')}
        target={target}
        disabled={disabled}
        onClick={() => onAsk({ kind: 'resolve', report, player })}
      />
      <ActionButton
        label={t('action.dismiss')}
        target={target}
        disabled={disabled}
        onClick={() => onAsk({ kind: 'dismiss', report, player })}
      />
    </div>
  );
}

/**
 * A player's moderation state, as badges beside their name; and whether the account is a stealth bot's
 * persona (stealth-bot.md §8: the admin site is the only place that says so).
 */
export function ModerationBadges({
  deleted,
  suspended,
  nameReset,
  persona = false,
}: {
  deleted: boolean;
  suspended: boolean;
  nameReset: boolean;
  persona?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      {persona && <StealthBadge label={t('mod.persona')} />}
      {deleted && <span className="badge badge-danger">{t('users.deleted')}</span>}
      {suspended && <span className="badge badge-danger">{t('mod.suspended')}</span>}
      {nameReset && <span className="badge badge-warn">{t('mod.nameReset')}</span>}
    </>
  );
}

/** The stealth bot's mark: on a persona, a game against it, its seat. */
export function StealthBadge({ label }: { label: string }) {
  return <span className="badge badge-stealth">{label}</span>;
}

/** Who acted: an admin's address, the password sign-in, or the system (an account deletion). */
export function Actor({ who }: { who: string }) {
  const { t } = useI18n();
  if (who === 'password') return <>{t('by.password')}</>;
  if (who === 'system') return <>{t('by.system')}</>;
  return <bdi>{who}</bdi>;
}
