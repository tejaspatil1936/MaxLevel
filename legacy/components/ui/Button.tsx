import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "text";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center font-sans rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen";

  const sizeStyles = {
    sm: "px-3 py-1.5 text-xs font-semibold",
    md: "px-4 py-2 text-sm font-semibold",
    lg: "px-6 py-2.5 text-base font-semibold",
  }[size];

  const variantStyles = {
    primary: "bg-pen text-white hover:bg-slate-800 active:bg-slate-900",
    secondary: "bg-surface text-ink border border-line hover:bg-paper active:bg-gray-100",
    danger: "bg-red text-white hover:bg-red-700 active:bg-red-800",
    ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-paper",
    text: "bg-transparent text-ink-muted hover:text-ink hover:bg-paper",
  }[variant];

  return (
    <button
      disabled={disabled || loading}
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Processing...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
