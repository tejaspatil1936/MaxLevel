import React from "react";
import { TestState, SeriesStatus } from "@/types";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "neutral" | "open" | "upcoming" | "closed" | "submitted" | "active" | "draft" | "archived" | "pen";
  className?: string;
  dot?: boolean;
}

export function Badge({ children, variant = "default", className = "", dot }: BadgeProps) {
  const dotColor = {
    open: "bg-green",
    active: "bg-green",
    submitted: "bg-ink-muted",
    closed: "bg-ink-muted",
    upcoming: "bg-ink-muted",
    draft: "bg-ink-muted",
    archived: "bg-ink-muted",
    default: "bg-ink-muted",
    neutral: "bg-ink-muted",
    pen: "bg-pen",
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-ink-muted font-normal select-none ${className}`}
    >
      {(dot || variant === "open" || variant === "active") && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
      )}
      <span>{children}</span>
    </span>
  );
}

export function TestStateBadge({ state }: { state: TestState }) {
  const map: Record<TestState, { label: string; variant: BadgeProps["variant"] }> = {
    open: { label: "Window open", variant: "open" },
    upcoming: { label: "Upcoming", variant: "upcoming" },
    closed: { label: "Closed", variant: "closed" },
    submitted: { label: "Submitted", variant: "submitted" },
  };

  const config = map[state] || { label: state, variant: "default" };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function SeriesStatusBadge({ status }: { status: SeriesStatus }) {
  const map: Record<SeriesStatus, { label: string; variant: BadgeProps["variant"] }> = {
    active: { label: "Active", variant: "active" },
    draft: { label: "Draft", variant: "draft" },
    archived: { label: "Archived", variant: "archived" },
  };

  const config = map[status] || { label: status, variant: "default" };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
