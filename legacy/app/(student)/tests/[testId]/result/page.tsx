"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { StudentGuard } from "@/components/auth/StudentGuard";
import { Navbar } from "@/components/ui/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { apiClient } from "@/lib/apiClient";
import { AttemptResultResponse, QuestionReviewItem } from "@/types";

export default function StudentTestResultPage() {
  const params = useParams();
  const router = useRouter();
  const testId = params.testId as string;
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AttemptResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<"all" | "correct" | "incorrect" | "unanswered">("all");

  useEffect(() => {
    if (!user?.uid || !testId) return;

    const fetchResult = async () => {
      setLoading(true);
      setError(null);
      try {
        const attemptId = `${testId}_${user.uid}`;
        const data = await apiClient.get<AttemptResultResponse>(`/api/attempts/${attemptId}/result`);
        setResult(data);
      } catch (err: any) {
        setError(err?.message || "Failed to load test results.");
      } finally {
        setLoading(false);
      }
    };

    fetchResult();
  }, [user?.uid, testId]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const getFilteredQuestions = () => {
    if (!result) return [];
    return result.questions.filter((q) => {
      if (selectedFilter === "correct") {
        return q.userAnswer === q.correctAnswer;
      }
      if (selectedFilter === "incorrect") {
        return q.userAnswer !== null && q.userAnswer !== q.correctAnswer;
      }
      if (selectedFilter === "unanswered") {
        return q.userAnswer === null;
      }
      return true;
    });
  };

  const correctCount = result?.questions.filter((q) => q.userAnswer === q.correctAnswer).length || 0;
  const incorrectCount = result?.questions.filter((q) => q.userAnswer !== null && q.userAnswer !== q.correctAnswer).length || 0;
  const unansweredCount = result?.questions.filter((q) => q.userAnswer === null).length || 0;
  const percentage = result && result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;

  return (
    <StudentGuard>
      <div className="min-h-screen bg-paper flex flex-col">
        <Navbar />

        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3">
              <span className="w-5 h-5 rounded-full border-2 border-pen border-t-transparent animate-spin" />
              <p className="text-sm text-ink-muted">
                Loading test results...
              </p>
            </div>
          ) : error ? (
            <Card className="max-w-md mx-auto p-8 text-center space-y-4">
              <h1 className="text-lg font-semibold text-ink">
                Results unavailable
              </h1>
              <p className="text-sm text-ink-muted leading-relaxed">
                {error}
              </p>
              <div className="pt-2">
                <Link href="/dashboard" className="block">
                  <Button variant="secondary" className="w-full">Back to dashboard</Button>
                </Link>
              </div>
            </Card>
          ) : !result ? (
            <div className="text-center py-20 text-ink-muted text-sm">No result data found.</div>
          ) : (
            <div className="space-y-8">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-6">
                <div>
                  <h1 className="text-2xl font-semibold text-ink">
                    Test results and solutions
                  </h1>
                  <p className="text-sm text-ink-muted mt-1">
                    Review your score and answer explanations.
                  </p>
                </div>

                <Link href="/dashboard">
                  <Button variant="secondary" size="sm">
                    Back to dashboard
                  </Button>
                </Link>
              </div>

              {/* Display Score Summary */}
              <Card className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                <div className="md:col-span-2 border-b md:border-b-0 md:border-r border-line pb-6 md:pb-0 md:pr-6 space-y-1">
                  <span className="text-xs text-ink-muted">
                    Your score
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-semibold text-ink tabular-nums">
                      {result.score}
                    </span>
                    <span className="text-lg text-ink-muted font-normal">
                      / {result.total}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted pt-1">
                    Accuracy: <span className="text-ink font-semibold">{percentage}%</span>
                  </div>
                </div>

                <div className="space-y-4 md:col-span-2">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg border border-line bg-paper text-center">
                      <div className="font-semibold text-lg text-ink tabular-nums">
                        {correctCount}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">Correct</div>
                    </div>
                    <div className="p-3 rounded-lg border border-line bg-paper text-center">
                      <div className="font-semibold text-lg text-ink tabular-nums">
                        {incorrectCount}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">Incorrect</div>
                    </div>
                    <div className="p-3 rounded-lg border border-line bg-paper text-center">
                      <div className="font-semibold text-lg text-ink tabular-nums">
                        {unansweredCount}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">Skipped</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted pt-2 border-t border-line">
                    <span>
                      Duration: <span className="text-ink font-medium">{formatTime(result.timeTakenSec)}</span>
                    </span>
                    <span>
                      Submitted: <span className="text-ink font-medium">{result.submitReason === "timeout" ? "Time expired" : result.submitReason === "strikes" ? "Proctor limit" : result.submitReason === "camera" ? "Camera issue" : "Manual"}</span>
                    </span>
                  </div>
                </div>
              </Card>

              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-ink">
                    Question review
                  </span>
                  <span className="text-xs text-ink-muted">
                    ({getFilteredQuestions().length} questions shown)
                  </span>
                </div>

                <div className="flex items-center gap-1 p-1 bg-paper border border-line rounded-lg text-xs">
                  {(["all", "correct", "incorrect", "unanswered"] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setSelectedFilter(filter)}
                      className={`px-3 py-1 rounded-md transition-colors capitalize cursor-pointer ${
                        selectedFilter === filter
                          ? "bg-surface text-ink font-semibold shadow-xs"
                          : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              {/* Question Review Cards */}
              <div className="space-y-4">
                {getFilteredQuestions().map((q, idx) => {
                  const isCorrect = q.userAnswer === q.correctAnswer;
                  const isUnanswered = q.userAnswer === null;

                  return (
                    <Card
                      key={q.id}
                      className="p-6 space-y-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-lg border border-line bg-paper flex items-center justify-center text-xs font-semibold text-ink">
                            {idx + 1}
                          </span>
                          {q.topic && (
                            <Badge variant="neutral">
                              {q.topic}
                            </Badge>
                          )}
                        </div>

                        <div>
                          {isCorrect ? (
                            <Badge variant="open" dot>
                              Correct (+1)
                            </Badge>
                          ) : isUnanswered ? (
                            <Badge variant="default">
                              Not attempted
                            </Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs text-red font-normal">
                              <span className="w-1.5 h-1.5 rounded-full bg-red" aria-hidden="true" />
                              Incorrect (0)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Question Text */}
                      <h3 className="font-display font-semibold text-base sm:text-lg text-ink leading-snug whitespace-pre-wrap">
                        {q.text}
                      </h3>

                      {/* Options */}
                      <div className="space-y-2 pt-1">
                        {q.options.map((optionText, optIndex) => {
                          const isOptionCorrect = optIndex === q.correctAnswer;
                          const isOptionUserAnswer = optIndex === q.userAnswer;

                          let optionStyles = "border-line bg-surface text-ink";
                          let badgeText: string | null = null;

                          if (isOptionCorrect) {
                            optionStyles = "border-green/40 bg-surface text-ink font-medium";
                            badgeText = "Correct answer";
                          } else if (isOptionUserAnswer && !isCorrect) {
                            optionStyles = "border-red/40 bg-surface text-ink";
                            badgeText = "Your answer";
                          }

                          const optionLetters = ["A", "B", "C", "D"];

                          return (
                            <div
                              key={optIndex}
                              className={`p-3 rounded-lg border flex items-start justify-between gap-3 text-sm transition-colors ${optionStyles}`}
                            >
                              <div className="flex items-start gap-3">
                                <span
                                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                                    isOptionCorrect
                                      ? "bg-green text-white"
                                      : isOptionUserAnswer
                                      ? "bg-red text-white"
                                      : "bg-paper border border-line text-ink-muted"
                                  }`}
                                >
                                  {optionLetters[optIndex]}
                                </span>
                                <span className="leading-snug pt-0.5">{optionText}</span>
                              </div>

                              {badgeText && (
                                <span className={`text-xs px-2 py-0.5 rounded-md ${isOptionCorrect ? "text-green" : "text-red"}`}>
                                  {badgeText}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Explanation Callout */}
                      {q.explanation && (
                        <div className="mt-3 p-3.5 rounded-lg bg-paper border border-line text-xs space-y-1">
                          <span className="font-semibold text-ink-muted block">
                            Explanation:
                          </span>
                          <p className="text-ink leading-relaxed whitespace-pre-wrap">
                            {q.explanation}
                          </p>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>
    </StudentGuard>
  );
}
