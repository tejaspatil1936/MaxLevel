import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';
import { cx } from '../cx';

interface FieldFrameProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Words shown after the label for required fields (A11Y-11); pass the translated text. */
  requiredText?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Visible label, hint and an error linked to the control (A11Y-11, UX-09). */
export function FieldFrame({ label, hint, error, requiredText, children }: FieldFrameProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-bold text-ink">
        {label}
        {requiredText ? <span className="font-normal text-graphite"> {requiredText}</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-body-small text-graphite">
          {hint}
        </p>
      ) : null}
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <p id={errorId} className="text-body-small font-bold text-redpen">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control =
  'min-h-11 w-full rounded-control border border-graphite bg-surface px-3 text-ink aria-[invalid=true]:border-redpen';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  requiredText?: string;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, requiredText, className, ref, ...rest }: TextFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} requiredText={requiredText}>
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={!!requiredText}
          className={cx(control, className)}
          {...rest}
        />
      )}
    </FieldFrame>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  requiredText?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  ref?: Ref<HTMLSelectElement>;
}

export function SelectField({
  label,
  hint,
  error,
  requiredText,
  options,
  placeholder,
  className,
  ref,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} requiredText={requiredText}>
      {({ id, describedBy, invalid }) => (
        <select
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={!!requiredText}
          className={cx(control, className)}
          {...rest}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}
