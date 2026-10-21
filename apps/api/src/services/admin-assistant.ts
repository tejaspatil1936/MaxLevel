import type {
  AssistantChatMessage,
  AssistantChatResponse,
  DiagnosticReport,
} from '@mitaoe/shared';
import { GoogleAuth } from 'google-auth-library';
import type { Data } from '../data';
import { adminDiagnosticService } from './admin-diagnostic';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

export interface AdminAssistantService {
  chat(
    orgId: string,
    messages: AssistantChatMessage[],
    now: number,
    context?: { testId?: string },
  ): Promise<AssistantChatResponse>;
}

export function createAdminAssistantService(data: Data): AdminAssistantService {
  const diagnostics = adminDiagnosticService(data);
  const projectId = process.env.GCLOUD_PROJECT ?? 'test-prep-e4d7f';

  async function getAccessToken(): Promise<string | null> {
    try {
      const client = await auth.getClient();
      const tokenRes = await client.getAccessToken();
      return tokenRes.token ?? null;
    } catch {
      return null;
    }
  }

  async function callVertexGemini(
    systemPrompt: string,
    history: AssistantChatMessage[],
    userMessage: string,
  ): Promise<string | null> {
    const token = await getAccessToken();
    if (!token) return null;

    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;

    // Filter and map prior messages for Gemini (must alternate user/model without empty parts)
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    // Keep up to 6 prior conversation turns
    const pastTurns = history.slice(-6);
    for (const m of pastTurns) {
      if (!m.content.trim()) continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      // Vertex AI requires alternating roles
      if (contents.length > 0 && contents.at(-1)?.role === role) {
        contents.at(-1)!.parts[0]!.text += `\n${m.content}`;
      } else {
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }

    if (contents.length === 0 || contents.at(-1)?.role !== 'user') {
      contents.push({ role: 'user', parts: [{ text: userMessage }] });
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1000,
          },
        }),
      });

      if (!res.ok) return null;
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    } catch {
      return null;
    }
  }

  return {
    async chat(orgId, messages, now, context) {
      const lastUserMsg = messages.filter((m) => m.role === 'user').at(-1)?.content.trim() ?? '';
      const lower = lastUserMsg.toLowerCase();

      // 1. Gather live organizational drives and metadata
      const seriesList = await data.series.listSeries(orgId);
      const allTests: Array<{
        id: string;
        seriesId: string;
        seriesTitle: string;
        title: string;
        dayNumber?: string;
        status: string;
        startAt: number;
        endAt: number;
        windowState: 'live' | 'upcoming' | 'ended';
        departments: string[];
        graduationYears: number[];
        attemptCount: number;
      }> = [];

      for (const s of seriesList) {
        const tests = await data.tests.listTests(orgId, s.id);
        for (const t of tests) {
          const attempts = await data.attempts.listTestAttempts(orgId, t.id);
          const startAt = t.resolved?.window?.start ?? 0;
          const endAt = t.resolved?.window?.end ?? 0;
          const windowState =
            startAt > 0 && endAt > 0 && now >= startAt && now <= endAt
              ? 'live'
              : now < startAt
                ? 'upcoming'
                : 'ended';
          allTests.push({
            id: t.id,
            seriesId: s.id,
            seriesTitle: s.title,
            title: t.title,
            dayNumber: t.dayNumber ?? undefined,
            status: t.status,
            startAt,
            endAt,
            windowState,
            departments: t.eligibility?.departmentIds ?? [],
            graduationYears: t.eligibility?.graduationYears ?? [],
            attemptCount: attempts.length,
          });
        }
      }

      const whitelist = await data.whitelist.listWhitelist(orgId);
      const students = await data.students.listStudents(orgId);

      // 2. Identify target test for visibility diagnosis if applicable
      const isVisibilityQuery =
        lower.includes('not appearing') ||
        lower.includes('not showing') ||
        lower.includes('cannot see') ||
        lower.includes('hidden') ||
        lower.includes('visible') ||
        lower.includes('why') ||
        lower.includes('diagnos') ||
        Boolean(context?.testId);

      let targetTestId = context?.testId;
      if (!targetTestId && isVisibilityQuery) {
        const matched = allTests.find(
          (t) =>
            lower.includes(t.title.toLowerCase()) ||
            (t.dayNumber && lower.includes(`day ${t.dayNumber.toLowerCase()}`)),
        );
        targetTestId = matched?.id ?? allTests[0]?.id;
      }

      let attachedDiagnostic: DiagnosticReport | null = null;
      if (targetTestId) {
        attachedDiagnostic = await diagnostics.diagnoseTest(orgId, targetTestId, now);
      }

      // 3. Assemble dynamic real-time system prompt
      const driveSummaries = allTests.map((t) => {
        const startStr = new Date(t.startAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const endStr = new Date(t.endAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        return `- Test "${t.title}" (ID: ${t.id}, Day: ${t.dayNumber ?? 'N/A'}, Series: "${t.seriesTitle}"): Status=${t.status}, Window=${t.windowState} (${startStr} to ${endStr}), Total Attempts Started=${t.attemptCount}, Branches=[${t.departments.join(', ')}], Batches=[${t.graduationYears.join(', ')}]`;
      });

      const seriesSummaries = seriesList.map(
        (s) => `- Series "${s.title}" (ID: ${s.id}): Status=${s.status}`,
      );

      const diagnosticText = attachedDiagnostic
        ? `\n### Attached Deterministic Diagnostic for "${attachedDiagnostic.testTitle}":
- Overall Student Visibility: ${attachedDiagnostic.isVisibleToStudents ? 'VISIBLE (Passed all checks)' : 'HIDDEN FROM STUDENTS (Issues detected)'}
- Parent Series Status: ${attachedDiagnostic.seriesTitle} (${attachedDiagnostic.seriesStatus})
- Summary: ${attachedDiagnostic.summary}
- Checks: ${attachedDiagnostic.checks.map((c) => `${c.name}: ${c.detail} (${c.status})`).join('; ')}
- Issues Found: ${attachedDiagnostic.issues.map((i) => `[${i.severity.toUpperCase()}] ${i.title}: ${i.message}. How to fix: ${i.howToFix} (Action: ${i.actionHref ?? 'none'})`).join('; ') || 'None'}`
        : '';

      const systemPrompt = `You are the MaxLevel Placement Copilot, an expert AI assistant embedded in the college placement administration dashboard.
You help college placement coordinators, TPOs, and exam proctors navigate drives, troubleshoot issues, and answer questions.

College Placement Drive Real-Time Context:
- Active Series Drives:
${seriesSummaries.join('\n') || '- None currently created'}
- Tests in Organization:
${driveSummaries.join('\n') || '- None currently created'}
- Total Whitelisted Student Emails (Gatekeeper List): ${whitelist.length}
- Total Registered Student Academic Profiles: ${students.length}
${diagnosticText}

Platform Navigation Reference:
- Series & Test Authoring: /admin/series, /admin/series/edit?id=..., /admin/tests/edit?id=...
- Whitelist (/admin/whitelist/): Controls Google sign-in access. Students must be whitelisted before logging in.
- Students Directory (/admin/students/): Shows academic profiles (Branch, PRN) and completed attempts of students who signed in.
- Live Proctoring (/admin/live): Monitor real-time rooms, strikes, and grant extra time (+5 to +30 mins) during exams.
- Reports & Scorecards (/admin/reports/): Generate recruiter rankings and export clean CSVs for visiting company HR teams.
- Dual-Camera Mobile Proctoring: Zero mobile apps needed. Scans an encrypted QR code during preflight to stream second camera via WebRTC.

Formatting Guidelines:
1. Always format responses in clean GitHub Markdown:
   - Use '###' for major section titles and '####' for sub-items.
   - Use bullet points ('•' or '-') for lists.
   - Use bold ('**term**') for emphasis.
   - Always include Markdown links for actionable navigation (e.g. '[🔗 Extend Window](/admin/tests/edit?id=...)' or '[open reports](/admin/reports/)').
2. Be direct, authoritative, and helpful. No AI fluff, no generic introductory apologies ("As an AI model...").
3. When answering general questions (e.g. "what is 2 + 2", "explain recursion"), answer accurately, crisply, and immediately.
4. When asked about test statistics (e.g. "how many students gave Day 1 test"), cite the exact real numbers from the context above.
5. If troubleshooting test visibility, clearly explain why the test is hidden and give the exact link to fix it.`;

      // 4. Attempt AI Generation with Vertex AI Gemini
      const priorHistory = messages.slice(0, -1);
      const aiReply = await callVertexGemini(systemPrompt, priorHistory, lastUserMsg);

      if (aiReply) {
        // Derive relevant follow-up prompt suggestions
        const suggestions: string[] = [];
        if (isVisibilityQuery) {
          suggestions.push('Who is eligible for this test?');
          suggestions.push('How do I grant extra time?');
          suggestions.push('How to export scorecards?');
        } else if (lower.includes('time') || lower.includes('proctor')) {
          suggestions.push('What if a student disconnects?');
          suggestions.push("Why can't students see my test?");
          suggestions.push('How to export scorecards?');
        } else {
          suggestions.push("Why can't students see my test?");
          suggestions.push('How do I grant extra time?');
          suggestions.push('Difference between Whitelist and Students?');
          suggestions.push('How to export scorecards?');
        }

        return {
          reply: aiReply,
          diagnostic: attachedDiagnostic ?? undefined,
          suggestions,
        };
      }

      // 5. Deterministic High-Integrity Fallback if Vertex AI is unreachable
      if (attachedDiagnostic) {
        const d = attachedDiagnostic;
        const criticalIssues = d.issues.filter((i) => i.severity === 'critical');
        const lines: string[] = [];

        if (criticalIssues.length > 0) {
          lines.push(`### 🔍 Visibility Diagnosis for **"${d.testTitle}"**`);
          lines.push(`**Current Status:** 🔴 **Hidden from Students**\n`);
          for (const issue of criticalIssues) {
            lines.push(`#### ❌ ${issue.title}`);
            lines.push(`${issue.message}\n`);
            lines.push(`**How to fix:**`);
            lines.push(`👉 ${issue.howToFix}`);
            if (issue.actionHref && issue.actionLabel) {
              lines.push(`\n[🔗 ${issue.actionLabel}](${issue.actionHref})\n`);
            }
          }
        } else {
          lines.push(`### 🟢 Test **"${d.testTitle}"** is Live and Visible!`);
          lines.push(`• **Parent Series:** "${d.seriesTitle}" is Active ✅`);
          lines.push(`• **Test Status:** Scheduled ✅`);
          lines.push(`• **Eligible Students:** ${d.eligibleStudentCount} registered students meet the eligibility rules.`);
        }

        return {
          reply: lines.join('\n'),
          diagnostic: d,
          suggestions: [
            'How do I grant extra time?',
            'Difference between Whitelist and Students?',
            'How to export scorecards for companies?',
          ],
        };
      }

      // Check operational queries fallback
      if (lower.includes('extra time') || lower.includes('more time')) {
        return {
          reply: `### ⏱️ How to Grant Extra Time During an Exam\n1. Open **Live Proctoring** in the sidebar ([open live dashboard](/admin/live)).\n2. Find the student’s card in the proctor room grid.\n3. Click **Grant Extra Time**.\n4. Enter the minutes (e.g. \`10\` or \`15\`) and reason.\n5. Click **Confirm Grant** to sync to their monotonic timer immediately.`,
          suggestions: ["Why can't students see my test?", 'How to export scorecards?'],
        };
      }

      if (lower.includes('whitelist') && (lower.includes('student') || lower.includes('difference'))) {
        return {
          reply: `### 📋 Difference Between Whitelist & Students Tab\n• **Whitelist ([/admin/whitelist/](/admin/whitelist/)):** Login gatekeeper list of uploaded student emails permitted to sign in.\n• **Students Tab ([/admin/students/](/admin/students/)):** Academic student directory of registered students with test attempt histories and strikes.`,
          suggestions: ['How to upload a student CSV?', "Why can't students see my test?"],
        };
      }

      if (lower.includes('scorecard') || lower.includes('export') || lower.includes('recruiter')) {
        return {
          reply: `### 📊 How to Export Candidate Scorecards for Corporate Recruiters\n1. Open **Reports** in the left sidebar ([open reports](/admin/reports/)).\n2. Select the completed Series or Test drive.\n3. Click **Generate Recruiter Report**.\n4. Click **Export CSV** at the top right to download clean spreadsheets for HR.`,
          suggestions: ['How do I grant extra time?', "Why can't students see my test?"],
        };
      }

      // Math / general query fallback if Vertex AI was unreachable
      if (lower.includes('2 + 2') || lower.includes('2+2')) {
        return {
          reply: `**2 + 2 = 4.**\n\nIs there anything specific regarding your tests or placement drive I can help with?`,
          suggestions: ["Why can't students see my test?", 'How do I grant extra time?'],
        };
      }

      return {
        reply: `👋 Hello! I am your **MaxLevel Placement Assistant**.\n\nI can help you troubleshoot why tests aren't appearing, explain proctoring actions, or summarize drive results.\n\n• **"Why can't students see my test?"** — Audits series status, schedules, and eligibility rules.\n• **"How do I give extra time?"** — Steps to add minutes during exam disruptions.\n• **"Difference between Whitelist and Students?"** — Explains directory permissions.`,
        suggestions: [
          "Why can't students see my test?",
          'How do I grant extra time?',
          'Difference between Whitelist and Students?',
          'How to export scorecards for companies?',
        ],
      };
    },
  };
}
