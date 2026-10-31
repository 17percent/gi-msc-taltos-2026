import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Siker/tájékoztató toast (DS 6.1): `--surface-inverse` háttér, ikon + szöveg, látható „Bezár” gomb,
 * hover/fókusz alatt nem záródik. A toast csak megerősítés, hibát soha nem csak ez jelez.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      closeButton
      theme="system"
      icons={{
        success: <CircleCheck aria-hidden="true" className="size-5" />,
        error: <CircleAlert aria-hidden="true" className="size-5" />,
        info: <Info aria-hidden="true" className="size-5" />,
        close: <X aria-hidden="true" className="size-4" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: 'Bezár',
        classNames: {
          toast:
            'group pointer-events-auto flex w-full items-center gap-3 rounded-md bg-surface-inverse px-4 py-3 text-sm text-inverse shadow-(--shadow-lg)',
          title: 'font-medium',
          icon: 'shrink-0',
          closeButton:
            'order-last ml-auto flex size-8 shrink-0 items-center justify-center rounded-sm text-inverse hover:bg-surface-sunken/20',
        },
      }}
      style={{ zIndex: 'var(--z-toast)' }}
      {...props}
    />
  );
}
