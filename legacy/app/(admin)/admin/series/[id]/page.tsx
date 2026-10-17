"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { Navbar } from "@/components/ui/Navbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Badge, SeriesStatusBadge } from "@/components/ui/Badge";
import { apiClient } from "@/lib/apiClient";
import { formatDate, formatWindow } from "@/lib/time";
import { Series, Test } from "@/types";

export default function SeriesDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);

  const [series, setSeries] = useState<Series | null>(null);
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [maxStrikes, setMaxStrikes] = useState(3);
  const [devtoolsPolicy, setDevtoolsPolicy] = useState<"strike" | "submit">("strike");
  const [cameraStrikes, setCameraStrikes] = useState(true);
  const [resultsVisible, setResultsVisible] = useState(false);
  const [secondaryCameraRequired, setSecondaryCameraRequired] = useState(true);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const [generatingLeaderboard, setGeneratingLeaderboard] = useState(false);
  const [leaderboardMsg, setLeaderboardMsg] = useState<string | null>(null);

  // Add Day modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingDay, setAddingDay] = useState(false);
  const [addDayError, setAddDayError] = useState<string | null>(null);
  const [newDayNumber, setNewDayNumber] = useState<number>(6);
  const [newDayTitle, setNewDayTitle] = useState("");
  const [newDayCompany, setNewDayCompany] = useState("");
  const [newDayDate, setNewDayDate] = useState("");

  // Delete Day state
  const [deletingTestId, setDeletingTestId] = useState<string | null>(null);

  const fetchSeries = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ series: Series; tests: Test[] }>(
        `/api/admin/series/${seriesId}`
      );
      setSeries(data.series);
      setTests((data.tests || []).sort((a, b) => a.day - b.day));

      setTitle(data.series.title);
      setStartTime(data.series.window.start);
      setEndTime(data.series.window.end);
      setDurationMin(data.series.durationMin);
      setMaxStrikes(data.series.maxStrikes);
      setDevtoolsPolicy(data.series.devtoolsOpenPolicy);
      setCameraStrikes(data.series.cameraStrikes ?? true);
      setResultsVisible(data.series.resultsVisible);
      setSecondaryCameraRequired(data.series.secondaryCameraRequired !== false);
      setLeaderboardVisible(data.series.leaderboardVisible);
    } catch (err: any) {
      setError(err?.message || "Failed to load series details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSeries();
  }, [seriesId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await apiClient.patch<{ series: Series }>(
        `/api/admin/series/${seriesId}`,
        {
          title: title.trim(),
          window: {
            start: startTime.trim(),
            end: endTime.trim(),
            tz: series?.window.tz || "Asia/Kolkata",
          },
          durationMin,
          maxStrikes,
          devtoolsOpenPolicy: devtoolsPolicy,
          cameraStrikes,
          secondaryCameraRequired,
          resultsVisible,
          leaderboardVisible,
        }
      );

      setSeries(res.series);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save series updates");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateLeaderboard = async () => {
    setGeneratingLeaderboard(true);
    setLeaderboardMsg(null);
    try {
      const res = await apiClient.post<{ message: string }>(
        `/api/admin/series/${seriesId}/leaderboard/generate`
      );
      setLeaderboardMsg(res.message || "Leaderboard generated successfully.");
      setTimeout(() => setLeaderboardMsg(null), 5000);
    } catch (err: any) {
      alert(err?.message || "Failed to generate leaderboard");
    } finally {
      setGeneratingLeaderboard(false);
    }
  };

  const handleActivate = async () => {
    try {
      await apiClient.post(`/api/admin/series/${seriesId}/activate`);
      await fetchSeries();
    } catch (err: any) {
      alert(err?.message || "Failed to activate series");
    }
  };

  const handleArchive = async () => {
    if (!confirm("Are you sure? Once archived, this series becomes read-only.")) {
      return;
    }
    try {
      await apiClient.post(`/api/admin/series/${seriesId}/archive`);
      await fetchSeries();
    } catch (err: any) {
      alert(err?.message || "Failed to archive series");
    }
  };

  const handleOpenAddModal = () => {
    const highestDay = tests.length > 0 ? Math.max(...tests.map((t) => t.day)) : 0;
    const nextDay = highestDay + 1;
    setNewDayNumber(nextDay);
    setNewDayTitle(`Day ${nextDay} Placement Test`);
    setNewDayCompany("");

    if (tests.length > 0) {
      const sortedTests = [...tests].sort((a, b) => a.date.localeCompare(b.date));
      const lastDate = sortedTests[sortedTests.length - 1].date;
      const d = new Date(lastDate + "T00:00:00");
      d.setDate(d.getDate() + 1);
      setNewDayDate(d.toISOString().split("T")[0]);
    } else {
      setNewDayDate(new Date().toISOString().split("T")[0]);
    }

    setAddDayError(null);
    setShowAddModal(true);
  };

  const handleAddDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingDay(true);
    setAddDayError(null);
    try {
      await apiClient.post(`/api/admin/series/${seriesId}/tests`, {
        day: Number(newDayNumber),
        title: newDayTitle.trim(),
        company: newDayCompany.trim(),
        date: newDayDate,
      });
      setShowAddModal(false);
      await fetchSeries();
    } catch (err: any) {
      setAddDayError(err?.message || "Failed to add test day");
    } finally {
      setAddingDay(false);
    }
  };

  const handleDeleteTest = async (testToDelete: Test) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete Day ${testToDelete.day} (${testToDelete.title})?\n\nThis will permanently delete this test, its question set, and all student attempts recorded for it.`
    );
    if (!confirmed) return;

    setDeletingTestId(testToDelete.id);
    try {
      await apiClient.delete(`/api/admin/tests/${testToDelete.id}`);
      await fetchSeries();
    } catch (err: any) {
      alert(err?.message || "Failed to delete test");
    } finally {
      setDeletingTestId(null);
    }
  };

  if (loading) {
    return (
      <AdminGuard>
        <div className="min-h-screen bg-paper flex flex-col">
          <Navbar />
          <div className="flex-1 flex items-center justify-center p-6 text-sm text-ink-muted">
            Loading series configuration...
          </div>
        </div>
      </AdminGuard>
    );
  }

  if (error || !series) {
    return (
      <AdminGuard>
        <div className="min-h-screen bg-paper flex flex-col">
          <Navbar />
          <div className="flex-1 max-w-4xl mx-auto p-6">
            <div className="p-6 bg-surface border border-red/30 rounded-xl text-red">
              {error || "Series not found"}
            </div>
          </div>
        </div>
      </AdminGuard>
    );
  }

  const isArchived = series.status === "archived";

  return (
    <AdminGuard>
      <div className="min-h-screen bg-paper flex flex-col">
        <Navbar />

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
          {/* Header */}
          <div className="border-b border-line pb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Link
                  href="/admin"
                  className="text-xs text-ink-muted hover:text-ink transition-colors"
                >
                  ← All series
                </Link>
                <span className="text-xs text-ink-muted">•</span>
                <span className="text-xs text-ink-muted">
                  ID: {series.id}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-ink">
                  {series.title}
                </h1>
                <SeriesStatusBadge status={series.status} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={handleGenerateLeaderboard}
                loading={generatingLeaderboard}
              >
                Generate leaderboard
              </Button>
              {series.status === "draft" && (
                <Button onClick={handleActivate}>
                  Activate series
                </Button>
              )}
              {series.status === "active" && (
                <Button variant="secondary" onClick={handleArchive}>
                  Archive series
                </Button>
              )}
            </div>
          </div>

          {leaderboardMsg && (
            <Notice variant="default" className="flex items-center justify-between">
              <span>{leaderboardMsg}</span>
              <Link href="/leaderboard" className="underline text-xs ml-3">
                View leaderboard →
              </Link>
            </Notice>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Settings Form */}
            <Card className="lg:col-span-5 p-6 space-y-5">
              <div className="border-b border-line pb-3">
                <h2 className="text-base font-semibold text-ink">
                  Series settings
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Settings inherited by all {tests.length} tests in this series
                </p>
              </div>

              {saveError && (
                <Notice variant="error">
                  {saveError}
                </Notice>
              )}
              {saveSuccess && (
                <Notice variant="default">
                  Series configuration saved successfully.
                </Notice>
              )}

              <form onSubmit={handleSave} className="space-y-4">
                <Input
                  label="Series title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isArchived}
                  required
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Daily window start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={isArchived}
                    required
                  />
                  <Input
                    label="Daily window end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    disabled={isArchived}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Duration (minutes)"
                    type="number"
                    min="5"
                    max="180"
                    value={durationMin}
                    onChange={(e) => setDurationMin(parseInt(e.target.value, 10))}
                    disabled={isArchived}
                    required
                  />
                  <Input
                    label="Max strikes"
                    type="number"
                    min="1"
                    max="10"
                    value={maxStrikes}
                    onChange={(e) => setMaxStrikes(parseInt(e.target.value, 10))}
                    disabled={isArchived}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5 font-sans">
                    Developer tools policy
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-lg border border-line bg-surface text-ink text-sm font-sans"
                    value={devtoolsPolicy}
                    onChange={(e) =>
                      setDevtoolsPolicy(e.target.value as "strike" | "submit")
                    }
                    disabled={isArchived}
                  >
                    <option value="strike">Warning strike (Recommended)</option>
                    <option value="submit">Instant auto-submit</option>
                  </select>
                </div>

                <div className="border border-line rounded-lg p-3 bg-paper">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cameraStrikes}
                      onChange={(e) => setCameraStrikes(e.target.checked)}
                      disabled={isArchived}
                      className="w-4 h-4 rounded border-line text-pen"
                    />
                    <div>
                      <span className="text-sm font-medium text-ink block">
                        Count camera warnings as strikes
                      </span>
                      <span className="text-xs text-ink-muted">
                        When enabled, 8s sustained camera warnings add strikes
                      </span>
                    </div>
                  </label>
                </div>

                <div className="border-t border-line pt-4 space-y-3">
                  <div className="text-xs font-medium text-ink-muted">
                    Visibility controls
                  </div>

                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={resultsVisible}
                      onChange={(e) => setResultsVisible(e.target.checked)}
                      disabled={isArchived}
                      className="w-4 h-4 rounded border-line text-pen"
                    />
                    <div>
                      <span className="text-sm font-medium text-ink block">
                        Release test results
                      </span>
                      <span className="text-xs text-ink-muted">
                        Students can review their score and solutions
                      </span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={secondaryCameraRequired}
                      onChange={(e) => setSecondaryCameraRequired(e.target.checked)}
                      disabled={isArchived}
                      className="w-4 h-4 rounded border-line text-pen"
                    />
                    <div>
                      <span className="text-sm font-medium text-ink block">
                        Require secondary mobile camera (Active by default)
                      </span>
                      <span className="text-xs text-ink-muted">
                        Candidates must scan QR and pair phone as a 45° desk camera. Uncheck to turn off for all tests inheriting series settings.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={leaderboardVisible}
                      onChange={(e) => setLeaderboardVisible(e.target.checked)}
                      disabled={isArchived}
                      className="w-4 h-4 rounded border-line text-pen"
                    />
                    <div>
                      <span className="text-sm font-medium text-ink block">
                        Publish leaderboard
                      </span>
                      <span className="text-xs text-ink-muted">
                        Display ranks to students
                      </span>
                    </div>
                  </label>
                </div>

                {!isArchived && (
                  <div className="pt-2">
                    <Button type="submit" className="w-full" loading={saving}>
                      Save configuration
                    </Button>
                  </div>
                )}
              </form>
            </Card>

            {/* Right Column: Dynamic Daily Tests */}
            <Card className="lg:col-span-7 p-6 space-y-5">
              <div className="border-b border-line pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-ink">
                    {tests.length}-day assessment sequence
                  </h2>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Upload questions, customize timings, and manage test days
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-muted">
                    {tests.length} {tests.length === 1 ? "day" : "days"} configured
                  </span>
                  {!isArchived && (
                    <Button size="sm" onClick={handleOpenAddModal}>
                      Add day test
                    </Button>
                  )}
                </div>
              </div>

              {tests.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-line rounded-lg p-6 bg-paper">
                  <p className="text-sm font-medium text-ink">No assessment days configured yet</p>
                  <p className="text-xs text-ink-muted mt-1 mb-4">
                    Add your first test day to begin configuring this series.
                  </p>
                  {!isArchived && (
                    <Button size="sm" onClick={handleOpenAddModal}>
                      Add day test
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {tests.map((test) => (
                    <div
                      key={test.id}
                      className="border border-line rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-paper/50"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="font-semibold text-lg text-ink-muted tabular-nums w-7">
                          {test.day < 10 ? `0${test.day}` : test.day}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-ink">
                              {test.title}
                            </span>
                            <Badge variant="neutral">
                              {test.company}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted mt-1">
                            <span>{formatDate(test.date)}</span>
                            <span>•</span>
                            <span>
                              {test.window
                                ? formatWindow(test.window.start, test.window.end)
                                : `${series.window.start} – ${series.window.end}`}
                            </span>
                            <span>•</span>
                            <span>
                              {test.hasQuestions ? (
                                <Badge variant="open" dot>
                                  {test.questionCount} questions uploaded
                                </Badge>
                              ) : (
                                <span className="text-ink-muted">
                                  No questions uploaded
                                </span>
                              )}
                            </span>
                            <span>•</span>
                            <span>
                              {test.resultsVisible === true ? (
                                <span className="text-green font-medium">Answers released</span>
                              ) : test.resultsVisible === false ? (
                                <span className="text-ink-muted">Answers locked</span>
                              ) : (
                                <span className="text-ink-muted">Auto-release (11 PM)</span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="self-end sm:self-center flex items-center gap-2">
                        <Link href={`/admin/tests/${test.id}`}>
                          <Button size="sm" variant={test.hasQuestions ? "secondary" : "primary"}>
                            {test.hasQuestions ? "Edit questions" : "Upload questions"}
                          </Button>
                        </Link>

                        {!isArchived && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteTest(test)}
                            disabled={deletingTestId === test.id}
                            className="text-red hover:bg-red/5 text-xs"
                            title="Delete this test day"
                          >
                            {deletingTestId === test.id ? "Deleting..." : "Delete"}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </main>

        {/* Add Day Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
            <Card className="max-w-lg w-full p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div>
                  <h3 className="text-lg font-semibold text-ink">
                    Add assessment day
                  </h3>
                  <p className="text-xs text-ink-muted">
                    Add a new test day to this assessment sequence
                  </p>
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-ink-muted hover:text-ink text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {addDayError && (
                <Notice variant="error">
                  {addDayError}
                </Notice>
              )}

              <form onSubmit={handleAddDay} className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Input
                      label="Day #"
                      type="number"
                      min="1"
                      max="30"
                      value={newDayNumber}
                      onChange={(e) =>
                        setNewDayNumber(parseInt(e.target.value, 10) || 1)
                      }
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      label="Test title"
                      value={newDayTitle}
                      onChange={(e) => setNewDayTitle(e.target.value)}
                      placeholder="e.g. Day 6 Placement Test"
                      required
                    />
                  </div>
                </div>

                <Input
                  label="Target company / focus"
                  value={newDayCompany}
                  onChange={(e) => setNewDayCompany(e.target.value)}
                  placeholder="e.g. Wipro (Turbo / Elite)"
                  required
                />

                <Input
                  label="Assessment date"
                  type="date"
                  value={newDayDate}
                  onChange={(e) => setNewDayDate(e.target.value)}
                  required
                />

                <p className="text-xs text-ink-muted">
                  Timing window and duration will inherit series defaults ({startTime} – {endTime}, {durationMin} min).
                </p>

                <div className="flex justify-end gap-3 pt-3 border-t border-line">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowAddModal(false)}
                    disabled={addingDay}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" loading={addingDay}>
                    Add assessment day
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
