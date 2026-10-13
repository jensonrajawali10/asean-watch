// Modal wrapper around the native <dialog>: Esc and the close button both close it, the rest of the
// page is inert while it is open, focus moves inside on open and returns to the opener on close.
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  /** Element focused when the dialog opens (defaults to the dialog itself). */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export default function Dialog({ open, onClose, labelledBy, className, initialFocus, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      (initialFocus?.current ?? dialog).focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocus]);

  const handleClose = () => {
    onClose();
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && el.isConnected) el.focus();
  };

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onClose={handleClose}
      onClick={(e) => {
        // A click on the backdrop targets the dialog element itself.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
