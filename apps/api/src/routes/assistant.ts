import {
  assistantChatRequestSchema,
  assistantChatResponseSchema,
  diagnosticReportSchema,
  docIdSchema,
  type AssistantChatResponse,
  type DiagnosticReport,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../errors';
import { adminDiagnosticService } from '../services/admin-diagnostic';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const testIdParams = z.object({ id: docIdSchema });
const diagnoseQuery = z.object({ student: z.string().optional() });

export function assistantRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock } = ctx;
  const diagnostics = adminDiagnosticService(data);

  return async (app) => {
    // 1. Direct 1-Click Test Diagnostic Endpoint
    app.get(
      '/v1/admin/diagnose/tests/:id',
      {
        config: admin,
        schema: {
          params: testIdParams,
          querystring: diagnoseQuery,
          response: { 200: diagnosticReportSchema },
        },
      },
      async (req) => {
        const report = await diagnostics.diagnoseTest(
          req.orgId!,
          req.params.id,
          clock.now(),
          req.query.student,
        );
        if (!report) throw notFound('Test');
        return report;
      },
    );

    // 2. Interactive Admin Assistant Chat Endpoint
    app.post(
      '/v1/admin/assistant/chat',
      {
        config: admin,
        schema: {
          body: assistantChatRequestSchema,
          response: { 200: assistantChatResponseSchema },
        },
      },
      async (req): Promise<AssistantChatResponse> => {
        const orgId = req.orgId!;
        const now = clock.now();
        const { messages, context } = req.body;
        const lastMessage = messages.at(-1)?.content.trim().toLowerCase() ?? '';

        // Check if user is asking to diagnose a test or why a test is not showing up
        const isVisibilityQuery =
          lastMessage.includes('not appearing') ||
          lastMessage.includes('not showing') ||
          lastMessage.includes('cannot see') ||
          lastMessage.includes('hidden') ||
          lastMessage.includes('why') ||
          lastMessage.includes('diagnos') ||
          lastMessage.includes('visibility') ||
          Boolean(context?.testId);

        let attachedDiagnostic: DiagnosticReport | null = null;

        if (isVisibilityQuery) {
          // Identify test ID from context or search matching test title in org
          let targetTestId = context?.testId;

          if (!targetTestId) {
            // Scan series and tests in the org
            const seriesList = await data.series.listSeries(orgId);
            for (const s of seriesList) {
              const tests = await data.tests.listTests(orgId, s.id);
              // Check if user mentioned the test title
              const matched = tests.find((t) =>
                lastMessage.includes(t.title.toLowerCase()) ||
                (t.dayNumber && lastMessage.includes(`day ${t.dayNumber.toLowerCase()}`)),
              );
              if (matched) {
                targetTestId = matched.id;
                break;
              }
              // Fallback to the latest created test if specifically asked about "my test"
              if (!targetTestId && tests.length > 0) {
                targetTestId = tests[0]?.id;
              }
            }
          }

          if (targetTestId) {
            attachedDiagnostic = await diagnostics.diagnoseTest(orgId, targetTestId, now);
          }
        }

        // If a diagnostic was run, format an immediate concrete diagnostic explanation
        if (attachedDiagnostic) {
          const d = attachedDiagnostic;
          const criticalIssues = d.issues.filter((i) => i.severity === 'critical');
          const warningIssues = d.issues.filter((i) => i.severity === 'warning');

          if (criticalIssues.length > 0) {
            const lines: string[] = [];
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

            if (warningIssues.length > 0) {
              lines.push(`\n**Additional Warnings:**`);
              for (const w of warningIssues) {
                lines.push(`• **${w.title}:** ${w.message}`);
              }
            }

            return {
              reply: lines.join('\n'),
              diagnostic: d,
              suggestions: [
                'How do I publish the parent series?',
                'Who is eligible for this test?',
                'How do I grant extra time to a student?',
              ],
            };
          }

          // Test is visible!
          return {
            reply: [
              `### 🟢 Test **"${d.testTitle}"** is Live and Visible!`,
              `• **Parent Series:** "${d.seriesTitle}" is Active ✅`,
              `• **Test Status:** Scheduled ✅`,
              `• **Eligible Students:** ${d.eligibleStudentCount} registered students meet the department and graduation year rules.`,
              `\nStudents will see this test in their dashboard immediately upon logging in.`,
            ].join('\n'),
            diagnostic: d,
            suggestions: [
              'How do I monitor students live?',
              'How to export recruiter scorecards?',
            ],
          };
        }

        // Operational Assistance & FAQs
        if (lastMessage.includes('extra time') || lastMessage.includes('more time')) {
          return {
            reply: [
              `### ⏱️ How to Grant Extra Time During an Exam`,
              `1. Go to **Live Proctoring** in the sidebar ([open live dashboard](/admin/live)).`,
              `2. Find the student’s card in the live proctor room grid (you can filter by student name or PRN).`,
              `3. Click the **Grant Extra Time** button.`,
              `4. Enter the number of minutes (e.g. \`10\` or \`15\`) and a brief reason (e.g. *"Device rebooted"*).`,
              `5. Click **Confirm Grant**.`,
              `\nThe extra minutes sync to the student's monotonic timer in less than 1 second over the real-time sync channel.`,
            ].join('\n'),
            suggestions: [
              'What happens if student Wi-Fi disconnects?',
              'Why is my test not appearing for students?',
            ],
          };
        }

        if (
          lastMessage.includes('whitelist') &&
          (lastMessage.includes('student') || lastMessage.includes('difference'))
        ) {
          return {
            reply: [
              `### 📋 Difference Between Whitelist & Students Tab`,
              `• **Whitelist ([/admin/whitelist/](/admin/whitelist/)):**`,
              `  - This is your **login gatekeeper list**.`,
              `  - Upload 1,000+ raw student emails from an Excel or CSV file.`,
              `  - If an email is on the whitelist, Google sign-in is allowed. If not, they are blocked.`,
              `  - Students here are in **Invited** status before they log in.\n`,
              `• **Students Tab ([/admin/students/](/admin/students/)):**`,
              `  - This is your **academic student directory**.`,
              `  - Populated automatically as soon as an invited student signs in and completes their profile (Branch, Year, PRN).`,
              `  - Click on any student to view their **Test Attempts, Scores, and Proctoring Strikes**.`,
            ].join('\n'),
            suggestions: [
              'How do I upload a student CSV?',
              'Why is my test not appearing for students?',
            ],
          };
        }

        if (lastMessage.includes('scorecard') || lastMessage.includes('export') || lastMessage.includes('report') || lastMessage.includes('recruiter')) {
          return {
            reply: [
              `### 📊 How to Export Candidate Scorecards for Corporate Recruiters`,
              `1. When a test concludes, open **Reports** in the left sidebar ([open reports](/admin/reports/)).`,
              `2. Select the completed Series or Test drive.`,
              `3. Click **Generate Recruiter Report** to see average scores, percentiles, and top performers.`,
              `4. Click **Export CSV** at the top right to download a clean, verified CSV spreadsheet formatted for visiting company HR teams.`,
            ].join('\n'),
            suggestions: [
              'How to release test results to students?',
              'How do I grant extra time?',
            ],
          };
        }

        if (lastMessage.includes('pair') || lastMessage.includes('phone') || lastMessage.includes('camera')) {
          return {
            reply: [
              `### 📱 How Dual-Camera Mobile Pairing Works`,
              `1. When a student enters an exam with second-camera proctoring enabled, they reach the **Preflight Check** screen.`,
              `2. An encrypted QR code is displayed on their laptop screen.`,
              `3. The student scans the QR code with **any smartphone camera** (iOS or Android).`,
              `4. No mobile apps or software installations are required. The phone opens a secure WebRTC video stream directly in Safari or Chrome.`,
              `5. AI vision models process head movements and side angles right on the student's device — zero video is uploaded to cloud servers.`,
            ].join('\n'),
            suggestions: [
              'Why is my test not appearing for students?',
              'How do I give extra time during an exam?',
            ],
          };
        }

        // Default friendly assistant fallback with common placement operations
        return {
          reply: [
            `👋 Hello! I am your **MaxLevel Placement Assistant**.`,
            `I can help you troubleshoot live placement drives, verify test visibility, and navigate the platform.\n`,
            `**Common things I can help you with:**`,
            `• **"Why can't students see my test?"** — I will audit your Series status, test schedule, and branch eligibility to find the exact fix.`,
            `• **"How do I give extra time?"** — Step-by-step instructions for adding minutes during unexpected disruptions.`,
            `• **"How to export scorecards?"** — Download recruiter-ready CSV spreadsheets.`,
            `• **"Difference between Whitelist and Students?"** — Learn how student access and directories work.`,
          ].join('\n'),
          suggestions: [
            "Why can't students see my test?",
            'How do I grant extra time?',
            'How to export recruiter scorecards?',
            'Difference between Whitelist and Students?',
          ],
        };
      },
    );
  };
}
