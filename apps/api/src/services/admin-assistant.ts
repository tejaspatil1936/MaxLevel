import {
  assistantActionProposalSchema,
  type AssistantActionProposal,
  type AssistantChatMessage,
  type AssistantChatResponse,
  type DiagnosticReport,
} from '@mitaoe/shared';
import { GoogleAuth } from 'google-auth-library';
import type { Data } from '../data';
import { adminDiagnosticService } from './admin-diagnostic';
import type { EntitlementsService } from './entitlements';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

export interface AdminAssistantService {
  chat(
    orgId: string,
    messages: AssistantChatMessage[],
    now: number,
    context?: { testId?: string; seriesId?: string },
  ): Promise<AssistantChatResponse>;
}

function formatMinutesToTime(totalMinutes: number): string {
  const clamped = Math.min(Math.max(totalMinutes, 0), 1440);
  const h24 = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${h12}:${mm} ${ampm}`;
}

function parseTimingDetails(text: string): {
  dailyWindow?: { startMinutes: number; endMinutes: number };
  durationMin: number;
  days: number;
} {
  let dailyWindow: { startMinutes: number; endMinutes: number } | undefined;
  // Match e.g. "from 10 am to 5 pm", "10am to 5pm", "10:00 to 17:00"
  const windowMatch = text.match(
    /(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (windowMatch) {
    let startH = parseInt(windowMatch[1]!, 10);
    const startM = windowMatch[2] ? parseInt(windowMatch[2], 10) : 0;
    const startAmpm = windowMatch[3]?.toLowerCase();

    let endH = parseInt(windowMatch[4]!, 10);
    const endM = windowMatch[5] ? parseInt(windowMatch[5], 10) : 0;
    const endAmpm = windowMatch[6]?.toLowerCase();

    if (startAmpm === 'pm' && startH < 12) startH += 12;
    if (startAmpm === 'am' && startH === 12) startH = 0;

    if (endAmpm === 'pm' && endH < 12) endH += 12;
    if (endAmpm === 'am' && endH === 12) endH = 0;

    // Handle omitted start am/pm when end is pm (e.g. "from 10 to 5 pm")
    if (!startAmpm && endAmpm === 'pm' && startH < 12 && startH > endH) {
      // 10 is AM, 5 is PM
    }

    const startMinutes = Math.min(Math.max(startH * 60 + startM, 0), 1439);
    const endMinutes = Math.min(Math.max(endH * 60 + endM, startMinutes + 1), 1440);
    dailyWindow = { startMinutes, endMinutes };
  }

  // Duration: e.g. "30 min", "30 minutes", "1 hour"
  let durationMin = 60;
  const durMatch = text.match(/(\d+)\s*(?:min|minute|minutes|hr|hour|hours)/i);
  if (durMatch) {
    const val = parseInt(durMatch[1]!, 10);
    if (/hr|hour/i.test(durMatch[0])) {
      durationMin = val * 60;
    } else {
      durationMin = val;
    }
  }

  // Days: e.g. "1 day", "2 days"
  let days = 1;
  const daysMatch = text.match(/(\d+)\s*days?/i);
  if (daysMatch) {
    days = Math.max(1, parseInt(daysMatch[1]!, 10));
  }

  return { dailyWindow, durationMin, days };
}

function extractEntityTitle(text: string, defaultName: string): string {
  const match =
    text.match(
      /(?:series|test)\s+(?:ca+l+ed|named|titled|for)\s+["']?([a-zA-Z0-9_\-\s]+?)["']?(?:\s+(?:for|from|with|on|at|and|\d+\s*day)|$)/i,
    ) ??
    text.match(
      /(?:ca+l+ed|named|titled)\s+["']?([a-zA-Z0-9_\-\s]+?)["']?(?:\s+(?:for|from|with|on|at|and|\d+\s*day)|$)/i,
    ) ??
    text.match(/(?:create|make|new)\s+(?:series|test)\s+["']?([a-zA-Z0-9_-]{2,30})["']?/i);

  return match?.[1]?.trim() || defaultName;
}

function extractProposalFromText(
  aiReply: string,
  todayIso: string,
): {
  proposal: AssistantActionProposal | null;
  cleanedReply: string;
} {
  let rawJson: string | null = null;
  // 1. Try ```json:action or ```json or ```
  const fenceMatch = aiReply.match(/```(?:json:action|json)?\s*(\{[\s\S]*?"actionType"[\s\S]*?\})\s*```/);
  if (fenceMatch?.[1]) {
    rawJson = fenceMatch[1];
  } else {
    // 2. Try raw { ... "actionType" ... }
    const startIdx = aiReply.search(/\{\s*"actionType"/);
    if (startIdx >= 0) {
      const candidate = aiReply.slice(startIdx);
      const lastBrace = candidate.lastIndexOf('}');
      if (lastBrace >= 0) {
        rawJson = candidate.slice(0, lastBrace + 1);
      }
    }
  }

  let proposal: AssistantActionProposal | null = null;
  let cleanedReply = aiReply;

  if (rawJson) {
    try {
      const raw = JSON.parse(rawJson);
      const id = raw.id || `prop-${Math.random().toString(36).slice(2, 10)}`;
      // Fix date hallucinations (e.g. past 2023 dates)
      if (raw.seriesData) {
        if (!raw.seriesData.startDate || raw.seriesData.startDate < todayIso) raw.seriesData.startDate = todayIso;
        if (!raw.seriesData.endDate || raw.seriesData.endDate < raw.seriesData.startDate)
          raw.seriesData.endDate = raw.seriesData.startDate;
      }
      if (raw.testData) {
        if (!raw.testData.scheduledDate || raw.testData.scheduledDate < todayIso) raw.testData.scheduledDate = todayIso;
      }
      const parsed = assistantActionProposalSchema.safeParse({ id, ...raw });
      if (parsed.success) {
        proposal = parsed.data;
        cleanedReply = aiReply
          .replace(/```(?:json:action|json)?[\s\S]*?```/g, '')
          .replace(/\{\s*"actionType"[\s\S]*?\}(?:\s*\}|)/g, '')
          .trim();
      }
    } catch {
      // Malformed / truncated JSON fallback
    }
  }

  // Prevent misleading chatbot claims that it already modified the database directly
  cleanedReply = cleanedReply
    .replace(
      /The series ["']?([^"'\n]+)["']? has been successfully created[^\n.]*/gi,
      'I have prepared the action proposal for series "$1" below.',
    )
    .replace(/has been successfully created/gi, 'is ready in the action proposal below')
    .replace(/\[🔗 Create a new Test[^\n]+\]\([^)]+\)/gi, '')
    .replace(/\[🔗 edit series dates[^\n]+\]\([^)]+\)/gi, '')
    .trim();

  return { proposal, cleanedReply };
}

export function createAdminAssistantService(data: Data, entitlements?: EntitlementsService): AdminAssistantService {
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
            maxOutputTokens: 3000,
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
      const todayIso = new Date(now).toISOString().slice(0, 10);
      const todayYear = new Date(now).getFullYear();

      const lastUserMsg =
        messages
          .filter((m) => m.role === 'user')
          .at(-1)
          ?.content.trim() ?? '';
      const lower = lastUserMsg.toLowerCase();

      // Combine user text across turns for context extraction
      const allUserText = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join(' ');
      const allUserLower = allUserText.toLowerCase();

      // 1. Check assessment integrity boundary (Humans only for questions)
      const isQuestionQuery =
        (lower.includes('question') || lower.includes('questions')) &&
        (lower.includes('generate') ||
          lower.includes('create') ||
          lower.includes('add') ||
          lower.includes('write') ||
          lower.includes('make') ||
          lower.includes('sample'));

      if (isQuestionQuery) {
        return {
          reply: `### 🛡️ Human-Only Question Authoring Boundary\n\nI can configure series, tests, scheduling windows, proctoring settings, and student eligibility.\n\nHowever, **question creation, uploading, and approval are strictly reserved for human administrators** to maintain examination integrity and prevent artificial hallucinations.\n\n👉 **To add questions to a test:**\n1. Open your test in the [Test Editor](/admin/tests/edit?id=${context?.testId ?? ''}).\n2. Click **Import Questions** to upload your XLSX, CSV, or PDF question bank.\n3. Review the preview and click **Approve Question Set**.`,
          suggestions: ['Create a test series', 'Set up a 60 min test', "Why can't students see my test?"],
        };
      }

      // 2. Check organization entitlement for AI series & test management
      const ent = entitlements ? await entitlements.get(orgId) : null;
      const canWrite = Boolean(ent?.features?.ai_assistant_write);

      const isAction =
        lower.includes('create series') ||
        lower.includes('make series') ||
        lower.includes('new series') ||
        lower.includes('create test') ||
        lower.includes('make test') ||
        lower.includes('new test') ||
        lower.includes('setup test') ||
        lower.includes('set up test') ||
        lower.includes('set up a test') ||
        lower.includes('update test') ||
        lower.includes('update series') ||
        lower.includes('change eligibility') ||
        lower.includes('change setting') ||
        lower.includes('extend window') ||
        lower.includes('flexible window') ||
        /series\s+(?:ca+l+ed|named|for)/i.test(lastUserMsg) ||
        /test\s+(?:ca+l+ed|named|for)/i.test(lastUserMsg);

      const isConfirmation =
        lower.includes('create it') ||
        lower.includes('creratet') ||
        lower.includes('creat it') ||
        lower.includes('do it') ||
        lower.includes('make it') ||
        lower.includes('confirm') ||
        lower.includes('proceed') ||
        lower.includes('apply it') ||
        lower.includes('go ahead') ||
        lower.includes('yes please') ||
        lower.includes('yes do it');

      const isActionQuery = isAction || (isConfirmation && messages.length > 1);

      if (isActionQuery && !canWrite) {
        return {
          reply: `### 🔒 AI-Assisted Management is Disabled\n\nConversational creation and configuration of test series and tests is currently **disabled** for this organization.\n\nTo enable this capability:\n1. Contact your Superadmin.\n2. In **Organization Settings > Plan & Entitlements**, toggle on **"AI-Assisted Series & Test Creation"**.\n\nIn the meantime, you can create and configure series and tests manually in the [Series Editor](/admin/series).`,
          suggestions: [
            "Why can't students see my test?",
            'How do I grant extra time?',
            'Difference between Whitelist and Students?',
          ],
        };
      }

      // 3. Gather live organizational drives and metadata
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
            startAt > 0 && endAt > 0 && now >= startAt && now <= endAt ? 'live' : now < startAt ? 'upcoming' : 'ended';
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

      // 4. Identify target test for visibility diagnosis if applicable
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

      // 5. Assemble dynamic real-time system prompt
      const driveSummaries = allTests.map((t) => {
        const startStr = new Date(t.startAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const endStr = new Date(t.endAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        return `- Test "${t.title}" (ID: ${t.id}, Day: ${t.dayNumber ?? 'N/A'}, Series: "${t.seriesTitle}"): Status=${t.status}, Window=${t.windowState} (${startStr} to ${endStr}), Total Attempts Started=${t.attemptCount}, Branches=[${t.departments.join(', ')}], Batches=[${t.graduationYears.join(', ')}]`;
      });

      const seriesSummaries = seriesList.map((s) => `- Series "${s.title}" (ID: ${s.id}): Status=${s.status}`);

      const diagnosticText = attachedDiagnostic
        ? `\n### Attached Deterministic Diagnostic for "${attachedDiagnostic.testTitle}":
- Overall Student Visibility: ${attachedDiagnostic.isVisibleToStudents ? 'VISIBLE (Passed all checks)' : 'HIDDEN FROM STUDENTS (Issues detected)'}
- Parent Series Status: ${attachedDiagnostic.seriesTitle} (${attachedDiagnostic.seriesStatus})
- Summary: ${attachedDiagnostic.summary}
- Checks: ${attachedDiagnostic.checks.map((c) => `${c.name}: ${c.detail} (${c.status})`).join('; ')}
- Issues Found: ${attachedDiagnostic.issues.map((i) => `[${i.severity.toUpperCase()}] ${i.title}: ${i.message}. How to fix: ${i.howToFix} (Action: ${i.actionHref ?? 'none'})`).join('; ') || 'None'}`
        : '';

      const actionPrompt = canWrite
        ? `\nConversational Series & Test Management:
Current Environment Date: ${todayIso} (Current Year: ${todayYear}).
When generating series or test dates, default to today's date (${todayIso}) unless the administrator explicitly requests other dates. Under no circumstances generate past years (such as 2023 or 2024).

CRITICAL HUMAN-IN-THE-LOOP RULE:
- You DO NOT have direct access to mutate the database or create series/tests.
- You MUST NEVER say "The series has been created" or "The test has been created". That is a hallucination.
- When an administrator asks to create or configure a series or test, or says "create it" / "confirm" / "proceed":
  1. Concisely summarize what you are configuring (in 2-3 sentences max).
  2. Always generate a structured proposal in a fenced json:action block at the end of your response:
\`\`\`json:action
{
  "actionType": "create_series",
  "title": "Descriptive title for action",
  "summary": "1-sentence summary of configuration",
  "seriesData": {
    "title": "Series Name",
    "startDate": "${todayIso}",
    "endDate": "${todayIso}",
    "dailyWindow": { "startMinutes": 600, "endMinutes": 1020 },
    "defaults": {
      "timingMode": "fixed",
      "durationMin": 30,
      "maxStrikes": 3,
      "fullscreenRequired": true,
      "cameraRequired": true,
      "audioProctoring": true
    },
    "eligibility": {
      "departmentIds": [],
      "graduationYears": [],
      "include": [],
      "exclude": []
    }
  },
  "diffs": [
    { "field": "timingMode", "label": "Daily Test Window", "value": "10:00 AM – 5:00 PM" }
  ],
  "warning": "Questions must be uploaded and approved manually in the Test Editor."
}
\`\`\`
  3. Tell the administrator: "Please review the proposed parameters in the card below and click **Confirm & Apply** to create it."

STRICT BOUNDARY: Under NO circumstances generate questions. Only configure containers, settings, schedules, and eligibility.`
        : '';

      const activeTest = allTests.find((t) => t.id === targetTestId);
      const activeSeries = seriesList.find((s) => s.id === context?.seriesId);
      const activeContextPrompt = activeTest
        ? `\n### CURRENT ACTIVE SCREEN CONTEXT:
The administrator is currently viewing/editing Test "${activeTest.title}" (ID: ${activeTest.id}, Series: "${activeTest.seriesTitle}").
When the administrator asks about "this test", "it", or requests changes (e.g. disabling immediate result release, window timing, proctoring, etc.), they are referring to "${activeTest.title}" (ID: ${activeTest.id}). Focus on and apply actions to this test directly without asking for clarification.`
        : activeSeries
          ? `\n### CURRENT ACTIVE SCREEN CONTEXT:
The administrator is currently viewing/editing Series "${activeSeries.title}" (ID: ${activeSeries.id}).
When the administrator asks about "this series", "it", or requests changes, they are referring to "${activeSeries.title}" (ID: ${activeSeries.id}). Focus on this series directly without asking for clarification.`
          : '';

      const systemPrompt = `You are the MaxLevel Placement Copilot, an expert AI assistant embedded in the college placement administration dashboard.
You help college placement coordinators, TPOs, and exam proctors navigate drives, troubleshoot issues, and answer questions.
${activeContextPrompt}

College Placement Drive Real-Time Context:
- Active Series Drives:
${seriesSummaries.join('\n') || '- None currently created'}
- Tests in Organization:
${driveSummaries.join('\n') || '- None currently created'}
- Total Whitelisted Student Emails (Gatekeeper List): ${whitelist.length}
- Total Registered Student Academic Profiles: ${students.length}
${diagnosticText}
${actionPrompt}

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

      // 6. Attempt AI Generation with Vertex AI Gemini
      const priorHistory = messages.slice(0, -1);
      const aiReply = await callVertexGemini(systemPrompt, priorHistory, lastUserMsg);

      if (aiReply) {
        let { proposal, cleanedReply } = extractProposalFromText(aiReply, todayIso);

        // Safety Net: If user requested an action/confirmation but Vertex didn't output a valid proposal block
        if (!proposal && canWrite && isActionQuery) {
          const isSeries = allUserLower.includes('series') || !allUserLower.includes('test');
          const timing = parseTimingDetails(allUserText);

          if (isSeries) {
            const seriesTitle = extractEntityTitle(allUserText, 'Campus Placement Drive');
            const endIso =
              timing.days === 1 ? todayIso : new Date(now + timing.days * 86400000).toISOString().slice(0, 10);
            const windowText = timing.dailyWindow
              ? `${formatMinutesToTime(timing.dailyWindow.startMinutes)} – ${formatMinutesToTime(timing.dailyWindow.endMinutes)}`
              : 'Flexible Schedule';

            proposal = {
              id: `prop-${Math.random().toString(36).slice(2, 10)}`,
              actionType: 'create_series',
              title: `Create Series: ${seriesTitle}`,
              summary: `Draft series container for "${seriesTitle}" for ${timing.days} day (${todayIso}) from ${windowText} with ${timing.durationMin}m duration.`,
              seriesData: {
                title: seriesTitle,
                startDate: todayIso,
                endDate: endIso,
                ...(timing.dailyWindow ? { dailyWindow: timing.dailyWindow } : {}),
                defaults: {
                  timingMode: timing.dailyWindow ? 'fixed' : 'flexible',
                  durationMin: timing.durationMin,
                  maxStrikes: 3,
                  fullscreenRequired: true,
                  cameraRequired: true,
                  audioProctoring: true,
                },
                eligibility: {
                  departmentIds: [],
                  graduationYears: [],
                  include: [],
                  exclude: [],
                },
              },
              diffs: [
                { field: 'title', label: 'Series Name', value: seriesTitle },
                { field: 'dates', label: 'Series Dates', value: `${todayIso} (${timing.days} Day)` },
                { field: 'window', label: 'Daily Test Window', value: windowText },
                { field: 'durationMin', label: 'Exam Duration', value: `${timing.durationMin} Minutes` },
                { field: 'proctoring', label: 'Proctoring Rules', value: 'Webcam, Audio & Fullscreen Enabled' },
                { field: 'eligibility', label: 'Eligibility', value: 'All Registered Students (No Restrictions)' },
              ],
              requiresConfirmation: true,
              warning: 'Questions must be uploaded and approved manually in the Test Editor.',
            };

            cleanedReply = `### 📋 Proposed Action: Create Placement Series\n\nI have configured the **"${seriesTitle}"** series for ${timing.days} day (${todayIso}) from **${windowText}** with a **${timing.durationMin} minute** test duration.\n\n👉 **To create this series in your database, please review the proposed parameters below and click "Confirm & Apply".**`;
          } else {
            const targetSeries = seriesList[0];
            const seriesId = targetSeries?.id ?? 'series-1';
            const testTitle = extractEntityTitle(allUserText, 'Aptitude Assessment');
            const testDate = targetSeries?.startDate ?? todayIso;

            proposal = {
              id: `prop-${Math.random().toString(36).slice(2, 10)}`,
              actionType: 'create_test',
              title: `Create Test: ${testTitle}`,
              summary: `Draft test container for "${testTitle}" in series "${targetSeries?.title ?? 'Series'}" on ${testDate}.`,
              seriesId,
              testData: {
                seriesId,
                title: testTitle,
                scheduledDate: testDate,
                overrides: {
                  timingMode: 'flexible',
                  durationMin: timing.durationMin,
                  fullscreenRequired: true,
                  cameraRequired: true,
                  audioProctoring: true,
                },
                eligibility: {
                  departmentIds: [],
                  graduationYears: [],
                  include: [],
                  exclude: [],
                },
              },
              diffs: [
                { field: 'series', label: 'Parent Series', value: targetSeries?.title ?? 'Series' },
                { field: 'date', label: 'Scheduled Date', value: testDate },
                { field: 'durationMin', label: 'Duration', value: `${timing.durationMin} Minutes` },
                { field: 'proctoring', label: 'Proctoring Rules', value: 'Webcam, Audio & Fullscreen' },
              ],
              requiresConfirmation: true,
              warning: 'Questions must be uploaded and approved manually in the Test Editor.',
            };

            cleanedReply = `### 📋 Proposed Action: Create Test Container\n\nI have drafted the test container **"${testTitle}"** under series **"${targetSeries?.title ?? 'Series'}"** with a **${timing.durationMin} minute** duration.\n\n👉 **To create this test in your database, please review the proposed parameters below and click "Confirm & Apply".**`;
          }
        }

        // Derive relevant follow-up prompt suggestions
        const suggestions: string[] = [];
        if (proposal) {
          suggestions.push('Confirm & Apply proposal');
          suggestions.push('Cancel proposal');
          suggestions.push('How to add questions?');
        } else if (isVisibilityQuery) {
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
          reply: cleanedReply,
          diagnostic: attachedDiagnostic ?? undefined,
          suggestions,
          proposal: proposal ?? undefined,
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
          lines.push(
            `• **Eligible Students:** ${d.eligibleStudentCount} registered students meet the eligibility rules.`,
          );
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

      // Action proposal fallback when Vertex AI is offline
      if (isActionQuery && canWrite) {
        const isSeries = allUserLower.includes('series') || !allUserLower.includes('test');
        const timing = parseTimingDetails(allUserText);

        if (isSeries) {
          const seriesTitle = extractEntityTitle(allUserText, 'Campus Placement Drive');
          const endIso =
            timing.days === 1 ? todayIso : new Date(now + timing.days * 86400000).toISOString().slice(0, 10);
          const windowText = timing.dailyWindow
            ? `${formatMinutesToTime(timing.dailyWindow.startMinutes)} – ${formatMinutesToTime(timing.dailyWindow.endMinutes)}`
            : 'Flexible Window (9:00 AM - 6:00 PM)';

          const proposal: AssistantActionProposal = {
            id: `prop-${Math.random().toString(36).slice(2, 10)}`,
            actionType: 'create_series',
            title: `Create Series: ${seriesTitle}`,
            summary: `Draft series container for "${seriesTitle}" for ${timing.days} day (${todayIso}) from ${windowText} with ${timing.durationMin}m duration.`,
            seriesData: {
              title: seriesTitle,
              startDate: todayIso,
              endDate: endIso,
              ...(timing.dailyWindow ? { dailyWindow: timing.dailyWindow } : {}),
              defaults: {
                timingMode: timing.dailyWindow ? 'fixed' : 'flexible',
                durationMin: timing.durationMin,
                maxStrikes: 3,
                fullscreenRequired: true,
                cameraRequired: true,
                audioProctoring: true,
              },
              eligibility: {
                departmentIds: [],
                graduationYears: [],
                include: [],
                exclude: [],
              },
            },
            diffs: [
              { field: 'title', label: 'Series Name', value: seriesTitle },
              { field: 'dates', label: 'Series Dates', value: `${todayIso} (${timing.days} Day)` },
              { field: 'window', label: 'Daily Test Window', value: windowText },
              { field: 'durationMin', label: 'Exam Duration', value: `${timing.durationMin} Minutes` },
              { field: 'proctoring', label: 'Proctoring Rules', value: 'Webcam, Audio & Fullscreen Enabled' },
              { field: 'eligibility', label: 'Eligibility', value: 'All Registered Students (No Restrictions)' },
            ],
            requiresConfirmation: true,
            warning: 'Questions must be uploaded and approved manually in the Test Editor.',
          };

          return {
            reply: `### 📋 Proposed Action: Create Placement Series\n\nI have configured the **"${seriesTitle}"** series for ${timing.days} day (${todayIso}) from **${windowText}** with a **${timing.durationMin} minute** test duration.\n\n👉 **To create this series in your database, please review the proposed parameters below and click "Confirm & Apply".**`,
            proposal,
            suggestions: ['Confirm & Apply proposal', 'Cancel proposal', 'How to add questions?'],
          };
        } else {
          // Test creation proposal
          const targetSeries = seriesList[0];
          const seriesId = targetSeries?.id ?? 'series-1';
          const testTitle = extractEntityTitle(allUserText, 'Aptitude Assessment');
          const testDate = targetSeries?.startDate ?? todayIso;

          const proposal: AssistantActionProposal = {
            id: `prop-${Math.random().toString(36).slice(2, 10)}`,
            actionType: 'create_test',
            title: `Create Test: ${testTitle}`,
            summary: `Draft test container for "${testTitle}" in series "${targetSeries?.title ?? 'Series'}" on ${testDate}.`,
            seriesId,
            testData: {
              seriesId,
              title: testTitle,
              scheduledDate: testDate,
              overrides: {
                timingMode: 'flexible',
                durationMin: timing.durationMin,
                fullscreenRequired: true,
                cameraRequired: true,
                audioProctoring: true,
              },
              eligibility: {
                departmentIds: [],
                graduationYears: [],
                include: [],
                exclude: [],
              },
            },
            diffs: [
              { field: 'series', label: 'Parent Series', value: targetSeries?.title ?? 'Series' },
              { field: 'date', label: 'Scheduled Date', value: testDate },
              { field: 'durationMin', label: 'Duration', value: `${timing.durationMin} Minutes` },
              { field: 'proctoring', label: 'Proctoring Rules', value: 'Webcam, Audio & Fullscreen' },
            ],
            requiresConfirmation: true,
            warning: 'Questions must be uploaded and approved manually in the Test Editor.',
          };

          return {
            reply: `### 📋 Proposed Action: Create Test Container\n\nI have drafted the test container **"${testTitle}"** under series **"${targetSeries?.title ?? 'Series'}"** with a **${timing.durationMin} minute** duration.\n\n👉 **To create this test in your database, please review the proposed parameters below and click "Confirm & Apply".**`,
            proposal,
            suggestions: ['Confirm & Apply proposal', 'Cancel proposal', 'How to add questions?'],
          };
        }
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
