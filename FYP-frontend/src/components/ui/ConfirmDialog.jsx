import React, { useCallback, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import Modal from './Modal';
import Button from './Button';

const TONES = {
  danger: {
    icon: 'bg-danger-50 text-danger-600 dark:bg-danger-100/40 dark:text-danger-500',
    confirmVariant: 'danger',
    glyph: (
      <path
        d="M12 8v5m0 3.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  warning: {
    icon: 'bg-warning-50 text-warning-600 dark:bg-warning-100/40 dark:text-warning-500',
    confirmVariant: 'primary',
    glyph: (
      <path
        d="M12 8v5m0 3.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  info: {
    icon: 'bg-primary-50 text-primary-700 dark:bg-primary-100/40 dark:text-primary-700',
    confirmVariant: 'primary',
    glyph: (
      <path
        d="M12 16v-5m0-3.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  success: {
    icon: 'bg-success-50 text-success-700 dark:bg-success-100/40 dark:text-success-600',
    confirmVariant: 'success',
    glyph: (
      <path
        d="m8 12.5 2.5 2.5L16 9.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
};

/**
 * Yes/no confirmation built on `<Modal>`.
 *
 * Design decisions that matter for a clinical app:
 *  - Focus lands on **Cancel**, not Confirm, so a stray Enter on a
 *    "Delete this scan?" prompt cannot destroy patient data.
 *  - `onConfirm` may return a Promise; the confirm button shows its spinner
 *    until it settles and the dialog is not dismissed early. If it rejects the
 *    dialog stays open so the caller can surface the error.
 *  - The scrim and Esc stay enabled (cancelling is always safe) but can be
 *    disabled with `closeOnScrimClick={false}` for irreversible steps.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose Called on cancel / Esc / scrim.
 * @param {() => void | Promise<unknown>} props.onConfirm
 * @param {React.ReactNode} [props.title='Are you sure?']
 * @param {React.ReactNode} [props.description] Body copy explaining the consequence.
 * @param {string} [props.confirmLabel='Confirm']
 * @param {string} [props.cancelLabel='Cancel']
 * @param {'danger'|'warning'|'info'|'success'} [props.tone='danger']
 * @param {boolean} [props.closeOnConfirm=true] Auto-close once `onConfirm` resolves.
 * @param {boolean} [props.loading] Externally controlled busy state.
 * @param {React.ReactNode} [props.children] Extra content above the actions.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  closeOnConfirm = true,
  loading,
  className,
  children,
  ...rest
}) {
  const cancelRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const preset = TONES[tone] ?? TONES.danger;
  const isBusy = loading ?? busy;

  const handleConfirm = useCallback(async () => {
    try {
      setBusy(true);
      await onConfirm?.();
      if (closeOnConfirm) onClose?.();
    } finally {
      setBusy(false);
    }
  }, [onConfirm, closeOnConfirm, onClose]);

  return (
    <Modal
      open={open}
      onClose={isBusy ? () => {} : onClose}
      size="sm"
      showCloseButton={false}
      initialFocusRef={cancelRef}
      className={cn('text-center', className)}
      aria-label={typeof title === 'string' ? title : 'Confirmation'}
      {...rest}
    >
      <div className="flex flex-col items-center gap-4 pt-6 pb-2">
        <span
          aria-hidden="true"
          className={cn('flex h-12 w-12 items-center justify-center rounded-pill', preset.icon)}
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
            {preset.glyph}
          </svg>
        </span>

        <div className="space-y-1.5">
          <h2 className="font-heading text-heading-md text-default">{title}</h2>
          {description && <p className="text-body-sm text-muted">{description}</p>}
        </div>

        {children}

        <div className="mt-2 flex w-full flex-col-reverse gap-2.5 sm:flex-row sm:justify-center">
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={onClose}
            disabled={isBusy}
            className="sm:min-w-[7rem]"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={preset.confirmVariant}
            onClick={handleConfirm}
            loading={isBusy}
            className="sm:min-w-[7rem]"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
