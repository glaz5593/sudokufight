import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { type ApiError, toApiError } from '../api';
import { useI18n } from '../i18n';
import { actionErrorKey } from './ui';

/**
 * Refusals after which trying again can't help (the report is closed, the account gone, or this session is a
 * password one where actions want Google): only "close".
 */
const FINAL_ERRORS: ReadonlySet<ApiError['code']> = new Set([
  'notOpen',
  'accountDeleted',
  'notFound',
  'googleRequired',
  'stealthDisabled',
]);

/**
 * Asks before a moderation action (spec §3.5: every admin action is confirmed on the site). A modal <dialog>
 * (showModal: the page behind is inert, Escape cancels), labelled by its title and described by its text.
 * Focus starts on the safe choice, "cancel", and goes back to the button that opened it when it closes.
 *
 * `onConfirm` runs the action; while it runs both buttons are off and Escape does nothing. When it fails,
 * the error shows here (and `onFailed` lets the page reload what is stale); on success the page closes it.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  audited = true,
  onConfirm,
  onClose,
  onFailed,
}: {
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  /** The action is hard to undo (a suspension, a name reset): the confirm button says so in red. */
  danger?: boolean;
  /** The action goes into the audit log (the moderation actions, the stealth switch); not a QA run's close. */
  audited?: boolean;
  onConfirm: () => Promise<void>;
  /** Cancel, Escape, or "close" after a final error. */
  onClose: () => void;
  onFailed?: (error: ApiError) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const live = useRef(true);
  const running = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const final = error !== null && FINAL_ERRORS.has(error.code);

  useEffect(() => {
    live.current = true;
    const node = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Every browser the site supports has showModal; jsdom (the tests) has not, so it just opens there.
    if (node && typeof node.showModal === 'function') node.showModal();
    else node?.setAttribute('open', '');
    cancel.current?.focus();
    return () => {
      live.current = false;
      if (node?.open && typeof node.close === 'function') node.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // A refusal: the clicked button was off while the action ran, so focus goes back to a live one.
  useEffect(() => {
    if (error) cancel.current?.focus();
  }, [error]);

  const close = () => {
    if (!busy) onClose();
  };

  const confirm = async () => {
    // A double click lands before the re-render that turns the button off: one action only.
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: unknown) {
      const apiError = toApiError(err);
      if (live.current) {
        setError(apiError);
        setBusy(false);
      }
      onFailed?.(apiError);
    } finally {
      running.current = false;
    }
  };

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      aria-busy={busy}
      // Escape: the browser's own cancel is kept from closing the dialog behind React's back.
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        close();
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      <div id={bodyId} className="dialog-body">
        {children}
        {audited && <p className="muted">{t('confirm.audit')}</p>}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {t(actionErrorKey(error.code))}
        </p>
      )}
      <div className="dialog-actions">
        {!final && (
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? t('common.working') : confirmLabel}
          </button>
        )}
        <button ref={cancel} type="button" className="btn" disabled={busy} onClick={close}>
          {final ? t('common.close') : t('common.cancel')}
        </button>
      </div>
    </dialog>
  );
}
