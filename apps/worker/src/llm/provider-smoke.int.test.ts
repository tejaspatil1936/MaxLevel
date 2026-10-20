import {
  computeTestMetrics,
  extractionPrompt,
  LlmAnswerSchema,
  ReportSummarySchema,
  summaryMessages,
  unsupportedInAnswer,
} from '@mitaoe/shared';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { readPdf } from '../import-files';
import { selectLlm } from './select';

// The real-provider smoke test (DECISIONS Q30, docs/testids/phase-6.md): it sends a two-page sample PDF to Gemini on
// Vertex AI only when credentials are present (GOOGLE_VERTEX_PROJECT and GOOGLE_APPLICATION_CREDENTIALS), and is
// skipped with that reason otherwise. Every other test uses the mock model.

const credentials = !!process.env.GOOGLE_VERTEX_PROJECT && !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

async function samplePaper(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [
    ['Quantitative aptitude', '1. What is 25% of 80?', '(a) 15  (b) 20  (c) 25  (d) 30', 'Ans: (b)'],
    ['2. A train covers 120 km in 2 hours. What is its speed?', '(a) 40 km/h  (b) 50 km/h  (c) 60 km/h', 'Ans: (c)'],
  ];
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 24, size: 13, font }));
  }
  return doc.save();
}

describe('real provider smoke test', () => {
  it(
    'IMP-03 IMP-07 the configured provider reads a two-page PDF, page by page, into answers LlmQuestionSchema accepts',
    { timeout: 300_000 },
    async (ctx) => {
      if (!credentials)
        ctx.skip('no provider credentials: set GOOGLE_VERTEX_PROJECT and GOOGLE_APPLICATION_CREDENTIALS to run it');
      const llm = selectLlm(loadConfig({ ...process.env, NODE_ENV: 'test', LLM_PROVIDER: 'vertex' }))!;
      const pdf = (await readPdf(await samplePaper()))!;
      const found: string[] = [];
      for (const page of [1, 2]) {
        const prompt = extractionPrompt({ page, hasPageFile: true });
        const res = await llm.generate({
          page,
          system: prompt.system,
          parts: [
            { type: 'text', text: prompt.userText },
            { type: 'file', mediaType: 'application/pdf', data: await pdf.page(page) },
          ],
        });
        const answer = LlmAnswerSchema.parse(res.output);
        expect(res.usage.inputTokens).toBeGreaterThan(0);
        found.push(...answer.questions.map((q) => q.prompt));
      }
      expect(found.length).toBeGreaterThanOrEqual(2);
    },
  );

  it(
    'EXP-05 the configured provider writes a report summary from a sample metrics JSON that ReportSummarySchema accepts',
    { timeout: 120_000 },
    async (ctx) => {
      if (!credentials)
        ctx.skip('no provider credentials: set GOOGLE_VERTEX_PROJECT and GOOGLE_APPLICATION_CREDENTIALS to run it');
      const llm = selectLlm(loadConfig({ ...process.env, NODE_ENV: 'test', LLM_PROVIDER: 'vertex' }))!;
      const metrics = computeTestMetrics({
        title: 'Day 1: Quantitative aptitude',
        maxScore: 1,
        eligible: 4,
        inProgress: 0,
        questions: [{ id: 'q1', sectionId: null, options: [{ id: 'a', text: '20 m/s' }], correctOptionIds: ['a'] }],
        sections: [],
        departments: [{ id: 'cs', name: 'Computer' }],
        attempts: [1, 0].map((score, i) => ({
          studentId: `s${i}`,
          departmentId: 'cs',
          status: 'submitted' as const,
          score,
          durationSec: 300,
          strikesCount: 0,
          sections: {},
          answers: { q1: score ? 'a' : null },
          drawQuestionIds: ['q1'],
        })),
      });
      const res = await llm.summarize(summaryMessages(metrics));
      const answer = ReportSummarySchema.parse(res.output);
      expect(res.usage.inputTokens).toBeGreaterThan(0);
      // Whether the real model keeps to the metrics' numbers is a manual check (docs/testids/phase-7.md); log it.
      console.info('unsupported numbers in the real answer:', unsupportedInAnswer(answer, metrics));
    },
  );
});
