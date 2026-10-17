"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { Navbar } from "@/components/ui/Navbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Badge, SeriesStatusBadge } from "@/components/ui/Badge";
import { apiClient } from "@/lib/apiClient";
import { Series } from "@/types";

export default function AdminOverviewPage() {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Roster stats
  const [rosterStats, setRosterStats] = useState<{
    totalCount: number;
    claimedCount: number;
  } | null>(null);

  // Create Series modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newStartTime, setNewStartTime] = useState("07:00");
  const [newEndTime, setNewEndTime] = useState("15:00");
  const [newDuration, setNewDuration] = useState("30");
  const [newStrikes, setNewStrikes] = useState("3");
  const [newDevtoolsPolicy, setNewDevtoolsPolicy] = useState<"strike" | "submit">("strike");
  const [newDaysCount, setNewDaysCount] = useState("5");
  const [newStartDate, setNewStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [seriesRes, eligibilityRes] = await Promise.all([
        apiClient.get<{ series: Series[] }>("/api/admin/series"),
        apiClient.get<{ totalCount: number; claimedCount: number }>(
          "/api/admin/eligibility"
        ),
      ]);
      setSeriesList(seriesRes.series);
      setRosterStats(eligibilityRes);
    } catch (err: any) {
      setError(err?.message || "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      await apiClient.post("/api/admin/series", {
        title: newTitle.trim(),
        daysCount: parseInt(newDaysCount, 10) || 5,
        window: {
          start: newStartTime.trim(),
          end: newEndTime.trim(),
          tz: "Asia/Kolkata",
        },
        durationMin: parseInt(newDuration, 10),
        maxStrikes: parseInt(newStrikes, 10),
        devtoolsOpenPolicy: newDevtoolsPolicy,
        resultsVisible: false,
        leaderboardVisible: false,
        startDate: newStartDate,
      });

      setShowCreateModal(false);
      setNewTitle("");
      await fetchData();
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create series");
    } finally {
      setCreating(false);
    }
  };

  const handleActivate = async (seriesId: string) => {
    try {
      await apiClient.post(`/api/admin/series/${seriesId}/activate`);
      await fetchData();
    } catch (err: any) {
      alert(err?.message || "Failed to activate series");
    }
  };

  const handleArchive = async (seriesId: string) => {
    if (!confirm("Are you sure you want to archive this series? It will become read-only.")) {
      return;
    }
    try {
      await apiClient.post(`/api/admin/series/${seriesId}/archive`);
      await fetchData();
    } catch (err: any) {
      alert(err?.message || "Failed to archive series");
    }
  };

  return (
    <AdminGuard>
      <div className="min-h-screen bg-paper flex flex-col">
        <Navbar />

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
          {/* Header */}
          <div className="border-b border-line pb-6 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="neutral">
                  Administrator portal
                </Badge>
              </div>
              <h1 className="text-2xl font-semibold text-ink">
                Placement test control
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/admin/eligibility">
                <Button variant="secondary">Manage eligibility roster</Button>
              </Link>
              <Button onClick={() => setShowCreateModal(true)}>
                Create new series
              </Button>
            </div>
          </div>

          {/* Top Quick Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <Card className="p-5">
              <div className="text-xs text-ink-muted mb-1 font-medium">
                Eligible roster
              </div>
              <div className="font-semibold text-2xl text-ink tabular-nums">
                {rosterStats?.totalCount ?? "—"}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                Approved students in database
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-xs text-ink-muted mb-1 font-medium">
                Registered accounts
              </div>
              <div className="font-semibold text-2xl text-ink tabular-nums">
                {rosterStats?.claimedCount ?? "—"}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                Students with claimed logins
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-xs text-ink-muted mb-1 font-medium">
                Active series
              </div>
              <div className="font-semibold text-2xl text-pen tabular-nums">
                {seriesList.filter((s) => s.status === "active").length}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                Max 1 active series enforced
              </div>
            </Card>
          </div>

          {/* Series Table */}
          <Card className="overflow-hidden">
            <div className="px-6 py-4 border-b border-line flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">
                Test series
              </h2>
              <span className="text-xs text-ink-muted">
                {seriesList.length} total series
              </span>
            </div>

            {loading ? (
              <div className="p-12 text-center text-sm text-ink-muted">
                Loading series records...
              </div>
            ) : error ? (
              <div className="p-6 text-sm text-red">{error}</div>
            ) : seriesList.length === 0 ? (
              <div className="p-12 text-center text-sm text-ink-muted">
                No series created yet. Click &quot;Create new series&quot; to begin.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm font-sans">
                  <thead className="bg-paper border-b border-line text-xs font-semibold text-ink-muted">
                    <tr>
                      <th className="px-6 py-3 font-semibold">Title</th>
                      <th className="px-6 py-3 font-semibold">Status</th>
                      <th className="px-6 py-3 font-semibold">Window (IST)</th>
                      <th className="px-6 py-3 font-semibold">Duration</th>
                      <th className="px-6 py-3 font-semibold">Strikes</th>
                      <th className="px-6 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {seriesList.map((s) => (
                      <tr key={s.id} className="hover:bg-paper/50">
                        <td className="px-6 py-4">
                          <Link
                            href={`/admin/series/${s.id}`}
                            className="font-semibold text-ink hover:text-pen hover:underline block"
                          >
                            {s.title}
                          </Link>
                          <span className="text-xs text-ink-muted">
                            ID: {s.id}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <SeriesStatusBadge status={s.status} />
                        </td>
                        <td className="px-6 py-4 text-xs text-ink-muted">
                          {s.window.start} – {s.window.end}
                        </td>
                        <td className="px-6 py-4 text-xs">
                          {s.durationMin} mins
                        </td>
                        <td className="px-6 py-4 text-xs">
                          {s.maxStrikes} max
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <Link href={`/admin/series/${s.id}`}>
                            <Button size="sm" variant="secondary">
                              Manage
                            </Button>
                          </Link>

                          {s.status === "draft" && (
                            <Button
                              size="sm"
                              onClick={() => handleActivate(s.id)}
                            >
                              Activate
                            </Button>
                          )}

                          {s.status === "active" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleArchive(s.id)}
                            >
                              Archive
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </main>

        {/* Create Series Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4">
            <Card className="max-w-lg w-full p-6 space-y-4">
              <div className="border-b border-line pb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-ink">
                  Create test series
                </h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-ink-muted hover:text-ink text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {createError && (
                <Notice variant="error">
                  {createError}
                </Notice>
              )}

              <form onSubmit={handleCreateSeries} className="space-y-4">
                <Input
                  label="Series title"
                  placeholder="e.g. October Placement Sprint 2026"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Series start date"
                    type="date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    required
                  />
                  <Input
                    label="Number of assessment days"
                    type="number"
                    min="1"
                    max="30"
                    value={newDaysCount}
                    onChange={(e) => setNewDaysCount(e.target.value)}
                    hint="e.g. 3, 5, 7 or more days"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Daily window start"
                    type="time"
                    value={newStartTime}
                    onChange={(e) => setNewStartTime(e.target.value)}
                    required
                  />
                  <Input
                    label="Daily window end"
                    type="time"
                    value={newEndTime}
                    onChange={(e) => setNewEndTime(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Test duration (minutes)"
                    type="number"
                    min="5"
                    max="180"
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    required
                  />
                  <Input
                    label="Max warning strikes"
                    type="number"
                    min="1"
                    max="10"
                    value={newStrikes}
                    onChange={(e) => setNewStrikes(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5 font-sans">
                    Developer tools policy
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-lg border border-line bg-surface text-ink text-sm font-sans"
                    value={newDevtoolsPolicy}
                    onChange={(e) =>
                      setNewDevtoolsPolicy(e.target.value as "strike" | "submit")
                    }
                  >
                    <option value="strike">Count as strike (Default)</option>
                    <option value="submit">Instant auto-submit</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t border-line">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowCreateModal(false)}
                    disabled={creating}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" loading={creating}>
                    Create series & {newDaysCount || 5} tests
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
