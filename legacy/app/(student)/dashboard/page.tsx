"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { StudentGuard } from "@/components/auth/StudentGuard";
import { Navbar } from "@/components/ui/Navbar";
import { Badge, TestStateBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/components/auth/AuthProvider";
import { formatDate, formatWindow } from "@/lib/time";
import { Series, StudentTestView } from "@/types";

export default function StudentDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<Series | null>(null);
  const [tests, setTests] = useState<StudentTestView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveSeries = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{
        series: Series | null;
        tests: StudentTestView[];
      }>("/api/series/active");
      setSeries(data.series);
      setTests(data.tests);
    } catch (err: any) {
      setError(err?.message || "Could not load test schedule.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      fetchActiveSeries();
    }
  }, [authLoading, user]);

  return (
    <StudentGuard>
      <div className="min-h-screen bg-paper flex flex-col">
        <Navbar />

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
          {loading ? (
            <div className="py-24 flex items-center justify-center gap-2.5 text-sm text-ink-muted">
              <span className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />
              <span>Loading assessment schedule...</span>
            </div>
          ) : error ? (
            <Card className="max-w-md mx-auto text-center space-y-3">
              <h2 className="font-semibold text-lg text-ink">
                Could not load test series
              </h2>
              <p className="text-xs text-ink-muted">{error}</p>
              <Button variant="secondary" onClick={fetchActiveSeries}>
                Try again
              </Button>
            </Card>
          ) : !series ? (
            <Card className="text-center max-w-md mx-auto my-12 space-y-2">
              <h2 className="font-semibold text-lg text-ink">
                No active test series
              </h2>
              <p className="text-xs text-ink-muted leading-relaxed">
                There are no active tests scheduled right now. Check back when your assessment window opens.
              </p>
            </Card>
          ) : (
            <div className="space-y-8">
              {/* Series Header */}
              <div className="border-b border-line pb-6 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="active">Active series</Badge>
                  <span className="text-xs text-ink-muted">
                    Daily window: {series.window.start} – {series.window.end} {series.window.tz}
                  </span>
                </div>

                <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-ink">
                  {series.title}
                </h1>

                <div className="flex flex-wrap gap-x-4 text-xs text-ink-muted">
                  <span>Duration: {series.durationMin} minutes</span>
                  <span>•</span>
                  <span>Warning threshold: {series.maxStrikes} strikes</span>
                  <span>•</span>
                  <span>One attempt per test</span>
                </div>
              </div>

              {/* Assessment Schedule */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-bold text-lg text-ink">
                    Assessment schedule
                  </h2>
                  <span className="text-xs text-ink-muted">
                    Take each test within its scheduled window
                  </span>
                </div>

                <div className="space-y-3">
                  {tests.map((test) => {
                    const isSubmitted =
                      test.state === "submitted" ||
                      test.userAttempt?.status === "submitted" ||
                      test.userAttempt?.status === "auto_submitted" ||
                      test.userAttempt?.status === "terminated_by_proctor";

                    const isInProgress = test.userAttempt?.status === "in_progress";
                    const isStartable = test.state === "open" && !isSubmitted;

                    return (
                      <Card
                        key={test.id}
                        className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        {/* Left: Day Numeral + Details */}
                        <div className="flex items-start sm:items-center gap-4">
                          <div className="font-display font-bold text-2xl text-ink-muted w-10 text-center select-none tabular-nums">
                            {test.day < 10 ? `0${test.day}` : test.day}
                          </div>

                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-base text-ink">
                                {test.title}
                              </span>
                              <span className="text-xs text-ink-muted">
                                ({test.company})
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
                              <span>{formatDate(test.date)}</span>
                              <span>•</span>
                              <span>
                                Window: {formatWindow(test.effectiveWindow.start, test.effectiveWindow.end)}
                              </span>
                              <span>•</span>
                              <span>
                                {test.questionCount > 0
                                  ? `${test.questionCount} questions`
                                  : "30 questions"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right: State Badge + Action Button */}
                        <div className="flex items-center gap-3 self-end md:self-center">
                          <TestStateBadge state={test.state} />

                          {isInProgress ? (
                            <Link href={`/tests/${test.id}/exam`}>
                              <Button size="sm">
                                Resume test
                              </Button>
                            </Link>
                          ) : isStartable ? (
                            <Link href={`/tests/${test.id}/rules`}>
                              <Button size="sm">
                                Start test
                              </Button>
                            </Link>
                          ) : isSubmitted && test.effectiveResultsVisible ? (
                            <Link href={`/tests/${test.id}/result`}>
                              <Button size="sm" variant="secondary">
                                View results
                              </Button>
                            </Link>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled
                            >
                              {isSubmitted
                                ? "Submitted"
                                : test.state === "closed"
                                ? "Window closed"
                                : "Upcoming"}
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </StudentGuard>
  );
}
