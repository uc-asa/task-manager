import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation built on the native <dialog>: the browser provides the focus trap, an inert
 * background, Esc to close and focus restoration. Mount it to open it, unmount it to close it.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    // Destructive actions start on the safe choice, so a stray Enter never deletes anything.
    cancelRef.current?.focus();
    return () => {
      dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        // Esc: let React state decide, rather than the browser closing it behind our back.
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself, not on its content.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="dialog-body">
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{message}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
