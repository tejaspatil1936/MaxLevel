"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, firebaseUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!firebaseUser) {
        router.replace("/");
      } else if (user && user.role !== "admin") {
        router.replace("/dashboard");
      }
    }
  }, [loading, firebaseUser, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm text-ink-muted">
          <span className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />
          <span>Verifying access...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser || (user && user.role !== "admin")) {
    return null;
  }

  return <>{children}</>;
}
