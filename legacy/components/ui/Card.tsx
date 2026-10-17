import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      className={`bg-surface border border-line rounded-lg p-6 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
