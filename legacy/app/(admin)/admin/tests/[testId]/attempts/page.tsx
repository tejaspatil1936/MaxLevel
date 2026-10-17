"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { Navbar } from "@/components/ui/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { apiClient } from "@/lib/apiClient";
import { auth } from "@/lib/firebase-client";

interface AttemptItem {
  id: string;
  uid: string;
  name: string;
  prn: string;
  email: string;
  score: number;
  total: number;
  timeTakenSec: number;
  strikes: number;
  status: "awaiting_start" | "in_progress" | "submitted" | "auto_submitted" | "terminated_by_proctor";
  submitReason: string | null;
  submitReasonDetail?: string | null;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  events: Array<{
    type: string;
    at: string;
    meta?: Record<string, any>;
  }>;
}

type SortField = "startedAt" | "duration" | "score" | "strikes" | "name" | "status";
type SortDirection = "asc" | "desc";

export default function AdminTestAttemptsPage() {
  const params = useParams();
  const testId = params.testId as string;

  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<AttemptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("startedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchAttempts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ attempts: AttemptItem[] }>(
        `/api/admin/tests/${testId}/attempts`
      );
      setAttempts(res.attempts || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load attempts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (testId) {
      fetchAttempts();
    }
  }, [testId]);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/tests/${testId}/attempts/export`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to export attempts CSV");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attempts_${testId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAttempt = async (attemptIdToDelete: string, studentName: string) => {
    if (
      !confirm(
        `Are you sure you want to reset and delete the attempt for ${studentName}?\n\nThis will permanently remove their attempt and allow them to take this test again.`
      )
    ) {
      return;
    }

    try {
      await apiClient.delete(
        `/api/admin/tests/${testId}/attempts?attemptId=${attemptIdToDelete}`
      );
      await fetchAttempts();
    } catch (err: any) {
      alert(err?.message || "Failed to reset attempt");
    }
  };

  const handleClearAllAttempts = async () => {
    if (
      !confirm(
        `Are you sure you want to delete all attempts for this test?\n\nThis will clear records for all students and allow them to retake the test.`
      )
    ) {
      return;
    }

    try {
      await apiClient.delete(
        `/api/admin/tests/${testId}/attempts?clearAll=true`
      );
      await fetchAttempts();
    } catch (err: any) {
      alert(err?.message || "Failed to clear all attempts");
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const formatStartTime = (isoString?: string | null) => {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return "—";
    }
  };

  const formatDateLabel = (isoString?: string | null) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "name" ? "asc" : "desc");
    }
  };

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return (
        <span className="opacity-0 group-hover:opacity-40 transition-opacity ml-1 select-none text-[10px]">
          ↕
        </span>
      );
    }
    return (
      <span className="text-pen font-bold ml-1 select-none text-[10px]">
        {sortDirection === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  const filteredAttempts = attempts
    .filter((att) => {
      const matchesSearch =
        !search.trim() ||
        att.name.toLowerCase().includes(search.toLowerCase()) ||
        att.prn.toLowerCase().includes(search.toLowerCase()) ||
        att.email.toLowerCase().includes(search.toLowerCase());

      const matchesStatus =
        selectedStatus === "all" ||
        att.status === selectedStatus ||
        (selectedStatus === "with_strikes" && att.strikes > 0);

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      let comparison = 0;

      if (sortField === "startedAt") {
        const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        if (timeA === 0 && timeB !== 0) return 1;
        if (timeB === 0 && timeA !== 0) return -1;
        comparison = timeA - timeB;
      } else if (sortField === "duration") {
        comparison = (a.timeTakenSec || 0) - (b.timeTakenSec || 0);
      } else if (sortField === "score") {
        comparison = (a.score || 0) - (b.score || 0);
      } else if (sortField === "strikes") {
        comparison = (a.strikes || 0) - (b.strikes || 0);
      } else if (sortField === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === "status") {
        comparison = a.status.localeCompare(b.status);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

  const counts = {
    all: attempts.length,
    submitted: attempts.filter((a) => a.status === "submitted").length,
    auto_submitted: attempts.filter((a) => a.status === "auto_submitted").length,
    terminated_by_proctor: attempts.filter((a) => a.status === "terminated_by_proctor").length,
    in_progress: attempts.filter((a) => a.status === "in_progress").length,
    awaiting_start: attempts.filter((a) => a.status === "awaiting_start").length,
    with_strikes: attempts.filter((a) => (a.strikes || 0) > 0).length,
  };

  const totalAttempts = attempts.length;
  const completedAttempts = attempts.filter(
    (a) =>
      a.status === "submitted" ||
      a.status === "auto_submitted" ||
      a.status === "terminated_by_proctor"
  );
  const submittedCount = completedAttempts.length;
  const strikesTotal = attempts.reduce((acc, a) => acc + (a.strikes || 0), 0);
  const avgScore =
    submittedCount > 0
      ? (
          completedAttempts.reduce((acc, a) => acc + a.score, 0) / submittedCount
        ).toFixed(1)
      : "0";

  return (
    <AdminGuard>
      <div className="min-h-screen bg-paper flex flex-col">
        <Navbar />

        <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          {/* Top Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Link
                  href={`/admin/tests/${testId}`}
                  className="text-xs text-pen hover:underline flex items-center gap-1 font-medium"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to test details
                </Link>
                <span className="text-xs text-ink-muted">•</span>
                <span className="text-xs text-ink-muted font-medium">Live Proctor Monitor</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-ink tracking-tight">
                Student attempts & monitoring
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={fetchAttempts}
                disabled={loading}
                className="shadow-sm"
              >
                <svg className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={handleExportCsv}
                disabled={exporting || attempts.length === 0}
                className="shadow-sm"
              >
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {exporting ? "Exporting..." : "Export CSV"}
              </Button>
              {attempts.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleClearAllAttempts}
                  className="border-line text-red hover:bg-red/10 font-semibold shadow-sm"
                >
                  Clear all
                </Button>
              )}
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 bg-surface border border-line shadow-sm hover:border-pen/40 transition-all rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-muted font-medium">Total registered</span>
                <span className="w-2 h-2 rounded-full bg-pen" />
              </div>
              <div className="font-bold text-2xl sm:text-3xl text-ink mt-1.5 tabular-nums">
                {totalAttempts}
              </div>
              <div className="text-[11px] text-ink-muted mt-1 flex items-center gap-1.5">
                <span className="text-blue-600 font-semibold">{counts.in_progress} live</span>
                <span>•</span>
                <span className="text-amber-600 font-semibold">{counts.awaiting_start} pairing</span>
              </div>
            </Card>

            <Card className="p-4 bg-surface border border-line shadow-sm hover:border-green/40 transition-all rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-muted font-medium">Completed tests</span>
                <span className="w-2 h-2 rounded-full bg-green" />
              </div>
              <div className="font-bold text-2xl sm:text-3xl text-green mt-1.5 tabular-nums">
                {submittedCount}
              </div>
              <div className="text-[11px] text-ink-muted mt-1">
                {counts.submitted} manual • {counts.auto_submitted} expired
              </div>
            </Card>

            <Card className="p-4 bg-surface border border-line shadow-sm hover:border-pen/40 transition-all rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-muted font-medium">Class average</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-pen/10 text-pen">AVG</span>
              </div>
              <div className="font-bold text-2xl sm:text-3xl text-pen mt-1.5 tabular-nums">
                {avgScore}
              </div>
              <div className="text-[11px] text-ink-muted mt-1">
                Across {submittedCount} submitted tests
              </div>
            </Card>

            <Card className="p-4 bg-surface border border-line shadow-sm hover:border-red/40 transition-all rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-muted font-medium">Total strikes</span>
                <span className="w-2 h-2 rounded-full bg-red" />
              </div>
              <div className="font-bold text-2xl sm:text-3xl text-ink mt-1.5 tabular-nums">
                {strikesTotal}
              </div>
              <div className="text-[11px] text-ink-muted mt-1 flex items-center gap-1.5">
                <span className="text-red font-semibold">{counts.terminated_by_proctor} terminated</span>
                <span>•</span>
                <span>{counts.with_strikes} warned</span>
              </div>
            </Card>
          </div>

          {/* Unified Filter & Action Toolbar */}
          <div className="space-y-3 bg-surface border border-line rounded-xl p-3.5 shadow-sm">
            {/* Filter Pills Row */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              {[
                { id: "all", label: "All", count: counts.all },
                { id: "submitted", label: "Submitted", count: counts.submitted },
                { id: "in_progress", label: "In progress", count: counts.in_progress },
                { id: "awaiting_start", label: "Pairing / Rules", count: counts.awaiting_start },
                { id: "auto_submitted", label: "Auto-submitted", count: counts.auto_submitted },
                { id: "terminated_by_proctor", label: "Terminated", count: counts.terminated_by_proctor },
                { id: "with_strikes", label: "With strikes", count: counts.with_strikes },
              ].map((tab) => {
                const isActive = selectedStatus === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedStatus(tab.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      isActive
                        ? "bg-pen text-white shadow-sm"
                        : "bg-paper text-ink-muted hover:text-ink hover:bg-paper/80 border border-line"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums font-bold leading-none ${
                        isActive
                          ? "bg-white/20 text-white"
                          : "bg-line text-ink-muted"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sub-toolbar: Counter + Sort + Search */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-line/60">
              <div className="text-xs text-ink-muted font-medium">
                Showing <span className="font-bold text-ink tabular-nums">{filteredAttempts.length}</span> of{" "}
                <span className="font-bold text-ink tabular-nums">{attempts.length}</span> candidate attempts
              </div>

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
                {/* Sort Dropdown */}
                <div className="relative flex items-center bg-paper border border-line rounded-lg px-3 h-9 text-xs shadow-sm hover:border-pen/40 transition-colors">
                  <svg className="w-3.5 h-3.5 text-ink-muted mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                  <span className="text-ink-muted mr-1.5 font-medium">Sort:</span>
                  <select
                    value={`${sortField}_${sortDirection}`}
                    onChange={(e) => {
                      const [f, d] = e.target.value.split("_") as [SortField, SortDirection];
                      setSortField(f);
                      setSortDirection(d);
                    }}
                    className="bg-transparent text-ink font-semibold focus:outline-none cursor-pointer pr-5 appearance-none"
                  >
                    <option value="startedAt_desc">Start time (Newest first)</option>
                    <option value="startedAt_asc">Start time (Oldest first)</option>
                    <option value="score_desc">Score (Highest first)</option>
                    <option value="score_asc">Score (Lowest first)</option>
                    <option value="duration_desc">Duration (Longest first)</option>
                    <option value="duration_asc">Duration (Shortest first)</option>
                    <option value="strikes_desc">Strikes (Most first)</option>
                    <option value="name_asc">Name (A → Z)</option>
                    <option value="name_desc">Name (Z → A)</option>
                    <option value="status_asc">Status</option>
                  </select>
                  <svg className="w-3 h-3 text-ink-muted pointer-events-none absolute right-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Search Box */}
                <div className="relative w-full sm:w-64">
                  <svg className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search candidate, PRN..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full h-9 pl-9 pr-7 text-xs rounded-lg border border-line bg-paper text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-pen focus:border-pen shadow-sm transition-all"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Table or States */}
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 bg-surface rounded-xl border border-line">
              <div className="w-6 h-6 border-2 border-pen border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium text-ink-muted">
                Loading candidate attempts & proctor streams...
              </p>
            </div>
          ) : error ? (
            <Notice variant="error">{error}</Notice>
          ) : filteredAttempts.length === 0 ? (
            <Card className="p-12 text-center rounded-xl">
              <p className="text-sm font-medium text-ink-muted">No candidate attempts match this filter.</p>
            </Card>
          ) : (
            <div className="bg-surface rounded-xl border border-line shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-paper border-b border-line text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                    <tr>
                      <th
                        onClick={() => handleSort("name")}
                        className="py-3.5 px-4 font-semibold cursor-pointer select-none group hover:text-ink transition-colors min-w-[240px]"
                        title="Click to sort by Student Name"
                      >
                        <span className="inline-flex items-center gap-1">
                          Student {renderSortIndicator("name")}
                        </span>
                      </th>
                      <th
                        onClick={() => handleSort("startedAt")}
                        className="py-3.5 px-4 text-center font-semibold cursor-pointer select-none group hover:text-ink transition-colors min-w-[120px]"
                        title="Click to sort by Start Time"
                      >
                        <span className="inline-flex items-center justify-center gap-1">
                          Started {renderSortIndicator("startedAt")}
                        </span>
                      </th>
                      <th
                        onClick={() => handleSort("duration")}
                        className="py-3.5 px-4 text-center font-semibold cursor-pointer select-none group hover:text-ink transition-colors min-w-[100px]"
                        title="Click to sort by Duration"
                      >
                        <span className="inline-flex items-center justify-center gap-1">
                          Duration {renderSortIndicator("duration")}
                        </span>
                      </th>
                      <th
                        onClick={() => handleSort("score")}
                        className="py-3.5 px-4 text-center font-semibold cursor-pointer select-none group hover:text-ink transition-colors min-w-[90px]"
                        title="Click to sort by Score"
                      >
                        <span className="inline-flex items-center justify-center gap-1">
                          Score {renderSortIndicator("score")}
                        </span>
                      </th>
                      <th
                        onClick={() => handleSort("strikes")}
                        className="py-3.5 px-4 text-center font-semibold cursor-pointer select-none group hover:text-ink transition-colors min-w-[80px]"
                        title="Click to sort by Strikes"
                      >
                        <span className="inline-flex items-center justify-center gap-1">
                          Strikes {renderSortIndicator("strikes")}
                        </span>
                      </th>
                      <th
                        onClick={() => handleSort("status")}
                        className="py-3.5 px-4 text-center font-semibold cursor-pointer select-none group hover:text-ink transition-colors min-w-[140px]"
                        title="Click to sort by Status"
                      >
                        <span className="inline-flex items-center justify-center gap-1">
                          Status {renderSortIndicator("status")}
                        </span>
                      </th>
                      <th className="py-3.5 px-4 font-semibold min-w-[180px]">Submit reason</th>
                      <th className="py-3.5 px-4 text-right font-semibold min-w-[140px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-xs">
                    {filteredAttempts.map((att) => {
                      const isExpanded = expandedAttemptId === att.id;
                      const hasStrikes = att.strikes > 0;
                      const isMaxStrikes = att.strikes >= 3;

                      const initials =
                        att.name
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join("") || "S";

                      return (
                        <React.Fragment key={att.id}>
                          <tr className={`transition-colors ${isExpanded ? "bg-pen/[0.03]" : "hover:bg-paper/50"}`}>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-pen/10 text-pen font-bold text-xs flex items-center justify-center shrink-0 uppercase tracking-tight">
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-ink truncate text-xs">
                                    {att.name}
                                  </div>
                                  <div className="text-[11px] text-ink-muted truncate">
                                    {att.prn} • {att.email}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 text-center tabular-nums">
                              {att.status === "awaiting_start" || !att.startedAt ? (
                                <span className="text-xs text-ink-muted font-medium">—</span>
                              ) : (
                                <div className="flex flex-col items-center">
                                  <span className="font-medium text-xs text-ink whitespace-nowrap">
                                    {formatStartTime(att.startedAt)}
                                  </span>
                                  <span className="text-[10px] text-ink-muted whitespace-nowrap">
                                    {formatDateLabel(att.startedAt)}
                                  </span>
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-center text-xs text-ink-muted tabular-nums whitespace-nowrap">
                              {att.status === "awaiting_start" ? "—" : formatTime(att.timeTakenSec)}
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {att.status === "awaiting_start" ? (
                                <span className="text-xs text-ink-muted">—</span>
                              ) : (
                                <>
                                  <span className="font-bold text-sm text-pen tabular-nums">
                                    {att.score}
                                  </span>
                                  <span className="text-xs text-ink-muted"> / {att.total}</span>
                                </>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {att.status === "awaiting_start" ? (
                                <span className="text-xs text-ink-muted">—</span>
                              ) : (
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-xs tabular-nums font-semibold ${
                                    isMaxStrikes
                                      ? "bg-red/10 text-red"
                                      : hasStrikes
                                      ? "bg-amber-500/10 text-amber-700"
                                      : "text-ink-muted"
                                  }`}
                                >
                                  {att.strikes}
                                </span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {att.status === "awaiting_start" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 border border-amber-500/20 whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                  Pairing / Rules
                                </span>
                              ) : att.status === "in_progress" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                  In progress
                                </span>
                              ) : att.status === "terminated_by_proctor" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red/10 text-red border border-red/20 whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red" />
                                  Terminated
                                </span>
                              ) : att.status === "auto_submitted" ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-600 border border-purple-500/20 whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                  Auto-submitted
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green/10 text-green border border-green/20 whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green" />
                                  Submitted
                                </span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 max-w-xs truncate">
                              <span
                                className="text-xs text-ink-muted"
                                title={
                                  att.status === "awaiting_start"
                                    ? "Candidate on rules page pairing mobile device"
                                    : att.submitReasonDetail || att.submitReason || ""
                                }
                              >
                                {att.status === "awaiting_start"
                                  ? "On rules screen (pairing)"
                                  : att.submitReasonDetail || att.submitReason || "—"}
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedAttemptId(isExpanded ? null : att.id)
                                  }
                                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                                    isExpanded
                                      ? "bg-pen text-white shadow-sm"
                                      : "text-pen hover:bg-pen/10"
                                  }`}
                                >
                                  {isExpanded
                                    ? "Hide logs"
                                    : `Logs (${att.events.length})`}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAttempt(att.id, att.name)}
                                  className="px-2 py-1 rounded-md text-xs text-red hover:bg-red/10 transition-colors font-semibold"
                                  title="Reset attempt so student can retake test"
                                >
                                  Reset
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Event Timeline */}
                          {isExpanded && (
                            <tr className="bg-paper/60">
                              <td colSpan={8} className="p-4 sm:p-5">
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between border-b border-line pb-2">
                                    <h4 className="text-xs font-semibold text-ink">
                                      Proctor audit log for {att.name} ({att.events.length} events)
                                    </h4>
                                    <span className="text-xs text-ink-muted">
                                      Started: {att.startedAt ? `${formatDateLabel(att.startedAt)} at ${formatStartTime(att.startedAt)}` : "Not started (Pairing / Rules)"}
                                    </span>
                                  </div>

                                  {att.events.length === 0 ? (
                                    <p className="text-xs text-ink-muted py-2">
                                      No proctor warnings recorded for this session.
                                    </p>
                                  ) : (
                                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-2">
                                      {att.events.map((ev, evIdx) => (
                                        <div
                                          key={evIdx}
                                          className="p-2.5 rounded-lg bg-surface border border-line flex items-center justify-between gap-4 text-xs"
                                        >
                                          <div className="flex items-center gap-2">
                                            <span
                                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                                ev.type.includes("submit") || ev.type.includes("devtools")
                                                  ? "bg-red"
                                                  : "bg-ink-muted"
                                              }`}
                                            />
                                            <span className="font-semibold text-ink">
                                              {ev.type}
                                            </span>
                                            {ev.type === "multiple_screens" && (
                                              <Badge variant="neutral">
                                                Multiple screens
                                              </Badge>
                                            )}
                                            {ev.meta && (
                                              <span className="text-ink-muted text-xs">
                                                {JSON.stringify(ev.meta)}
                                              </span>
                                            )}
                                          </div>
                                          <span className="text-ink-muted shrink-0 text-xs">
                                            {new Date(ev.at).toLocaleTimeString()}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </AdminGuard>
  );
}
