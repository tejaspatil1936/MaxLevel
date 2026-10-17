"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { useAuth } from "@/components/auth/AuthProvider";
import { Navbar } from "@/components/ui/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Badge } from "@/components/ui/Badge";
import { apiClient } from "@/lib/apiClient";
import { EligibleUser } from "@/types";

type SortField = "prn" | "name" | "email" | "status";
type SortOrder = "asc" | "desc";
type StatusFilter = "all" | "claimed" | "unclaimed";

export default function EligibilityAdminPage() {
  const { user: authUser, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<EligibleUser[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [claimedCount, setClaimedCount] = useState(0);
  const [unclaimedCount, setUnclaimedCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);

  // Search & Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortField>("prn");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [totalPages, setTotalPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection & deletion states
  const [selectedPrns, setSelectedPrns] = useState<string[]>([]);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<EligibleUser | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    added: number;
    updated: number;
    rejected: number;
    invalidRows: Array<{ rowNumber: number; reason: string }>;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce search input (250ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to page 1 on new search
      setSelectAllMatching(false);
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  // Fetch roster callback
  const fetchRoster = useCallback(
    async (
      targetPage = page,
      targetSearch = debouncedSearch,
      targetPageSize = pageSize,
      targetStatus = statusFilter,
      targetSortBy = sortBy,
      targetSortOrder = sortOrder
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient.get<{
          users: EligibleUser[];
          totalCount: number;
          claimedCount: number;
          unclaimedCount: number;
          filteredCount: number;
          page: number;
          pageSize: number;
          totalPages: number;
        }>("/api/admin/eligibility", {
          params: {
            search: targetSearch.trim() || undefined,
            page: targetPage,
            pageSize: targetPageSize,
            status: targetStatus !== "all" ? targetStatus : undefined,
            sortBy: targetSortBy,
            sortOrder: targetSortOrder,
          },
        });

        setUsers(data.users || []);
        setTotalCount(data.totalCount || 0);
        setClaimedCount(data.claimedCount || 0);
        setUnclaimedCount(
          data.unclaimedCount ?? (data.totalCount - data.claimedCount)
        );
        setFilteredCount(data.filteredCount ?? data.totalCount);
        setTotalPages(data.totalPages || 1);
        setPage(data.page || 1);
      } catch (err: any) {
        setError(err?.message || "Failed to load eligibility roster");
      } finally {
        setLoading(false);
      }
    },
    [page, debouncedSearch, pageSize, statusFilter, sortBy, sortOrder]
  );

  useEffect(() => {
    if (!authLoading && authUser) {
      fetchRoster();
    }
  }, [authLoading, authUser, debouncedSearch, page, pageSize, statusFilter, sortBy, sortOrder]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const result = await apiClient.upload<{
        added: number;
        updated: number;
        rejected: number;
        invalidRows: Array<{ rowNumber: number; reason: string }>;
      }>("/api/admin/eligibility/upload", formData);

      setUploadResult(result);
      setPage(1);
      await fetchRoster(1);
    } catch (err: any) {
      setUploadError(err?.message || "Failed to process roster file");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Sort toggle handler
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
    setPage(1);
  };

  // Selection handlers
  const toggleSelectPrn = (prn: string) => {
    setSelectAllMatching(false);
    setSelectedPrns((prev) =>
      prev.includes(prn) ? prev.filter((p) => p !== prn) : [...prev, prn]
    );
  };

  const currentPagePrns = users.map((u) => u.prn);
  const allCurrentPageSelected =
    currentPagePrns.length > 0 &&
    currentPagePrns.every((prn) => selectedPrns.includes(prn));

  const toggleSelectCurrentPage = () => {
    setSelectAllMatching(false);
    if (allCurrentPageSelected) {
      setSelectedPrns((prev) => prev.filter((p) => !currentPagePrns.includes(p)));
    } else {
      setSelectedPrns((prev) => Array.from(new Set([...prev, ...currentPagePrns])));
    }
  };

  const handleSelectAllMatching = () => {
    setSelectAllMatching(true);
    // Include all currently visible PRNs
    setSelectedPrns(Array.from(new Set([...selectedPrns, ...currentPagePrns])));
  };

  const handleDeselectAll = () => {
    setSelectedPrns([]);
    setSelectAllMatching(false);
  };

  // Clear all eligibility records
  const handleClearAll = async () => {
    setDeleting(true);
    setActionError(null);
    try {
      await apiClient.delete("/api/admin/eligibility?clearAll=true");
      setSelectedPrns([]);
      setSelectAllMatching(false);
      setShowClearAllModal(false);
      setPage(1);
      await fetchRoster(1);
    } catch (err: any) {
      setActionError(err?.message || "Failed to clear eligibility roster");
    } finally {
      setDeleting(false);
    }
  };

  // Delete selected students
  const handleDeleteSelected = async () => {
    if (selectedPrns.length === 0 && !selectAllMatching) return;
    setDeleting(true);
    setActionError(null);
    try {
      if (selectAllMatching && statusFilter === "all" && !debouncedSearch) {
        // If selecting all in the entire roster
        await apiClient.delete("/api/admin/eligibility?clearAll=true");
      } else {
        await apiClient.delete("/api/admin/eligibility", { prns: selectedPrns });
      }
      setSelectedPrns([]);
      setSelectAllMatching(false);
      setShowDeleteSelectedModal(false);
      await fetchRoster();
    } catch (err: any) {
      setActionError(err?.message || "Failed to remove selected students");
    } finally {
      setDeleting(false);
    }
  };

  // Delete single student
  const handleDeleteSingle = async () => {
    if (!studentToDelete) return;
    setDeleting(true);
    setActionError(null);
    try {
      await apiClient.delete("/api/admin/eligibility", {
        prns: [studentToDelete.prn],
      });
      setSelectedPrns((prev) => prev.filter((p) => p !== studentToDelete.prn));
      setStudentToDelete(null);
      await fetchRoster();
    } catch (err: any) {
      setActionError(err?.message || "Failed to remove student");
    } finally {
      setDeleting(false);
    }
  };

  // Calculate slice indicators
  const effectivePageSize = pageSize === "all" ? filteredCount : pageSize;
  const startItem = filteredCount === 0 ? 0 : (page - 1) * effectivePageSize + 1;
  const endItem = Math.min(startItem + users.length - 1, filteredCount);

  // Pagination page numbers generation
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
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
                <Link
                  href="/admin"
                  className="text-xs text-ink-muted hover:text-ink transition-colors"
                >
                  ← Admin overview
                </Link>
              </div>
              <h1 className="text-2xl font-semibold text-ink">
                Eligibility roster
              </h1>
            </div>

            <div className="flex items-center gap-4 text-xs text-ink-muted">
              <span>
                Total students: <span className="text-ink font-semibold">{totalCount}</span>
              </span>
              <span>
                Claimed: <span className="text-pen font-semibold">{claimedCount}</span>
              </span>
            </div>
          </div>

          {/* Action error banner */}
          {actionError && (
            <div className="mb-6">
              <Notice variant="error" className="flex items-center justify-between">
                <span>{actionError}</span>
                <button
                  onClick={() => setActionError(null)}
                  className="underline cursor-pointer ml-3"
                >
                  Dismiss
                </button>
              </Notice>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mb-8">
            {/* Upload Box */}
            <Card className="lg:col-span-5 p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-ink mb-1">
                  Upload roster
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Accepts CSV or Excel (.xlsx) files with columns: prn, email, name.
                </p>
              </div>

              <div className="border-2 border-dashed border-line rounded-lg p-6 text-center hover:border-pen transition-colors bg-paper">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="roster-upload-input"
                  disabled={uploading}
                />
                <label
                  htmlFor="roster-upload-input"
                  className="cursor-pointer block space-y-2"
                >
                  <div className="text-sm font-semibold text-ink">
                    {uploading ? "Uploading..." : "Choose CSV or XLSX file"}
                  </div>
                  <div className="text-xs text-ink-muted">
                    Supports up to 500 rows per batch
                  </div>
                </label>
              </div>

              {uploadError && (
                <Notice variant="error">
                  {uploadError}
                </Notice>
              )}

              {uploadResult && (
                <div className="p-3 rounded-lg border border-line bg-paper text-xs space-y-2">
                  <div className="font-semibold text-ink">Upload results</div>
                  <div className="flex gap-4">
                    <span className="text-green">+{uploadResult.added} added</span>
                    <span className="text-ink">{uploadResult.updated} updated</span>
                    {uploadResult.rejected > 0 && (
                      <span className="text-red">{uploadResult.rejected} rejected</span>
                    )}
                  </div>
                  {uploadResult.invalidRows?.length > 0 && (
                    <div className="text-red space-y-0.5 pt-1">
                      {uploadResult.invalidRows.slice(0, 3).map((r, i) => (
                        <div key={i}>
                          Row {r.rowNumber}: {r.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Info Box */}
            <Card className="lg:col-span-7 p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-ink mb-1">
                  Roster access rules
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Student registration matches verified email addresses against this list. Each row can be claimed by one account.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="border border-line rounded-lg p-3 bg-paper">
                  <div className="text-xs text-ink-muted">Total students</div>
                  <div className="text-xl font-semibold text-ink mt-0.5 tabular-nums">{totalCount}</div>
                </div>
                <div className="border border-line rounded-lg p-3 bg-paper">
                  <div className="text-xs text-ink-muted">Unclaimed</div>
                  <div className="text-xl font-semibold text-ink-muted mt-0.5 tabular-nums">{unclaimedCount}</div>
                </div>
                <div className="border border-line rounded-lg p-3 bg-paper">
                  <div className="text-xs text-ink-muted">Claimed</div>
                  <div className="text-xl font-semibold text-pen mt-0.5 tabular-nums">{claimedCount}</div>
                </div>
              </div>
            </Card>
          </div>

          {/* Roster Table Section */}
          <Card className="overflow-hidden">
            {/* Top Toolbar */}
            <div className="p-4 sm:p-5 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="font-semibold text-base text-ink">
                  Current eligibility list
                </div>
                <Badge variant="neutral">
                  {filteredCount} {debouncedSearch || statusFilter !== "all" ? "matching" : "total"}
                </Badge>

                {/* Status Filter Tabs */}
                <div className="inline-flex rounded-lg border border-line bg-paper p-0.5 text-xs font-medium">
                  <button
                    onClick={() => {
                      setStatusFilter("all");
                      setPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      statusFilter === "all"
                        ? "bg-surface text-ink font-semibold shadow-xs"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    All ({totalCount})
                  </button>
                  <button
                    onClick={() => {
                      setStatusFilter("unclaimed");
                      setPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      statusFilter === "unclaimed"
                        ? "bg-surface text-ink font-semibold shadow-xs"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    Unclaimed ({unclaimedCount})
                  </button>
                  <button
                    onClick={() => {
                      setStatusFilter("claimed");
                      setPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      statusFilter === "claimed"
                        ? "bg-surface text-ink font-semibold shadow-xs"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    Claimed ({claimedCount})
                  </button>
                </div>
              </div>

              {/* Search & Actions */}
              <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Search PRN, name, email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-3 pr-8 py-1.5 rounded-lg border border-line bg-surface text-ink placeholder:text-ink-muted text-xs focus:outline-none focus:border-pen"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-2 text-ink-muted hover:text-ink text-xs cursor-pointer"
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {totalCount > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowClearAllModal(true)}
                    className="text-xs text-red hover:bg-red/5 shrink-0"
                  >
                    Clear all
                  </Button>
                )}
              </div>
            </div>

            {/* Selection Action Bar (when rows are checked) */}
            {selectedPrns.length > 0 && (
              <div className="bg-paper border-b border-line px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-ink">
                    {selectAllMatching
                      ? `All ${filteredCount} matching students selected`
                      : `${selectedPrns.length} student${selectedPrns.length > 1 ? "s" : ""} selected`}
                  </span>

                  {allCurrentPageSelected && !selectAllMatching && filteredCount > users.length && (
                    <button
                      onClick={handleSelectAllMatching}
                      className="text-pen font-semibold hover:underline cursor-pointer"
                    >
                      Select all {filteredCount} students matching current filter
                    </button>
                  )}

                  <button
                    onClick={handleDeselectAll}
                    className="text-ink-muted hover:text-ink hover:underline cursor-pointer"
                  >
                    Deselect all
                  </button>
                </div>

                <Button
                  size="sm"
                  onClick={() => setShowDeleteSelectedModal(true)}
                  className="bg-red hover:bg-[#b91c1c] text-white text-xs"
                >
                  Delete selected ({selectAllMatching ? filteredCount : selectedPrns.length})
                </Button>
              </div>
            )}

            {/* Table Area */}
            {loading ? (
              <div className="p-16 text-center text-xs text-ink-muted flex flex-col items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-line border-t-pen rounded-full animate-spin"></div>
                <span>Loading eligibility roster...</span>
              </div>
            ) : error ? (
              <div className="p-8 text-center text-sm text-red">{error}</div>
            ) : users.length === 0 ? (
              <div className="p-16 text-center text-xs text-ink-muted space-y-2">
                <div className="font-semibold text-ink text-sm">
                  {debouncedSearch
                    ? `No students matching "${debouncedSearch}"`
                    : statusFilter !== "all"
                    ? `No students found in "${statusFilter}" status`
                    : "No students in the eligibility roster"}
                </div>
                <p className="max-w-sm mx-auto text-ink-muted">
                  {debouncedSearch
                    ? "Try searching by student PRN, full name, or email address."
                    : "Upload a CSV or XLSX file above to grant student access."}
                </p>
                {debouncedSearch && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSearch("")}
                    className="mt-2 text-xs"
                  >
                    Clear search filter
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="bg-paper border-b border-line font-semibold text-ink-muted select-none">
                    <tr>
                      <th className="px-4 py-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={allCurrentPageSelected}
                          onChange={toggleSelectCurrentPage}
                          className="w-4 h-4 rounded border-line text-pen cursor-pointer accent-pen"
                          title="Select all on this page"
                        />
                      </th>
                      <th
                        className="px-4 py-3 cursor-pointer hover:text-ink transition-colors font-semibold"
                        onClick={() => handleSort("prn")}
                      >
                        <div className="flex items-center gap-1">
                          <span>PRN</span>
                          <span className="text-[10px] text-ink-muted">
                            {sortBy === "prn" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 cursor-pointer hover:text-ink transition-colors font-semibold"
                        onClick={() => handleSort("name")}
                      >
                        <div className="flex items-center gap-1">
                          <span>Student name</span>
                          <span className="text-[10px] text-ink-muted">
                            {sortBy === "name" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 cursor-pointer hover:text-ink transition-colors font-semibold"
                        onClick={() => handleSort("email")}
                      >
                        <div className="flex items-center gap-1">
                          <span>College email</span>
                          <span className="text-[10px] text-ink-muted">
                            {sortBy === "email" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 cursor-pointer hover:text-ink transition-colors font-semibold"
                        onClick={() => handleSort("status")}
                      >
                        <div className="flex items-center gap-1">
                          <span>Status</span>
                          <span className="text-[10px] text-ink-muted">
                            {sortBy === "status" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </div>
                      </th>
                      <th className="px-4 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {users.map((u) => {
                      const isSelected = selectedPrns.includes(u.prn);
                      return (
                        <tr
                          key={u.prn}
                          className={`hover:bg-paper/50 transition-colors ${
                            isSelected ? "bg-pen-wash/30" : ""
                          }`}
                        >
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectPrn(u.prn)}
                              className="w-4 h-4 rounded border-line text-pen cursor-pointer accent-pen"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-ink tabular-nums">
                            {u.prn}
                          </td>
                          <td className="px-4 py-3 text-ink">
                            {u.name}
                          </td>
                          <td className="px-4 py-3 text-ink-muted">
                            {u.email}
                          </td>
                          <td className="px-4 py-3">
                            {u.claimedByUid ? (
                              <Badge variant="open" dot>Claimed</Badge>
                            ) : (
                              <Badge variant="default">Unclaimed</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => setStudentToDelete(u)}
                              className="text-red hover:underline font-medium cursor-pointer"
                              title={`Remove ${u.name}`}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls Bar */}
            {!loading && users.length > 0 && (
              <div className="p-4 border-t border-line bg-paper flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
                {/* Count and rows per page */}
                <div className="flex items-center gap-4 text-ink-muted flex-wrap">
                  <span>
                    Showing <span className="text-ink font-medium">{startItem}</span>–
                    <span className="text-ink font-medium">{endItem}</span> of{" "}
                    <span className="text-ink font-medium">{filteredCount}</span> students
                  </span>

                  <div className="flex items-center gap-2">
                    <span>Rows per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        const val = e.target.value === "all" ? "all" : Number(e.target.value);
                        setPageSize(val);
                        setPage(1);
                      }}
                      className="bg-surface border border-line rounded px-2 py-1 text-ink text-xs focus:outline-none focus:border-pen cursor-pointer"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                      <option value="all">All</option>
                    </select>
                  </div>
                </div>

                {/* Page Navigation Buttons */}
                {pageSize !== "all" && totalPages > 1 && (
                  <div className="flex items-center gap-1 select-none">
                    <button
                      onClick={() => setPage(1)}
                      disabled={page <= 1}
                      className="px-2 py-1 rounded border border-line bg-surface text-ink hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="First page"
                    >
                      «
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="px-2 py-1 rounded border border-line bg-surface text-ink hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Previous page"
                    >
                      ‹
                    </button>

                    {getPageNumbers().map((pNum, idx) => {
                      if (pNum === "...") {
                        return (
                          <span
                            key={`dots-${idx}`}
                            className="px-1 text-ink-muted text-xs"
                          >
                            ...
                          </span>
                        );
                      }
                      const isCurrent = pNum === page;
                      return (
                        <button
                          key={`page-${pNum}`}
                          onClick={() => setPage(Number(pNum))}
                          className={`min-w-6 px-2 py-1 rounded text-xs transition-colors ${
                            isCurrent
                              ? "bg-pen text-white font-semibold"
                              : "border border-line bg-surface text-ink hover:bg-paper"
                          }`}
                        >
                          {pNum}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="px-2 py-1 rounded border border-line bg-surface text-ink hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Next page"
                    >
                      ›
                    </button>
                    <button
                      onClick={() => setPage(totalPages)}
                      disabled={page >= totalPages}
                      className="px-2 py-1 rounded border border-line bg-surface text-ink hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Last page"
                    >
                      »
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </main>

        {/* Clear All Confirmation Modal */}
        {showClearAllModal && (
          <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-6">
            <Card className="max-w-md w-full p-6 sm:p-8 space-y-4">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-ink">
                  Clear entire eligibility list?
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  This will delete all <span className="text-ink font-semibold">{totalCount}</span> student records from the whitelist. Students who haven&apos;t claimed their account will no longer be able to log in.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowClearAllModal(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red hover:bg-[#b91c1c] text-white"
                  onClick={handleClearAll}
                  loading={deleting}
                >
                  Clear all
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Delete Selected Modal */}
        {showDeleteSelectedModal && (
          <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-6">
            <Card className="max-w-md w-full p-6 sm:p-8 space-y-4">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-ink">
                  Remove selected students?
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Are you sure you want to remove{" "}
                  <span className="text-ink font-semibold">
                    {selectAllMatching ? filteredCount : selectedPrns.length}
                  </span>{" "}
                  selected student(s) from the whitelist?
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowDeleteSelectedModal(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red hover:bg-[#b91c1c] text-white"
                  onClick={handleDeleteSelected}
                  loading={deleting}
                >
                  Delete ({selectAllMatching ? filteredCount : selectedPrns.length})
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Delete Single Student Modal */}
        {studentToDelete && (
          <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-6">
            <Card className="max-w-md w-full p-6 sm:p-8 space-y-4">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-ink">
                  Remove student from whitelist?
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Remove <span className="text-ink font-semibold">{studentToDelete.name}</span> ({studentToDelete.prn}) from the whitelist?
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setStudentToDelete(null)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red hover:bg-[#b91c1c] text-white"
                  onClick={handleDeleteSingle}
                  loading={deleting}
                >
                  Remove
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
