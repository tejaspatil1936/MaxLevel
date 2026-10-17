import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: InputProps) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-ink mb-1.5 font-sans"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`w-full px-3.5 py-2.5 rounded-lg border bg-surface text-ink placeholder:text-ink-muted text-sm font-sans transition-colors focus:outline-none focus:border-pen ${
          error ? "border-red" : "border-line"
        } ${className}`}
        {...props}
      />
      {hint && !error && (
        <p className="mt-1 text-xs text-ink-muted font-sans">{hint}</p>
      )}
      {error && <p className="mt-1 text-xs text-red font-sans">{error}</p>}
    </div>
  );
}
