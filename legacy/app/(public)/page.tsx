"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";

export default function LandingPage() {
  const { user, firebaseUser, loading: authLoading, signInWithGoogle } = useAuth();
  const router = useRouter();

  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && firebaseUser && user) {
      if (user.role === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/dashboard");
      }
    }
  }, [authLoading, firebaseUser, user, router]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      const loggedInUser = await signInWithGoogle();
      if (loggedInUser.role === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/dashboard");
      }
    } catch (err: any) {
      setAuthError(
        err?.message ||
          "Could not sign in with Google. Make sure your account is registered on the student eligibility list."
      );
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-line bg-surface">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <span className="font-semibold text-base text-ink">
            MITAOE Prep
          </span>
          <span className="text-xs text-ink-muted">
            Training & Placement Office
          </span>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-12 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Column: Context */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-6">
              <h1 className="font-display font-black text-4xl sm:text-6xl lg:text-7xl tracking-tight text-ink leading-[1.02]">
                Five days.<br />
                Five company tests.<br />
                One leaderboard.
              </h1>
              <p className="font-sans text-base sm:text-lg text-ink-muted max-w-xl leading-relaxed">
                An isolated, strictly proctored placement assessment environment for MIT Academy of Engineering students. Server-enforced timers, browser lockdown, and automated OMR evaluation.
              </p>
            </div>

            {/* OMR Metaphor Box */}
            <Card className="max-w-lg space-y-3">
              <div className="flex items-center gap-3">
                <div className="omr-bubble filled">A</div>
                <div className="omr-bubble">B</div>
                <div className="omr-bubble">C</div>
                <div className="omr-bubble">D</div>
              </div>
              <p className="text-xs text-ink-muted leading-relaxed font-sans">
                Standard single-choice question format with automated response recording.
              </p>
            </Card>
          </div>

          {/* Right Column: Sign-In Container */}
          <div className="lg:col-span-5">
            <Card className="space-y-6">
              <div className="border-b border-line pb-4 space-y-1">
                <h2 className="font-display font-bold text-2xl text-ink">
                  Candidate sign in
                </h2>
                <p className="text-xs text-ink-muted">
                  Use your registered college Google account to continue.
                </p>
              </div>

              {authError && (
                <Notice variant="error">
                  {authError}
                </Notice>
              )}

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg border border-line bg-surface hover:bg-paper font-semibold text-sm text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
                >
                  {signingIn ? (
                    <>
                      <span className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />
                      <span>Checking account...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        />
                      </svg>
                      <span>Continue with Google</span>
                    </>
                  )}
                </button>

                <div className="bg-paper border border-line rounded-lg p-3 text-xs text-ink-muted space-y-1">
                  <p>
                    <strong className="text-ink font-semibold">Students:</strong> Sign in with your registered college email.
                  </p>
                  <p>
                    <strong className="text-ink font-semibold">Administrators:</strong> Sign in with your authorized admin email.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-line bg-surface py-4">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between text-xs text-ink-muted gap-2">
          <span>MIT Academy of Engineering, Pune</span>
          <span>Placement Examination Portal</span>
        </div>
      </footer>
    </div>
  );
}
