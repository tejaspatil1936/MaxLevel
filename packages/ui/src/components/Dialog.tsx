import { AlertDialog as RAlert, Dialog as RDialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { cx } from '../cx';
import { Button } from './Button';

const overlay = 'fixed inset-0 bg-ink/40';

// A11Y-05: dialogs here are opened from state, not a Radix trigger, so they remember the control that opened them.
// Focus inside a menu does not count: a dialog opened from a menu item returns to the menu's trigger button.
let lastFocused: HTMLElement | null = null;
let tracking = false;
function trackFocus() {
  if (tracking || typeof document === 'undefined') return;
  tracking = true;
  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.('[role=menu]')) lastFocused = el;
    },
    true,
  );
}
trackFocus();

/** Marks the control that is opening a dialog, for openers that do not take focus themselves (menu triggers). */
export function rememberOpener(el: HTMLElement): void {
  lastFocused = el;
}

/** Handlers that send focus back to the opener when the dialog closes. */
function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = lastFocused;
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      const el = opener.current;
      if (el?.isConnected) el.focus();
    },
  };
}
// Never taller than the screen: long content scrolls inside the dialog (A11Y-15, WCAG 1.4.10).
const panelBase =
  'fixed left-1/2 top-1/2 max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel border border-rule bg-surface p-6 shadow-overlay';
const panel = cx(panelBase, 'w-[min(560px,calc(100vw-32px))]');
/** Wide dialogs hold an editor beside its preview; still never wider than the screen. */
const widePanel = cx(panelBase, 'w-[min(1120px,calc(100vw-32px))]');

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** `wide` for an editor with a side-by-side preview. */
  size?: 'default' | 'wide';
  /**
   * False leaves the page behind in the accessibility tree and clickable (a reference list such as the exam's
   * shortcuts, which the screen behind keeps reading); focus still moves in and returns, and Escape closes it.
   */
  modal?: boolean;
}

/** Modal dialog: traps focus while open and returns it to the opener (A11Y-05). */
export function Dialog({ open, onOpenChange, title, description, children, footer, size, modal = true }: DialogProps) {
  const focus = useReturnFocus();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RDialog.Portal>
        {modal ? <RDialog.Overlay className={overlay} /> : null}
        <RDialog.Content
          className={size === 'wide' ? widePanel : panel}
          {...focus}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <RDialog.Title className="text-heading-2 font-bold">{title}</RDialog.Title>
          {description ? <RDialog.Description className="mt-2 text-graphite">{description}</RDialog.Description> : null}
          <div className="mt-4">{children}</div>
          {footer ? <div className="mt-6 flex justify-end gap-3">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
}

/**
 * Confirmation for risky actions (UX-02): focus starts on Cancel, the action button sits on the right and uses
 * red pen when destructive.
 */
export function ConfirmDialog(p: ConfirmDialogProps) {
  const { onCloseAutoFocus, onOpenAutoFocus } = useReturnFocus();
  return (
    <RAlert.Root open={p.open} onOpenChange={p.onOpenChange}>
      <RAlert.Portal>
        <RAlert.Overlay className={overlay} />
        <RAlert.Content
          className={panel}
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus();
            // UX-02: focus starts on Cancel, never on the destructive action.
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-cancel]')?.focus();
          }}
        >
          <RAlert.Title className="text-heading-2 font-bold">{p.title}</RAlert.Title>
          <RAlert.Description className="mt-2 text-graphite">{p.description}</RAlert.Description>
          {p.children ? <div className="mt-4">{p.children}</div> : null}
          <div className="mt-6 flex justify-end gap-3">
            <RAlert.Cancel asChild>
              <Button variant="secondary" data-cancel>
                {p.cancelLabel}
              </Button>
            </RAlert.Cancel>
            <RAlert.Action asChild>
              <Button
                variant={p.destructive ? 'destructive' : 'primary'}
                disabled={p.confirmDisabled}
                onClick={(e) => {
                  e.preventDefault();
                  p.onConfirm();
                }}
              >
                {p.confirmLabel}
              </Button>
            </RAlert.Action>
          </div>
        </RAlert.Content>
      </RAlert.Portal>
    </RAlert.Root>
  );
}

export interface DrawerProps extends DialogProps {
  className?: string;
}

/**
 * Detail drawer on the right, 560 px wide, so the list stays in view and usable (UX-05): it is non-modal, so nothing
 * behind it is inert, and closing it returns focus to the control that opened it (A11Y-05).
 */
export function Drawer({ open, onOpenChange, title, description, children, footer, className }: DrawerProps) {
  const focus = useReturnFocus();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RDialog.Portal>
        <RDialog.Content
          {...focus}
          className={cx(
            'fixed inset-y-0 right-0 z-40 flex w-[min(560px,100vw)] flex-col border-l border-rule bg-surface shadow-overlay',
            className,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="border-b border-rule p-6">
            <RDialog.Title className="text-heading-2 font-bold">{title}</RDialog.Title>
            {description ? (
              <RDialog.Description className="mt-1 text-graphite">{description}</RDialog.Description>
            ) : null}
          </div>
          <div className="flex-1 overflow-y-auto p-6">{children}</div>
          {footer ? <div className="flex justify-end gap-3 border-t border-rule p-4">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
