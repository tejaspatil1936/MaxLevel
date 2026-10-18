import { AlertDialog as RAlert, Dialog as RDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Button } from './Button';

const overlay = 'fixed inset-0 bg-ink/40';
const panel =
  'fixed left-1/2 top-1/2 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-panel border border-rule bg-surface p-6 shadow-overlay';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}

/** Modal dialog: traps focus while open and returns it to the opener (A11Y-05). */
export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={overlay} />
        <RDialog.Content className={panel} {...(description ? {} : { 'aria-describedby': undefined })}>
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
  return (
    <RAlert.Root open={p.open} onOpenChange={p.onOpenChange}>
      <RAlert.Portal>
        <RAlert.Overlay className={overlay} />
        <RAlert.Content className={panel}>
          <RAlert.Title className="text-heading-2 font-bold">{p.title}</RAlert.Title>
          <RAlert.Description className="mt-2 text-graphite">{p.description}</RAlert.Description>
          {p.children ? <div className="mt-4">{p.children}</div> : null}
          <div className="mt-6 flex justify-end gap-3">
            <RAlert.Cancel asChild>
              <Button variant="secondary">{p.cancelLabel}</Button>
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

/** Detail drawer on the right, 560 px wide, so the list stays in view (UX-05). */
export function Drawer({ open, onOpenChange, title, description, children, footer, className }: DrawerProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 bg-ink/20" />
        <RDialog.Content
          className={cx(
            'fixed inset-y-0 right-0 flex w-[min(560px,100vw)] flex-col border-l border-rule bg-surface shadow-overlay',
            className,
          )}
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
