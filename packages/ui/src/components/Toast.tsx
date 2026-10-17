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

export const notify = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  info: (message: string) => toast(message),
};
