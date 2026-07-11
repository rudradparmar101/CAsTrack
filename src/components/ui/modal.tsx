'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg';
}

const maxWidthClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'md',
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  // Portaled straight to <body>: every page root in this app uses
  // .animate-fade-in/.animate-scale-in (transform-based, `forwards` fill
  // mode — see globals.css), which leaves a permanent (identity) transform
  // on the element after the animation finishes. Any CSS transform on an
  // ancestor creates a new containing block for `position: fixed`
  // descendants, so a Modal rendered inline (a normal child in the React
  // tree) would size/position itself against that animated ancestor's box
  // instead of the real viewport — exactly the reported bug (header/title
  // rendered off the top of the screen with nothing to scroll it into
  // view). A portal escapes that ancestor chain entirely.
  return createPortal(
    // overflow-y-auto (not flex+items-center on this element) so tall
    // content can be scrolled to instead of clipped at the viewport edge —
    // centering happens one level in, on a `min-h-full` wrapper, which
    // avoids the classic flexbox-centering-clips-overflow quirk.
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 overflow-y-auto p-4 sm:py-8"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />

      {/* Centering wrapper */}
      <div className="relative flex min-h-full items-center justify-center">
        {/* Content — capped to the viewport height; header/body split so the
            body is the only part that scrolls internally. */}
        <div
          className={`
            relative w-full ${maxWidthClasses[maxWidth]} max-h-[90vh] flex flex-col
            bg-[var(--color-surface)] rounded-xl shadow-xl
            border border-[var(--color-border)]
            animate-scale-in
          `}
        >
          {/* Header — pinned */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-muted)] transition-colors focus-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body — the only scrollable region; children's own footer row
              (Cancel/Submit) uses `sticky bottom-0` to stay pinned in view
              while the fields above it scroll. */}
          <div className="px-6 py-5 flex-1 overflow-y-auto min-h-0">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}
