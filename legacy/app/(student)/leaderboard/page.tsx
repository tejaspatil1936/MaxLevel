"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { StudentGuard } from "@/components/auth/StudentGuard";
import { Navbar } from "@/components/ui/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { apiClient } from "@/lib/apiClient";
import { LeaderboardDoc, LeaderboardRow } from "@/types";

interface LeaderboardApiResponse {
  series: {
    id: string;
    title: string;
    status: string;
  };
  tests?: Array<{
    id: string;
    day: number;
    title: string;
    company: string;
  }>;
  leaderboard: LeaderboardDoc;
  availableSeries: Array<{
    id: string;
    title: string;
    status: string;
    archivedAt?: string | null;
  }>;
}

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardApiResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchLeaderboard = async (seriesIdToFetch: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<LeaderboardApiResponse>(
        `/api/leaderboard/${seriesIdToFetch}`
      );
      setData(res);
      setSelectedSeriesId(res.series.id);
    } catch (err: any) {
      setError(err?.message || "Could not load leaderboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard(selectedSeriesId);
  }, []);

  const handleSeriesChange = (seriesId: string) => {
    setSelectedSeriesId(seriesId);
    fetchLeaderboard(seriesId);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const daysList = useMemo(() => {
    if (data?.leaderboard?.days && data.leaderboard.days.length > 0) {
      return [...data.leaderboard.days].sort((a, b) => a - b);
    }
    if (data?.tests && data.tests.length > 0) {
      return Array.from(new Set(data.tests.map((t) => t.day))).sort((a, b) => a - b);
    }
    const daysSet = new Set<number>();
    data?.leaderboard?.rows?.forEach((r) => {
      Object.keys(r.scores || {}).forEach((k) => {
        if (k.startsWith("d")) {
          const num = parseInt(k.replace("d", ""), 10);
          if (!isNaN(num)) daysSet.add(num);
        }
      });
    });
    const list = Array.from(daysSet).sort((a, b) => a - b);
    return list.length > 0 ? list : [1, 2, 3, 4, 5];
  }, [data]);

  const filteredRows = (data?.leaderboard?.rows || []).filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return r.name.toLowerCase().includes(q) || r.prn.toLowerCase().includes(q);
  });

  const currentUserRow = (data?.leaderboard?.rows || []).find(
    (r) => r.uid === user?.uid
  );

  return (
    <StudentGuard>
      <div className="min-h-screen bg-paper flex flex-col">
        <Navbar />

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-line pb-6">
              <div className="space-y-1">
                <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-ink">
                  Leaderboard
                </h1>
                <p className="text-xs sm:text-sm text-ink-muted">
                  Official series rankings ordered by total score and completion time.
                </p>
              </div>

              {/* Series selector */}
              {data && data.availableSeries.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">Series:</span>
                  <select
                    value={selectedSeriesId}
                    onChange={(e) => handleSeriesChange(e.target.value)}
                    className="h-8 px-2.5 rounded-lg border border-line bg-surface text-ink text-xs focus:outline-none focus:border-pen"
                  >
                    {data.availableSeries.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} {s.status === "archived" ? "(Archived)" : s.status === "active" ? "(Active)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {loading ? (
              <div className="py-24 flex items-center justify-center gap-2.5 text-sm text-ink-muted">
                <span className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />
                <span>Loading rankings...</span>
              </div>
            ) : error ? (
              <Card className="max-w-md mx-auto text-center space-y-3">
                <h2 className="font-semibold text-lg text-ink">
                  Could not load leaderboard
                </h2>
                <p className="text-xs text-ink-muted">{error}</p>
                <Link href="/dashboard">
                  <Button variant="secondary" size="sm">Back to dashboard</Button>
                </Link>
              </Card>
            ) : !data || data.leaderboard.rows.length === 0 ? (
              <Card className="text-center max-w-md mx-auto space-y-2">
                <h2 className="font-semibold text-lg text-ink">
                  No records yet
                </h2>
                <p className="text-xs text-ink-muted">
                  Results will appear here once candidates complete tests.
                </p>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Current User Standing Card */}
                {currentUserRow && (
                  <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-pen text-white flex items-center justify-center font-semibold text-lg tabular-nums">
                        #{currentUserRow.rank}
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-xs text-ink-muted block">
                          Your current standing
                        </span>
                        <div className="font-semibold text-base text-ink">
                          {currentUserRow.name}
                        </div>
                        <div className="text-xs text-ink-muted">
                          PRN: {currentUserRow.prn}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 border-t sm:border-t-0 sm:border-l border-line pt-3 sm:pt-0 sm:pl-6 text-xs text-ink-muted">
                      <div>
                        <div>Total score</div>
                        <div className="font-semibold text-xl text-ink tabular-nums">
                          {currentUserRow.total}
                        </div>
                      </div>
                      <div>
                        <div>Total time</div>
                        <div className="font-semibold text-base text-ink tabular-nums">
                          {formatTime(currentUserRow.timeSec)}
                        </div>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Search Bar & Summary */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-ink-muted">
                    Showing {filteredRows.length} of {data.leaderboard.rows.length} candidates
                  </div>

                  <div className="w-full sm:w-64">
                    <input
                      type="text"
                      placeholder="Search by candidate name or PRN..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-8 px-3 text-xs rounded-lg border border-line bg-surface text-ink placeholder:text-ink-muted focus:outline-none focus:border-pen"
                    />
                  </div>
                </div>

                {/* Leaderboard Table */}
                <div className="border border-line rounded-lg bg-surface overflow-hidden">
                  <div className="overflow-x-auto max-h-[640px]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-paper border-b border-line sticky top-0 z-10 font-semibold text-ink-muted">
                        <tr>
                          <th className="py-3 px-4 w-16 text-center">Rank</th>
                          <th className="py-3 px-4">Candidate</th>
                          {daysList.map((d) => (
                            <th key={d} className="py-3 px-3 text-center whitespace-nowrap">
                              Day {d}
                            </th>
                          ))}
                          <th className="py-3 px-4 text-center">Score</th>
                          <th className="py-3 px-4 text-right">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {filteredRows.map((row) => {
                          const isCurrentUser = row.uid === user?.uid;

                          return (
                            <tr
                              key={row.uid}
                              className={`transition-colors ${
                                isCurrentUser
                                  ? "bg-pen-wash font-semibold"
                                  : "hover:bg-paper"
                              }`}
                            >
                              {/* Rank */}
                              <td className="py-3 px-4 text-center tabular-nums text-ink-muted">
                                {row.rank}
                              </td>

                              {/* Student Name & PRN */}
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-ink font-medium">
                                    {row.name}
                                  </span>
                                  {isCurrentUser && (
                                    <span className="text-[11px] text-pen font-medium">
                                      (You)
                                    </span>
                                  )}
                                </div>
                                <div className="text-ink-muted">
                                  {row.prn}
                                </div>
                              </td>

                              {/* Day scores */}
                              {daysList.map((d) => {
                                const score = row.scores[`d${d}`] ?? 0;
                                return (
                                  <td key={d} className="py-3 px-3 text-center tabular-nums">
                                    <span className={score > 0 ? "text-ink" : "text-ink-muted"}>
                                      {score}
                                    </span>
                                  </td>
                                );
                              })}

                              {/* Total Marks */}
                              <td className="py-3 px-4 text-center font-semibold text-ink tabular-nums">
                                {row.total}
                              </td>

                              {/* Total Time */}
                              <td className="py-3 px-4 text-right text-ink-muted tabular-nums">
                                {formatTime(row.timeSec)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </StudentGuard>
  );
}
