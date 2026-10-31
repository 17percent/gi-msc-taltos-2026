import { cva } from 'class-variance-authority';

/** DS „Gomb” recept: magasság `--space-10`, `--radius-md`, letiltva `opacity .45`. */
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold no-underline transition-colors duration-(--duration-fast) ease-standard disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active',
        outline: 'border border-border-strong bg-transparent text-text hover:bg-surface-sunken',
        ghost: 'bg-transparent text-text hover:bg-surface-sunken',
        danger: 'bg-danger text-surface hover:opacity-90',
        'danger-ghost': 'bg-transparent text-danger hover:bg-danger-bg',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3',
        // Érintési cél: mobilon `--space-12`.
        icon: 'size-12 lg:size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);
