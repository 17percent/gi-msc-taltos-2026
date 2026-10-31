import { CircleAlert } from 'lucide-react';
import type { ComponentProps, LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

const field =
  'w-full rounded-md border bg-surface px-3 text-sm text-text placeholder:text-subtle focus-visible:border-border-focus disabled:opacity-45 aria-invalid:border-danger';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-sm font-semibold text-text', className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        field,
        'h-10 border-border-strong',
        props['aria-invalid'] && 'border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(field, 'min-h-24 border-border-strong py-2 leading-normal', className)}
      {...props}
    />
  );
}

/** Mezőhiba: ikon + szöveg (nem csak szín), `aria-describedby`-val kötve a mezőhöz. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 flex items-start gap-2 text-sm text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-subtle">
      {children}
    </p>
  );
}

/** Natív rádió-csoport elem (DS Checkbox/Radio recept), címkével és opcionális súgóval. */
export function RadioOption({
  name,
  value,
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-checked:border-primary has-checked:bg-primary-soft lg:min-h-10">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
