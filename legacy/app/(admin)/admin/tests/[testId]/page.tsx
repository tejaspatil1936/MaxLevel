"use client";

import React, { useEffect, useState, use, useRef } from "react";
import Link from "next/link";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { Navbar } from "@/components/ui/Navbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Badge } from "@/components/ui/Badge";
import { apiClient } from "@/lib/apiClient";
import { Test, Question } from "@/types";

export default function TestEditPage({
  params,
}: {
  params: Promise<{ testId: string }>;
}) {
  const { testId } = use(params);

  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<Array<Question & { correctIndex: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [day, setDay] = useState(1);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [date, setDate] = useState("");
  const [hasWindowOverride, setHasWindowOverride] = useState(false);
  const [overrideStart, setOverrideStart] = useState("07:00");
  const [overrideEnd, setOverrideEnd] = useState("15:00");
  const [hasDurationOverride, setHasDurationOverride] = useState(false);
  const [overrideDuration, setOverrideDuration] = useState("30");
  const [resultsVisibleSetting, setResultsVisibleSetting] = useState<"inherit" | "show" | "hide">("inherit");
  const [secondaryCameraSetting, setSecondaryCameraSetting] = useState<"inherit" | "required" | "disabled">("inherit");

  const [savingTest, setSavingTest] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Question Upload State
  const [jsonText, setJsonText] = useState("");
  const [uploadingQuestions, setUploadingQuestions] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [questionSuccess, setQuestionSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTestData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [testRes, qRes] = await Promise.all([
        apiClient.get<{ test: Test }>(`/api/admin/tests/${testId}`),
        apiClient.get<{
          hasQuestions: boolean;
          questionCount: number;
          questions: Array<Question & { correctIndex: number }>;
        }>(`/api/admin/tests/${testId}/questions`),
      ]);

      const t = testRes.test;
      setTest(t);
      setDay(t.day);
      setTitle(t.title);
      setCompany(t.company);
      setDate(t.date);

      if (t.window) {
        setHasWindowOverride(true);
        setOverrideStart(t.window.start);
        setOverrideEnd(t.window.end);
      } else {
        setHasWindowOverride(false);
      }

      if (t.durationMin !== null && t.durationMin !== undefined) {
        setHasDurationOverride(true);
        setOverrideDuration(String(t.durationMin));
      } else {
        setHasDurationOverride(false);
      }

      if (t.resultsVisible === true) {
        setResultsVisibleSetting("show");
      } else if (t.resultsVisible === false) {
        setResultsVisibleSetting("hide");
      } else {
        setResultsVisibleSetting("inherit");
      }

      if (t.secondaryCameraRequired === true) {
        setSecondaryCameraSetting("required");
      } else if (t.secondaryCameraRequired === false) {
        setSecondaryCameraSetting("disabled");
      } else {
        setSecondaryCameraSetting("inherit");
      }

      setQuestions(qRes.questions || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load test details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTestData();
  }, [testId]);

  const handleSaveTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTest(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const resultsVisible =
        resultsVisibleSetting === "inherit"
          ? null
          : resultsVisibleSetting === "show"
          ? true
          : false;

      const secondaryCameraRequired =
        secondaryCameraSetting === "inherit"
          ? null
          : secondaryCameraSetting === "required"
          ? true
          : false;

      const payload: any = {
        day: parseInt(String(day), 10) || 1,
        title: title.trim(),
        company: company.trim(),
        date,
        window: hasWindowOverride
          ? { start: overrideStart.trim(), end: overrideEnd.trim() }
          : null,
        durationMin: hasDurationOverride ? parseInt(overrideDuration, 10) : null,
        resultsVisible,
        secondaryCameraRequired,
      };

      const res = await apiClient.put<{ test: Test }>(
        `/api/admin/tests/${testId}`,
        payload
      );
      setTest(res.test);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to update test settings");
    } finally {
      setSavingTest(false);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingQuestions(true);
    setQuestionError(null);
    setQuestionSuccess(null);

    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Uploaded file is not a valid JSON document.");
      }

      const res = await apiClient.post<{ message: string; questionCount: number }>(
        `/api/admin/tests/${testId}/questions`,
        parsed
      );

      setQuestionSuccess(res.message);
      await fetchTestData();
    } catch (err: any) {
      setQuestionError(err?.message || "Failed to upload question set.");
    } finally {
      setUploadingQuestions(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handlePasteUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jsonText.trim()) return;

    setUploadingQuestions(true);
    setQuestionError(null);
    setQuestionSuccess(null);

    try {
      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new Error("Pasted text is not valid JSON. Check syntax.");
      }

      const res = await apiClient.post<{ message: string; questionCount: number }>(
        `/api/admin/tests/${testId}/questions`,
        parsed
      );

      setQuestionSuccess(res.message);
      setJsonText("");
      await fetchTestData();
    } catch (err: any) {
      setQuestionError(err?.message || "Failed to upload question set.");
    } finally {
      setUploadingQuestions(false);
    }
  };

  if (loading) {
    return (
      <AdminGuard>
        <div className="min-h-screen bg-paper flex flex-col">
          <Navbar />
          <div className="flex-1 flex items-center justify-center p-6 text-sm text-ink-muted">
            Loading test information...
          </div>
        </div>
      </AdminGuard>
    );
  }

  if (error || !test) {
    return (
      <AdminGuard>
        <div className="min-h-screen bg-paper flex flex-col">
          <Navbar />
          <div className="flex-1 max-w-4xl mx-auto p-6">
            <div className="p-6 bg-surface border border-red/30 rounded-xl text-red">
              {error || "Test not found"}
            </div>
          </div>
        </div>
      </AdminGuard>
    );
  }

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
                  href={`/admin/series/${test.seriesId}`}
                  className="text-xs text-ink-muted hover:text-ink transition-colors"
                >
                  ← Back to series
                </Link>
                <span className="text-xs text-ink-muted">•</span>
                <span className="text-xs text-ink-muted">
                  Day {test.day}
                </span>
              </div>
              <h1 className="text-2xl font-semibold text-ink">
                {test.title}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/admin/tests/${testId}/attempts`}>
                <Button variant="secondary" size="sm">
                  View attempts & logs
                </Button>
              </Link>
              {test.hasQuestions ? (
                <Badge variant="open" dot>{test.questionCount} questions live</Badge>
              ) : (
                <Badge variant="default">No questions uploaded</Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Test Configuration Form */}
            <Card className="lg:col-span-5 p-6 space-y-5">
              <div className="border-b border-line pb-3">
                <h2 className="text-base font-semibold text-ink">
                  Test settings
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Company specifics and test timing overrides
                </p>
              </div>

              {saveError && (
                <Notice variant="error">
                  {saveError}
                </Notice>
              )}
              {saveSuccess && (
                <Notice variant="default">
                  Test details saved.
                </Notice>
              )}

              <form onSubmit={handleSaveTest} className="space-y-4">
                <Input
                  label="Test title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />

                <Input
                  label="Target company"
                  placeholder="e.g. TCS (Ninja / Digital)"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Day number"
                    type="number"
                    min="1"
                    max="30"
                    value={day}
                    onChange={(e) => setDay(parseInt(e.target.value, 10) || 1)}
                    required
                  />
                  <Input
                    label="Scheduled date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>

                {/* Window Override */}
                <div className="border border-line rounded-lg p-3 bg-paper space-y-2">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hasWindowOverride}
                      onChange={(e) => setHasWindowOverride(e.target.checked)}
                      className="w-4 h-4 rounded border-line text-pen"
                    />
                    <span className="text-xs font-semibold text-ink">
                      Override series window
                    </span>
                  </label>

                  {hasWindowOverride && (
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <Input
                        label="Start time"
                        type="time"
                        value={overrideStart}
                        onChange={(e) => setOverrideStart(e.target.value)}
                        required
                      />
                      <Input
                        label="End time"
                        type="time"
                        value={overrideEnd}
                        onChange={(e) => setOverrideEnd(e.target.value)}
                        required
                      />
                    </div>
                  )}
                </div>

                {/* Duration Override */}
                <div className="border border-line rounded-lg p-3 bg-paper space-y-2">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hasDurationOverride}
                      onChange={(e) => setHasDurationOverride(e.target.checked)}
                      className="w-4 h-4 rounded border-line text-pen"
                    />
                    <span className="text-xs font-semibold text-ink">
                      Override test duration
                    </span>
                  </label>

                  {hasDurationOverride && (
                    <div className="pt-2">
                      <Input
                        label="Duration in minutes"
                        type="number"
                        min="5"
                        max="180"
                        value={overrideDuration}
                        onChange={(e) => setOverrideDuration(e.target.value)}
                        required
                      />
                    </div>
                  )}
                </div>

                {/* Results Visibility Override (inherit / show / hide) */}
                <div className="border border-line rounded-lg p-3 bg-paper space-y-1.5">
                  <label className="block text-xs font-semibold text-ink">
                    Per-test answers & solutions visibility
                  </label>
                  <p className="text-xs text-ink-muted">
                    Controls when students who completed the test can view answers and explanations
                  </p>
                  <select
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-line bg-surface text-ink text-xs font-sans"
                    value={resultsVisibleSetting}
                    onChange={(e) =>
                      setResultsVisibleSetting(
                        e.target.value as "inherit" | "show" | "hide"
                      )
                    }
                  >
                    <option value="inherit">Auto-release after window closes (Default)</option>
                    <option value="show">Show results immediately (Force released)</option>
                    <option value="hide">Hide results (Force locked)</option>
                  </select>
                </div>

                {/* Secondary Mobile Camera Requirement */}
                <div className="border border-line rounded-lg p-3.5 bg-paper space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-semibold text-ink">
                        Secondary Phone Proctoring (Desk View)
                      </label>
                      <p className="text-xs text-ink-muted">
                        Require students to pair their smartphone camera at 45° to monitor desk & hands
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded border ${
                        secondaryCameraSetting === "disabled"
                          ? "bg-ink/5 border-line text-ink-muted"
                          : "bg-pen/10 border-pen/20 text-pen font-bold"
                      }`}
                    >
                      {secondaryCameraSetting === "required"
                        ? "Active (Forced On)"
                        : secondaryCameraSetting === "disabled"
                        ? "Disabled (Off)"
                        : "Inherit (Default: Active)"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setSecondaryCameraSetting("inherit")}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all text-center cursor-pointer ${
                        secondaryCameraSetting === "inherit"
                          ? "bg-pen text-paper border-pen shadow-xs"
                          : "bg-surface text-ink border-line hover:border-ink/30"
                      }`}
                    >
                      Inherit (Default)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSecondaryCameraSetting("required")}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all text-center cursor-pointer ${
                        secondaryCameraSetting === "required"
                          ? "bg-pen text-paper border-pen shadow-xs"
                          : "bg-surface text-ink border-line hover:border-ink/30"
                      }`}
                    >
                      Active (Force On)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSecondaryCameraSetting("disabled")}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all text-center cursor-pointer ${
                        secondaryCameraSetting === "disabled"
                          ? "bg-ink text-paper border-ink shadow-xs"
                          : "bg-surface text-ink border-line hover:border-ink/30"
                      }`}
                    >
                      Turn Off
                    </button>
                  </div>
                  <p className="text-[11px] text-ink-muted leading-relaxed">
                    {secondaryCameraSetting === "disabled"
                      ? "When turned off, students will NOT see the Dual-Device Overview, video demonstration, or phone pairing box on the rules screen (webcam only)."
                      : "When active, candidates must scan the QR code and position their phone at 45° before the exam unlocks."}
                  </p>
                </div>

                <div className="pt-2">
                  <Button type="submit" className="w-full" loading={savingTest}>
                    Update test
                  </Button>
                </div>
              </form>
            </Card>

            {/* Right Column: Question JSON Upload & Preview */}
            <div className="lg:col-span-7 space-y-6">
              {/* Question Upload Box */}
              <Card className="p-6 space-y-5">
                <div className="border-b border-line pb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-ink">
                      Question set upload
                    </h2>
                    <p className="text-xs text-ink-muted mt-0.5">
                      Validates questions and separates answer keys securely
                    </p>
                  </div>
                  <Badge variant="neutral">
                    JSON schema
                  </Badge>
                </div>

                {questionError && (
                  <Notice variant="error">
                    {questionError}
                  </Notice>
                )}

                {questionSuccess && (
                  <Notice variant="default">
                    {questionSuccess}
                  </Notice>
                )}

                {/* File Upload Dropzone */}
                <div className="border-2 border-dashed border-line rounded-lg p-6 text-center hover:border-pen transition-colors bg-paper">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleUploadFile}
                    className="hidden"
                    id="questions-file-input"
                    disabled={uploadingQuestions}
                  />
                  <label
                    htmlFor="questions-file-input"
                    className="cursor-pointer block space-y-2"
                  >
                    <div className="text-sm font-semibold text-ink">
                      {uploadingQuestions ? "Uploading questions..." : "Upload questions.json file"}
                    </div>
                    <div className="text-xs text-ink-muted">
                      Sample template: /samples/day1-questions.json
                    </div>
                  </label>
                </div>

                {/* Or paste JSON */}
                <form onSubmit={handlePasteUpload} className="space-y-3">
                  <div className="text-xs text-ink-muted font-medium">
                    Or paste question JSON directly:
                  </div>
                  <textarea
                    rows={6}
                    placeholder='{ "questions": [ { "id": "q1", "text": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0 } ] }'
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    className="w-full p-3 rounded-lg border border-line bg-paper text-ink font-mono text-xs focus:outline-none focus:border-pen"
                    disabled={uploadingQuestions}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={!jsonText.trim() || uploadingQuestions}
                      loading={uploadingQuestions}
                    >
                      Validate and import JSON
                    </Button>
                  </div>
                </form>
              </Card>

              {/* Uploaded Questions Preview */}
              {questions.length > 0 && (
                <Card className="p-6 space-y-4">
                  <div className="border-b border-line pb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-ink">
                        Uploaded questions ({questions.length})
                      </h3>
                      <p className="text-xs text-ink-muted">
                        Test ID: {test.id}
                      </p>
                    </div>
                    <Badge variant="open" dot>
                      Validated
                    </Badge>
                  </div>

                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {questions.map((q, idx) => (
                      <div
                        key={q.id}
                        className="p-3.5 rounded-lg border border-line bg-paper space-y-2.5 text-xs"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-semibold text-ink text-sm">
                            {idx + 1}. {q.text}
                          </span>
                          <span className="text-xs text-ink-muted bg-surface border border-line px-2 py-0.5 rounded">
                            {q.id}
                          </span>
                        </div>

                        {/* Choice preview */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {q.options.map((opt, optIdx) => {
                            const isCorrect = q.correctIndex === optIdx;
                            return (
                              <div
                                key={optIdx}
                                className={`flex items-center gap-2 p-2 rounded-lg border ${
                                  isCorrect
                                    ? "border-green/40 bg-surface text-ink font-medium"
                                    : "border-line bg-surface text-ink-muted"
                                }`}
                              >
                                <span
                                  className={`w-5 h-5 rounded-full border text-xs font-semibold flex items-center justify-center shrink-0 ${
                                    isCorrect
                                      ? "bg-green text-white border-green"
                                      : "border-line text-ink-muted"
                                  }`}
                                >
                                  {["A", "B", "C", "D"][optIdx]}
                                </span>
                                <span className="truncate">{opt}</span>
                              </div>
                            );
                          })}
                        </div>

                        {q.topic && (
                          <div className="text-xs text-ink-muted">
                            Topic: {q.topic} {q.source ? `• Source: ${q.source}` : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </main>
      </div>
    </AdminGuard>
  );
}
