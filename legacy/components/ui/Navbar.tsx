"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";

export function Navbar() {
  const { user, firebaseUser, signOut } = useAuth();

  return (
    <header className="border-b border-line bg-surface sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href={user?.role === "admin" ? "/admin" : "/dashboard"} className="flex items-center gap-2">
          <span className="font-semibold text-base text-ink">
            MITAOE Prep
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {firebaseUser && user ? (
            <>
              <nav className="flex items-center gap-1 sm:gap-2">
                {user.role === "admin" && (
                  <Link
                    href="/admin"
                    className="text-xs text-ink-muted hover:text-ink transition-colors px-2.5 py-1 rounded-md"
                  >
                    Admin
                  </Link>
                )}
                <Link
                  href="/dashboard"
                  className="text-xs text-ink-muted hover:text-ink transition-colors px-2.5 py-1 rounded-md"
                >
                  Tests
                </Link>
                <Link
                  href="/leaderboard"
                  className="text-xs text-ink-muted hover:text-ink transition-colors px-2.5 py-1 rounded-md"
                >
                  Leaderboard
                </Link>
              </nav>

              <div className="hidden sm:flex items-center gap-2 text-xs text-ink-muted pl-2 border-l border-line">
                <span className="text-ink font-medium">{user.name}</span>
                <span>({user.prn})</span>
                {user.role === "admin" && (
                  <span className="text-pen font-medium">Admin</span>
                )}
              </div>

              <button
                onClick={() => signOut()}
                className="text-xs text-ink-muted hover:text-ink transition-colors px-2 py-1 cursor-pointer"
              >
                Sign out
              </button>
            </>
          ) : (
            <span className="text-xs text-ink-muted">
              Training & Placement
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
