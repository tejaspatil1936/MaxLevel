import { Toaster as Sonner, toast } from 'sonner';

/** Toasts restyled to the design system. Never used during the exam (13.6, sync status). */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[min(380px,calc(100vw-32px))] items-start gap-2 rounded-panel border border-rule bg-surface p-4 text-ink shadow-overlay',
          title: 'font-bold',
          description: 'text-graphite',
          error: 'border-redpen',
          success: 'border-tick',
        },
      }}
    />
  );
}

/** Sonner's toasts carry no role, so a notice is a `status` whose whole text is the message (UX-10). */
const notice = (message: string) => <span role="status">{message}</span>;

export const notify = {
  success: (message: string) => toast.success(notice(message)),
  error: (message: string) => toast.error(message),
  info: (message: string) => toast(notice(message)),
};
