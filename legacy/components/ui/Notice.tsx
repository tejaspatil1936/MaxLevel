import React from "react";

export interface NoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: "neutral" | "default" | "error" | "alert";
  className?: string;
}

export function Notice({
  children,
  variant = "neutral",
  className = "",
  ...props
}: NoticeProps) {
  const isDanger = variant === "error" || variant === "alert";

  const styles = isDanger
    ? "bg-red/5 border-red/60 text-red shadow-[0_0_16px_rgba(220,38,38,0.22)]"
    : "bg-paper border-line text-ink-muted";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border rounded-lg p-3 text-xs leading-relaxed font-sans flex items-center gap-2.5 transition-all ${styles} ${className}`}
      {...props}
    >
      {isDanger && (
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red" />
        </span>
      )}
      <div className={`flex-1 ${isDanger ? "font-medium" : ""}`}>{children}</div>
    </div>
  );
}
